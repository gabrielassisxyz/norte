// The decider client: the one way Norte asks the Laya sidecar (decider/) a
// typed question about a saved link. The sidecar answers POST /decide with
// Laya's own answers object, each `choice` carrying a calibrated probability
// per option, which is what the router thresholds on.
package library

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// errLibraryNoDecider is what a call answers when no sidecar is configured.
// It is a sentinel rather than a nil client for the reason core.ErrDisabled is
// one: a caller asks and is told no, instead of re-deriving "NORTE_DECIDER_URL
// is empty" from a field it should not be reading.
var errLibraryNoDecider = errors.New("no decider is configured: NORTE_DECIDER_URL is empty")

const (
	// libraryDecideTimeout bounds the whole call. The sidecar is one batched
	// forward pass on the same machine -- about 140 ms warm -- so five
	// seconds is already the pathological case, and a router that waits
	// longer is a router holding a job slot for an opinion.
	libraryDecideTimeout = 5 * time.Second
	// libraryDecidePath is appended when the configured URL is not already
	// the decide endpoint itself, the way the LLM client treats
	// /chat/completions: both spellings are what a person will put in the
	// setting, and guessing wrong costs them a 404 with no explanation.
	libraryDecidePath = "/decide"
	// libraryDecideMaxAnswerBytes caps what is read off a reply. Two choice
	// answers are a few hundred bytes; the cap is what keeps a misconfigured
	// endpoint from streaming into memory.
	libraryDecideMaxAnswerBytes = 1 << 20
)

// libraryDeciderQuestion is one typed question. Only `choice` is asked here --
// the router wants an option with a probability, which is what choice is -- so
// the struct carries that type's fields and not score's ordered rubric.
type libraryDeciderQuestion struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria"`
}

// libraryDeciderAnswer is one answer: the option the model picked and the
// probability it gave every option. The probabilities are the answer, not the
// choice: the router applies a threshold, so an option picked at 0.42 is an
// option it declines to act on.
type libraryDeciderAnswer struct {
	Choice        string             `json:"choice"`
	Probabilities map[string]float64 `json:"probabilities"`
}

// probability reads one option's probability, answering 0 for an option the
// model did not score -- which is the right reading for a threshold: an
// unscored option is one nothing argues for.
func (a libraryDeciderAnswer) probability(option string) float64 {
	return a.Probabilities[option]
}

// top is the highest-scoring option and its probability, read from the
// probabilities rather than from choice, so a reply whose choice and
// distribution disagree is thresholded on the number the threshold is about.
// Ties resolve on the option name, so one answer always yields one result.
func (a libraryDeciderAnswer) top() (string, float64) {
	best, bestP := "", 0.0
	for option, p := range a.Probabilities {
		if p > bestP || (p == bestP && best != "" && option < best) {
			best, bestP = option, p
		}
	}
	return best, bestP
}

// libraryDecider is the HTTP client over the sidecar. A client built from an
// empty URL answers errLibraryNoDecider to every call, so the wiring does not
// branch on configuration.
type libraryDecider struct {
	endpoint string
	client   *http.Client
	// timeout bounds the call; a field so a test can shrink it instead of
	// waiting out libraryDecideTimeout.
	timeout time.Duration
}

// newLibraryDecider returns the client over the configured URL.
func newLibraryDecider(rawURL string) *libraryDecider {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return &libraryDecider{}
	}
	return &libraryDecider{
		endpoint: libraryDecideEndpoint(trimmed),
		client:   &http.Client{},
		timeout:  libraryDecideTimeout,
	}
}

// libraryDecideEndpoint appends the decide path to the URL's path, not to the
// raw string, so a query token stays a query instead of swallowing the path.
func libraryDecideEndpoint(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		endpoint := strings.TrimSuffix(raw, "/")
		if !strings.HasSuffix(endpoint, libraryDecidePath) {
			endpoint += libraryDecidePath
		}
		return endpoint
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	if !strings.HasSuffix(parsed.Path, libraryDecidePath) {
		parsed.Path += libraryDecidePath
	}
	return parsed.String()
}

// Configured reports whether this process has a decider to ask. It is how the
// extraction decides not to enqueue a routing job whose handler would only
// answer errLibraryNoDecider.
func (d *libraryDecider) Configured() bool {
	return d != nil && d.endpoint != ""
}

// Decide asks the sidecar every question in one call and answers with its
// answers object.
//
// One attempt and no retry: the sidecar is a local process holding the model
// in memory, so a failure here is a sidecar that is down, loading or
// misconfigured, and none of the three is fixed by asking again inside the
// same five seconds. What a failure costs is in the caller -- the item stays
// where the save put it -- which is why this returns the error rather than
// swallowing it.
func (d *libraryDecider) Decide(
	ctx context.Context,
	state any,
	questions map[string]libraryDeciderQuestion,
) (map[string]libraryDeciderAnswer, error) {
	if !d.Configured() {
		return nil, errLibraryNoDecider
	}
	body, err := json.Marshal(map[string]any{"state": state, "questions": questions})
	if err != nil {
		return nil, fmt.Errorf("encoding the decide request: %w", err)
	}
	callCtx, cancel := context.WithTimeout(ctx, d.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(callCtx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("building the decide request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := d.client.Do(request)
	if err != nil {
		return nil, d.transportError(err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, libraryDecideMaxAnswerBytes))
		_ = response.Body.Close()
	}()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, fmt.Errorf("the decider answered %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, libraryDecideMaxAnswerBytes))
	if err != nil {
		return nil, fmt.Errorf("reading the decider's answer: %w", err)
	}
	var envelope struct {
		Answers map[string]libraryDeciderAnswer `json:"answers"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("reading the decider's answer: %w", err)
	}
	if len(envelope.Answers) == 0 {
		return nil, errors.New("the decider answered no questions")
	}
	return envelope.Answers, nil
}

// transportError rewraps a transport failure without the request URL. The
// *url.Error net/http returns prints the whole URL, a configured endpoint can
// carry a token in its query, and this error travels into a log line; the
// underlying cause plus the host is what a person needs to diagnose it.
func (d *libraryDecider) transportError(err error) error {
	var urlErr *url.Error
	if !errors.As(err, &urlErr) {
		return fmt.Errorf("asking the decider: %w", err)
	}
	host := "the endpoint"
	if parsed, parseErr := url.Parse(d.endpoint); parseErr == nil && parsed.Host != "" {
		host = parsed.Host
	}
	return fmt.Errorf("asking the decider at %s: %w", host, urlErr.Err)
}
