package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	_ "github.com/gabrielassisxyz/norte/server/internal/library"
	_ "github.com/gabrielassisxyz/norte/server/internal/notes"
)

// norteLoggedError is one line of the server's JSON log, read back with the
// fields a reported failure has to be findable by.
type norteLoggedError struct {
	Level     string `json:"level"`
	Message   string `json:"msg"`
	Path      string `json:"path"`
	RequestID string `json:"request_id"`
	Error     string `json:"error"`
}

// norteBrokenStorageHarness is the real router over a real migrated database
// whose handles have been closed, so that every endpoint below fails the way a
// handler fails in production: inside the storage it was handed, with an error
// the contract has no response for.
//
// A closed handle is used rather than a stub service because the three
// modules' handlers are what is under test, not their storage: each one
// returns the error it could not answer, and whether that error reaches the
// log is a property of the mounting, which only the real router has.
type norteBrokenStorageHarness struct {
	router http.Handler
	log    *bytes.Buffer
}

func newNorteBrokenStorageHarness(t *testing.T) *norteBrokenStorageHarness {
	t.Helper()
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	cfg, _, err := app.Load(app.LoadOptions{
		LookupEnv: envLookupFromMap(map[string]string{"NORTE_MODULES": "library,notes"}),
		Home:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	modules, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		t.Fatalf("ResolveNorteModules: %v", err)
	}
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	if _, err := app.MigrateNorteModules(context.Background(), database.Writer(), modules); err != nil {
		t.Fatalf("applying the module migrations: %v", err)
	}

	recorded := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(recorded, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cfg.Data = dataDir
	_, deps := app.BuildNorteRuntime(cfg, database, clocktest.New(time.Unix(0, 0).UTC()), logger, modules)

	router, err := app.NewRouter(app.RouterOptions{
		Config:     cfg,
		Logger:     logger,
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Norte</title>")}},
		Modules:    modules,
		ModuleDeps: deps,
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	// Closed only once the routes are mounted: mounting reads nothing, and a
	// handle closed earlier would make a migration the failure instead.
	if err := database.Close(context.Background()); err != nil {
		t.Fatalf("closing the database: %v", err)
	}
	return &norteBrokenStorageHarness{router: router, log: recorded}
}

// get sends one GET at the router with a Host the allowlist accepts, and hands
// back the answer together with the request id it was answered under.
func (h *norteBrokenStorageHarness) get(t *testing.T, path string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = "localhost:8080"
	recorder := httptest.NewRecorder()
	h.router.ServeHTTP(recorder, request)
	return recorder, recorder.Header().Get(core.RequestIDHeader)
}

// errorLineFor finds the ERROR line written under one request id. There is no
// other way round: the generic body is all the client is given, so the id is
// the only thing the two share.
func (h *norteBrokenStorageHarness) errorLineFor(t *testing.T, requestID string) norteLoggedError {
	t.Helper()
	if requestID == "" {
		t.Fatal("the response carried no X-Request-Id, so no log line can be matched to it")
	}
	for _, line := range strings.Split(h.log.String(), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry norteLoggedError
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("the server wrote a log line that is not JSON: %v (%q)", err, line)
		}
		if entry.Level == "ERROR" && entry.RequestID == requestID {
			return entry
		}
	}
	t.Fatalf("no ERROR line carries request id %s; the log held:\n%s", requestID, h.log.String())
	return norteLoggedError{}
}

// TestAnInternalErrorIsLoggedWithItsCause covers one endpoint per module. The
// three mount their own generated routes, so each one wires its own handler
// error path, and a cause logged by the core proves nothing about the library
// or about notes.
func TestAnInternalErrorIsLoggedWithItsCause(t *testing.T) {
	for _, path := range []string{
		"/api/core/subjects",
		"/api/library/counts",
		"/api/notes/counts",
	} {
		t.Run(path, func(t *testing.T) {
			harness := newNorteBrokenStorageHarness(t)
			response, requestID := harness.get(t, path)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body %q)", response.Code, response.Body.String())
			}

			var envelope core.ErrorBody
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("body is not the error envelope: %v (%q)", err, response.Body.String())
			}
			if envelope.Error.Code != "internal" || envelope.Error.Message != "internal error" {
				t.Errorf("body said %q / %q, want the generic internal error",
					envelope.Error.Code, envelope.Error.Message)
			}
			// The body is what a stranger on the network reads, so the cause
			// belongs in the log and nowhere else.
			if strings.Contains(response.Body.String(), "database is closed") {
				t.Errorf("the response leaked the cause: %q", response.Body.String())
			}

			entry := harness.errorLineFor(t, requestID)
			if entry.Path != path {
				t.Errorf("the logged path is %q, want %q", entry.Path, path)
			}
			if !strings.Contains(entry.Error, "database is closed") {
				t.Errorf("the logged error is %q, want the cause the handler reported", entry.Error)
			}
		})
	}
}
