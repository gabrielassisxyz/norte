package core_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// bodyReadingHandler is mounted only by these tests: no public route reads a
// body yet, and the body cap is only observable through a handler that does.
func bodyReadingHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := core.ReadLimitedBody(w, r)
		if err != nil {
			// ReadLimitedBody has already answered 413.
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]int{"read": len(body)})
	})
}

func decodeErrorBody(t *testing.T, raw []byte) core.ErrorBody {
	t.Helper()
	var decoded core.ErrorBody
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("response is not the JSON error shape: %v (body %q)", err, raw)
	}
	return decoded
}

func TestBodyLimitRejectsADeclaredOversizedBody(t *testing.T) {
	handler := core.WithRequestID(core.WithBodyLimit(16, bodyReadingHandler()))

	request := httptest.NewRequest(http.MethodPost, "/anything", bytes.NewReader(bytes.Repeat([]byte("x"), 64)))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", recorder.Code)
	}
	decoded := decodeErrorBody(t, recorder.Body.Bytes())
	if decoded.Error.Code != "body_too_large" {
		t.Errorf("code = %q, want body_too_large", decoded.Error.Code)
	}
	if decoded.Error.RequestID == "" {
		t.Error("error body carries no request_id")
	}
}

func TestBodyLimitAcceptsABodyUnderTheCap(t *testing.T) {
	handler := core.WithRequestID(core.WithBodyLimit(16, bodyReadingHandler()))

	request := httptest.NewRequest(http.MethodPost, "/anything", strings.NewReader("small"))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Body.String(); !strings.Contains(got, `"read":5`) {
		t.Errorf("handler did not read the body: %q", got)
	}
}

// unmeasuredReader hides its length so net/http sends the request chunked,
// which is the case a Content-Length check alone would miss.
type unmeasuredReader struct{ remaining int }

func (u *unmeasuredReader) Read(p []byte) (int, error) {
	if u.remaining == 0 {
		return 0, io.EOF
	}
	n := len(p)
	if n > u.remaining {
		n = u.remaining
	}
	for i := range n {
		p[i] = 'x'
	}
	u.remaining -= n
	return n, nil
}

func TestBodyLimitRejectsAChunkedOversizedBody(t *testing.T) {
	// The server records what it received, so the test can prove the request
	// really arrived chunked and not with a Content-Length the middleware would
	// have rejected before any reading happened.
	var transferEncoding []string
	var contentLength int64
	inspect := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		transferEncoding, contentLength = r.TransferEncoding, r.ContentLength
		core.WithBodyLimit(16, bodyReadingHandler()).ServeHTTP(w, r)
	})
	server := httptest.NewServer(core.WithRequestID(inspect))
	defer server.Close()

	request, err := http.NewRequest(http.MethodPost, server.URL+"/anything", &unmeasuredReader{remaining: 4096})
	if err != nil {
		t.Fatalf("building the request: %v", err)
	}

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("sending the request: %v", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading the response: %v", err)
	}

	if len(transferEncoding) != 1 || transferEncoding[0] != "chunked" {
		t.Fatalf("TransferEncoding = %v, want [chunked]", transferEncoding)
	}
	if contentLength != -1 {
		t.Fatalf("server saw ContentLength = %d, want -1 (unknown)", contentLength)
	}
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body %q)", response.StatusCode, raw)
	}
	decoded := decodeErrorBody(t, raw)
	if decoded.Error.Code != "body_too_large" {
		t.Errorf("code = %q, want body_too_large", decoded.Error.Code)
	}
	if decoded.Error.RequestID == "" {
		t.Error("error body carries no request_id")
	}
}

func TestHostAllowlistRejectsAnUnknownHost(t *testing.T) {
	handler := core.WithRequestID(core.WithHostAllowlist(
		[]string{"localhost", "127.0.0.1", "[::1]", "norte.example"},
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })))

	allowed := []string{
		"localhost", "localhost:8080",
		"127.0.0.1", "127.0.0.1:8080",
		"[::1]", "[::1]:8080",
		"norte.example", "norte.example:8080",
	}
	for _, host := range allowed {
		request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		request.Host = host
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Errorf("Host %q: status = %d, want 200", host, recorder.Code)
		}
	}

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "evil.example"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMisdirectedRequest {
		t.Fatalf("Host evil.example: status = %d, want 421", recorder.Code)
	}
	if decoded := decodeErrorBody(t, recorder.Body.Bytes()); decoded.Error.Code != "host_not_allowed" {
		t.Errorf("code = %q, want host_not_allowed", decoded.Error.Code)
	}
}

func TestRequestIDIsGeneratedAndEchoed(t *testing.T) {
	var seen string
	handler := core.WithRequestID(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = core.RequestIDFromContext(r.Context())
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if seen == "" {
		t.Fatal("no request id reached the handler")
	}
	if got := recorder.Header().Get(core.RequestIDHeader); got != seen {
		t.Errorf("%s = %q, want the handler's id %q", core.RequestIDHeader, got, seen)
	}

	recorder = httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set(core.RequestIDHeader, "client-supplied")
	handler.ServeHTTP(recorder, request)
	if seen != "client-supplied" {
		t.Errorf("request id = %q, want the client's own", seen)
	}
}

func TestAccessLogRecordsTheRequestWithoutItsQueryStringOrBody(t *testing.T) {
	var logged bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logged, nil))
	handler := core.WithRequestID(core.WithAccessLog(logger,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusCreated)
		})))

	request := httptest.NewRequest(http.MethodPost, "/api/health?token=tokenvalue", strings.NewReader("bodyvalue"))
	handler.ServeHTTP(httptest.NewRecorder(), request)

	var line map[string]any
	if err := json.Unmarshal(logged.Bytes(), &line); err != nil {
		t.Fatalf("log line is not JSON: %v (%q)", err, logged.String())
	}
	if line["method"] != http.MethodPost {
		t.Errorf("method = %v, want POST", line["method"])
	}
	if line["path"] != "/api/health" {
		t.Errorf("path = %v, want /api/health without the query string", line["path"])
	}
	if line["status"] != float64(http.StatusCreated) {
		t.Errorf("status = %v, want 201", line["status"])
	}
	if _, ok := line["duration_ms"]; !ok {
		t.Error("log line has no duration_ms")
	}
	if id, _ := line["request_id"].(string); id == "" {
		t.Error("log line has no request_id")
	}
	for _, forbidden := range []string{"tokenvalue", "bodyvalue"} {
		if strings.Contains(logged.String(), forbidden) {
			t.Errorf("log line leaks %q: %s", forbidden, logged.String())
		}
	}
}

func TestSecurityHeadersSetTheExactContentSecurityPolicy(t *testing.T) {
	const want = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

	handler := core.WithSecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

	if got := recorder.Header().Get("Content-Security-Policy"); got != want {
		t.Errorf("Content-Security-Policy =\n%q\nwant\n%q", got, want)
	}
}

func TestPanicRecoveryAnswersTheErrorShape(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	handler := core.WithRequestID(core.WithPanicRecovery(logger,
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") })))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	if decoded := decodeErrorBody(t, recorder.Body.Bytes()); decoded.Error.RequestID == "" {
		t.Error("error body carries no request_id")
	}
}
