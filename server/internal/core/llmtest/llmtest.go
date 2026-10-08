// Package llmtest is the language model Norte's tests talk to: an httptest
// server speaking chat completions and answering canned JSON, so that no test
// reaches a model and no test needs a key that works.
package llmtest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
)

// Request is one completion the stub received, flattened to what a test
// asserts on.
//
// Authorization is kept so a test can prove the key travelled as a bearer
// token; it is the stub's business to receive it and nobody else's to print
// it.
type Request struct {
	Model         string
	System        string
	User          string
	SchemaName    string
	Schema        json.RawMessage
	Authorization string
}

// Server is the stub. It answers every completion with the content last given
// to Answer, which makes "the model changed its mind between two runs" one
// line in a test.
type Server struct {
	mu       sync.Mutex
	content  string
	failures []int
	requests []Request

	server *httptest.Server
}

// New starts the stub answering content as the model's reply. The caller
// closes it.
func New(content string) *Server {
	stub := &Server{content: content}
	stub.server = httptest.NewServer(http.HandlerFunc(stub.complete))
	return stub
}

// URL is the chat-completions endpoint NORTE_LLM_URL is set to.
func (s *Server) URL() string { return s.server.URL + "/chat/completions" }

// Close stops the stub.
func (s *Server) Close() { s.server.Close() }

// Answer replaces the content every later completion answers with.
func (s *Server) Answer(content string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.content = content
}

// FailNext makes the next len(statuses) completions answer those statuses in
// order, before the content answer resumes. The request is still recorded,
// because a request the endpoint received and then refused is still a request
// the client made.
func (s *Server) FailNext(statuses ...int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures = append(s.failures, statuses...)
}

// Requests reports every completion the stub received, in order.
func (s *Server) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Request(nil), s.requests...)
}

// complete records the request and answers the canned content inside a
// chat-completions envelope.
func (s *Server) complete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		ResponseFormat struct {
			JSONSchema struct {
				Name   string          `json:"name"`
				Schema json.RawMessage `json:"schema"`
			} `json:"json_schema"`
		} `json:"response_format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"the stub could not read the request"}`, http.StatusBadRequest)
		return
	}
	recorded := Request{
		Model:         body.Model,
		SchemaName:    body.ResponseFormat.JSONSchema.Name,
		Schema:        body.ResponseFormat.JSONSchema.Schema,
		Authorization: r.Header.Get("Authorization"),
	}
	for _, message := range body.Messages {
		switch message.Role {
		case "system":
			recorded.System = message.Content
		case "user":
			recorded.User = message.Content
		}
	}

	s.mu.Lock()
	s.requests = append(s.requests, recorded)
	status := http.StatusOK
	if len(s.failures) > 0 {
		status = s.failures[0]
		s.failures = s.failures[1:]
	}
	content := s.content
	s.mu.Unlock()

	if status != http.StatusOK {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":{"message":"the stub was told to fail this completion"}}`))
		return
	}
	encoded, err := json.Marshal(map[string]any{
		"choices": []map[string]any{
			{"message": map[string]any{"role": "assistant", "content": content}},
		},
	})
	if err != nil {
		http.Error(w, `{"error":"the stub could not encode"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(encoded)
}
