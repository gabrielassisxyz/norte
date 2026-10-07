package app

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

func testRouter(t *testing.T) http.Handler {
	t.Helper()
	cfg, _, err := Load(LoadOptions{Env: envFromMap(nil), Home: t.TempDir()})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return NewRouter(RouterOptions{
		Config: cfg,
		Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Assets: fstest.MapFS{
			"index.html":    {Data: []byte("<!doctype html><title>Norte</title>")},
			"assets/app.js": {Data: []byte("export default 1\n")},
		},
	})
}

// get sends a request through the router with an allowed Host.
func get(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = "localhost:8080"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestHealthReturnsOK(t *testing.T) {
	response := get(t, testRouter(t), "/api/health")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("health body is not JSON: %v (%q)", err, response.Body.String())
	}
	if body["status"] != "ok" {
		t.Errorf("body = %v, want status ok", body)
	}
}

func TestUnknownAPIPathReturnsTheJSONErrorShape(t *testing.T) {
	response := get(t, testRouter(t), "/api/nope")
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.Code)
	}
	var decoded core.ErrorBody
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("body is not the error shape: %v (%q)", err, response.Body.String())
	}
	if decoded.Error.Code != "not_found" {
		t.Errorf("code = %q, want not_found", decoded.Error.Code)
	}
	if decoded.Error.RequestID == "" {
		t.Error("error body carries no request_id")
	}
}

func TestFrontendServesFilesAndFallsBackToIndexForDeepLinks(t *testing.T) {
	handler := testRouter(t)

	root := get(t, handler, "/")
	if root.Code != http.StatusOK || !strings.Contains(root.Body.String(), "<title>Norte</title>") {
		t.Fatalf("/ = %d %q, want the frontend index", root.Code, root.Body.String())
	}

	asset := get(t, handler, "/assets/app.js")
	if asset.Code != http.StatusOK || !strings.Contains(asset.Body.String(), "export default 1") {
		t.Fatalf("/assets/app.js = %d %q, want the asset itself", asset.Code, asset.Body.String())
	}

	deep := get(t, handler, "/biblioteca")
	if deep.Code != http.StatusOK {
		t.Fatalf("/biblioteca = %d, want 200 from the history fallback", deep.Code)
	}
	if !strings.Contains(deep.Body.String(), "<title>Norte</title>") {
		t.Errorf("/biblioteca body = %q, want the frontend index", deep.Body.String())
	}
}

func TestEveryResponseCarriesTheContentSecurityPolicy(t *testing.T) {
	handler := testRouter(t)

	for _, path := range []string{"/", "/biblioteca", "/api/health", "/api/nope"} {
		if got := get(t, handler, path).Header().Get("Content-Security-Policy"); got != core.ContentSecurityPolicy {
			t.Errorf("%s: Content-Security-Policy = %q, want %q", path, got, core.ContentSecurityPolicy)
		}
	}

	rejected := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rejected.Host = "evil.example"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, rejected)
	if recorder.Code != http.StatusMisdirectedRequest {
		t.Fatalf("Host evil.example: status = %d, want 421", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Security-Policy"); got != core.ContentSecurityPolicy {
		t.Errorf("a rejected request got Content-Security-Policy = %q", got)
	}
}

func TestRouterRejectsAnUnknownHostBeforeReachingAHandler(t *testing.T) {
	handler := testRouter(t)
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "evil.example"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMisdirectedRequest {
		t.Fatalf("status = %d, want 421", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "\"status\":\"ok\"") {
		t.Error("the health handler ran for a disallowed Host")
	}
}

func TestTestOnlyRoutesAreAbsentUnlessAskedFor(t *testing.T) {
	response := get(t, testRouter(t), "/api/test/hold?ms=0")
	if response.Code != http.StatusNotFound {
		t.Fatalf("/api/test/hold = %d, want 404 when test routes are off", response.Code)
	}
}
