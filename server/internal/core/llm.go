package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrDisabled is what every LLM call answers when no endpoint is configured.
//
// It is a sentinel rather than a nil client so the decision stays in one
// place: a caller asks and is told no, instead of each caller re-deriving
// "NORTE_LLM_URL is empty" from a field it should not be reading.
var ErrDisabled = errors.New("no LLM is configured: NORTE_LLM_URL is empty")

const (
	// llmTimeout bounds one attempt, not the call: the retry below gets its
	// own window, because the point of retrying a timeout is to give the
	// second try the same chance the first had.
	llmTimeout = 30 * time.Second
	// llmAttempts is the first try plus the one retry a timeout or a 5xx buys.
	llmAttempts = 2
	// llmChatCompletionsPath is appended when the configured URL is not
	// already the chat-completions endpoint itself.
	llmChatCompletionsPath = "/chat/completions"
	// llmMaxAnswerBytes caps what is read off a reply. A model answering a
	// ranked list of three ids needs a few hundred bytes; the cap is what
	// keeps a misconfigured endpoint from streaming into memory.
	llmMaxAnswerBytes = 1 << 20
)

// LLMSchema is the JSON shape an answer must take: the name the endpoint
// records it under, and the JSON Schema itself.
type LLMSchema struct {
	Name   string
	Schema any
}

// LLM is the one way Norte talks to a language model: an OpenAI-compatible
// chat-completions endpoint, asked for an answer in a JSON schema the caller
// names.
//
// The key is held here and sent as a bearer token. It never reaches an error
// message or a log line, which is why no method on this type takes a logger:
// what it has to say, it says in its return value.
type LLM struct {
	endpoint string
	model    string
	key      string
	client   *http.Client
}

// NewLLM returns the client over the configured settings. An empty rawURL
// yields a client whose every call answers ErrDisabled, so the wiring does not
// branch on configuration.
//
// rawURL may be the chat-completions endpoint itself or the base it hangs off:
// a URL whose path already ends in /chat/completions is used as it stands, and
// anything else has that path appended. Both spellings are in the wild, and
// guessing wrong costs a person a 404 with no explanation.
func NewLLM(rawURL, model, key string) *LLM {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return &LLM{}
	}
	endpoint := strings.TrimSuffix(trimmed, "/")
	if !strings.HasSuffix(endpoint, llmChatCompletionsPath) {
		endpoint += llmChatCompletionsPath
	}
	return &LLM{
		endpoint: endpoint,
		model:    model,
		key:      key,
		// No overall timeout on the client: the per-attempt deadline is a
		// context, so a retry is not spending the first attempt's budget.
		client: &http.Client{},
	}
}

// Configured reports whether this process has an LLM to ask. It is how a
// module decides not to enqueue work whose handler would only answer
// ErrDisabled.
func (l *LLM) Configured() bool {
	return l != nil && l.endpoint != ""
}

// Complete asks for one completion and answers with the model's reply parsed
// as JSON.
//
// The reply is required to be JSON matching schema, so what comes back is the
// answer and never prose around it. A reply that is not JSON is an error and
// not an empty answer: the caller's own retry decides what that costs, and
// silently treating it as "no suggestions" would make a broken endpoint look
// like a model with no opinion.
func (l *LLM) Complete(ctx context.Context, system, user string, schema LLMSchema) (json.RawMessage, error) {
	if !l.Configured() {
		return nil, ErrDisabled
	}
	body, err := json.Marshal(map[string]any{
		"model": l.model,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   schema.Name,
				"strict": true,
				"schema": schema.Schema,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("encoding the completion request: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= llmAttempts; attempt++ {
		answer, retryable, err := l.attempt(ctx, body)
		if err == nil {
			return answer, nil
		}
		lastErr = err
		// The caller's context ending is not a failure of the endpoint, and
		// retrying against a dead context only burns the attempt.
		if !retryable || ctx.Err() != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

// attempt runs one request. The second result says whether the failure is one
// a retry could fix: a timeout or a 5xx, and nothing else.
func (l *LLM) attempt(ctx context.Context, body []byte) (json.RawMessage, bool, error) {
	attemptCtx, cancel := context.WithTimeout(ctx, llmTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(attemptCtx, http.MethodPost, l.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, false, fmt.Errorf("building the completion request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if l.key != "" {
		request.Header.Set("Authorization", "Bearer "+l.key)
	}

	response, err := l.client.Do(request)
	if err != nil {
		// The message is not wrapped with the URL: a configured endpoint can
		// carry a token in its query, and this error travels into a job row.
		return nil, llmTransportRetryable(attemptCtx, err), fmt.Errorf("asking the LLM: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, llmMaxAnswerBytes))
		_ = response.Body.Close()
	}()

	if response.StatusCode >= http.StatusInternalServerError {
		return nil, true, fmt.Errorf("the LLM answered %d", response.StatusCode)
	}
	if response.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("the LLM answered %d", response.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(response.Body, llmMaxAnswerBytes))
	if err != nil {
		return nil, true, fmt.Errorf("reading the LLM's answer: %w", err)
	}
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, false, fmt.Errorf("reading the LLM's answer envelope: %w", err)
	}
	if len(envelope.Choices) == 0 {
		return nil, false, errors.New("the LLM answered with no choices")
	}
	content := strings.TrimSpace(envelope.Choices[0].Message.Content)
	if content == "" {
		return nil, false, errors.New("the LLM answered with empty content")
	}
	if !json.Valid([]byte(content)) {
		// Not retryable here: the job queue owns that decision, and its retry
		// is the one that gets the model a second chance at the same prompt.
		return nil, false, errors.New("the LLM's answer is not JSON")
	}
	return json.RawMessage(content), false, nil
}

// llmTransportRetryable reports whether a transport failure was the attempt
// running out of time, which is the one a retry is for. A refused connection
// or an unknown host will fail the same way again inside the job's own retry,
// so it is not worth a second request here.
func llmTransportRetryable(ctx context.Context, err error) bool {
	if errors.Is(err, context.DeadlineExceeded) && ctx.Err() != nil {
		return true
	}
	var timeout interface{ Timeout() bool }
	return errors.As(err, &timeout) && timeout.Timeout()
}
