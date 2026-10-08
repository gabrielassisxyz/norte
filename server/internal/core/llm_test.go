package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var llmTestSchema = LLMSchema{Name: "t", Schema: map[string]any{"type": "object"}}

// TestATransportErrorDoesNotCarryTheEndpointQuery: the error lands in a job
// row, and a token in NORTE_LLM_URL's query must not.
func TestATransportErrorDoesNotCarryTheEndpointQuery(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()

	llm := NewLLM(url+"/v1?key=SECRET", "m", "")
	_, err := llm.Complete(context.Background(), "s", "u", llmTestSchema)
	if err == nil {
		t.Fatal("expected a transport failure")
	}
	if strings.Contains(err.Error(), "SECRET") || strings.Contains(err.Error(), "key=") {
		t.Errorf("the error leaks the query: %v", err)
	}
	if !strings.Contains(err.Error(), strings.TrimPrefix(url, "http://")) {
		t.Errorf("the error does not name the host: %v", err)
	}
}

// TestATimeoutIsRetriedOnceThenFails: the first attempt hangs past the
// per-attempt timeout, the one retry does too, and the call gives up.
func TestATimeoutIsRetriedOnceThenFails(t *testing.T) {
	var hits atomic.Int32
	release := make(chan struct{})
	hang := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer hang.Close()
	defer close(release)

	llm := NewLLM(hang.URL, "m", "")
	llm.timeout = 50 * time.Millisecond
	_, err := llm.Complete(context.Background(), "s", "u", llmTestSchema)
	if err == nil {
		t.Fatal("expected the call to fail")
	}
	if got := hits.Load(); got != llmAttempts {
		t.Errorf("the endpoint saw %d requests, want %d", got, llmAttempts)
	}
}

// TestATimeoutThenASuccessAnswers: the retry gets a fresh window.
func TestATimeoutThenASuccessAnswers(t *testing.T) {
	var hits atomic.Int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) == 1 {
			select {
			case <-release:
			case <-r.Context().Done():
			}
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"ok\":true}"}}]}`))
	}))
	defer server.Close()
	defer close(release)

	llm := NewLLM(server.URL, "m", "")
	llm.timeout = 50 * time.Millisecond
	answer, err := llm.Complete(context.Background(), "s", "u", llmTestSchema)
	if err != nil {
		t.Fatalf("the retry should have answered: %v", err)
	}
	if string(answer) != `{"ok":true}` || hits.Load() != 2 {
		t.Errorf("answer %s after %d requests", answer, hits.Load())
	}
}
