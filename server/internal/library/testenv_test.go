package library

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

// libraryFixedInstant is the deterministic now the library tests run on, so
// ordering assertions never depend on how fast the machine is.
var libraryFixedInstant = time.Date(2026, 10, 7, 21, 0, 0, 0, time.UTC)

// newLibraryTestDB opens a migrated database in a directory of the test's own
// and closes it through the shutdown path when the test ends.
func newLibraryTestDB(t *testing.T, clock core.Clock) (*core.Database, string) {
	t.Helper()
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	if _, err := app.MigrateNorteModules(context.Background(), database.Writer(),
		[]app.Module{NewLibraryModule()}); err != nil {
		t.Fatalf("applying the library migrations: %v", err)
	}
	return database, dataDir
}

// newLibraryTestService wires the service the way serve does, over the test's
// clock.
func newLibraryTestService(t *testing.T, database *core.Database, dataDir string, clock core.Clock) *LibraryService {
	t.Helper()
	return NewLibraryService(database,
		core.NewFiles(dataDir, database.Writer(), clock),
		core.NewJobs(database.Writer(), clock, nil),
		clock)
}

// newLibraryTestRouter builds the real router with the library enabled, so
// the HTTP tests prove what production serves rather than a fixture of it.
func newLibraryTestRouter(t *testing.T, database *core.Database, dataDir string, clock core.Clock) http.Handler {
	t.Helper()
	cfg, _, err := app.Load(app.LoadOptions{
		LookupEnv: func(name string) (string, bool) {
			if name == "NORTE_MODULES" {
				return "library", true
			}
			return "", false
		},
		Home: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	modules, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	handler, err := app.NewRouter(app.RouterOptions{
		Config: cfg,
		Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Assets: fstest.MapFS{
			"index.html": {Data: []byte("<!doctype html><title>Norte</title>")},
		},
		Modules: modules,
		ModuleDeps: app.Deps{
			Database: database,
			Jobs:     core.NewJobs(database.Writer(), clock, nil),
			Files:    core.NewFiles(dataDir, database.Writer(), clock),
			Clock:    clock,
		},
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return handler
}

// doLibraryRequest sends one JSON request at the test router with an allowed
// Host. A nil body sends no body at all.
func doLibraryRequest(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encoding the request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Host = "localhost:8080"
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

// runLibraryCLI drives the real command line in this process against a data
// directory of the test's own. The environment is pinned so the command
// cannot reach the config file or the data directory of whoever runs it.
func runLibraryCLI(t *testing.T, dataDir string, args ...string) (string, error) {
	t.Helper()
	t.Setenv("NORTE_DATA", dataDir)
	t.Setenv("NORTE_MODULES", "library")
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(t.TempDir(), "config"))
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	root := app.NewRootCommand()
	root.SetArgs(args)
	root.SetOut(&out)
	root.SetErr(&out)
	if err := root.ExecuteContext(context.Background()); err != nil {
		return out.String(), err
	}
	return out.String(), nil
}

// libraryTestClock returns a manual clock reading the fixed instant.
func libraryTestClock() *clocktest.Clock {
	return clocktest.New(libraryFixedInstant)
}
