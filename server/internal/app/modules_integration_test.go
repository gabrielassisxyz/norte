package app_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
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
)

// norteIntegrationRouter builds the real router for one NORTE_MODULES value
// plus extra environment, against a throwaway frontend.
func norteIntegrationRouter(t *testing.T, modules string, extra map[string]string) (http.Handler, *app.Config) {
	t.Helper()
	values := map[string]string{"NORTE_MODULES": modules}
	for key, value := range extra {
		values[key] = value
	}
	cfg, _, err := app.Load(app.LoadOptions{LookupEnv: envLookupFromMap(values), Home: t.TempDir()})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	resolved, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	handler, err := app.NewRouter(app.RouterOptions{
		Config: cfg,
		Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Assets: fstest.MapFS{
			"index.html": {Data: []byte("<!doctype html><title>Norte</title>")},
		},
		Modules: resolved,
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return handler, cfg
}

func norteIntegrationGetConfig(t *testing.T, handler http.Handler) map[string]any {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	request.Host = "localhost:8080"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /api/config = %d, want 200 (body %q)", recorder.Code, recorder.Body.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("config body is not JSON: %v (%q)", err, recorder.Body.String())
	}
	return decoded
}

func TestNorteConfigAnswersForLibraryAndEmpty(t *testing.T) {
	libraryHandler, _ := norteIntegrationRouter(t, "library", nil)
	libraryBody := norteIntegrationGetConfig(t, libraryHandler)
	modules, ok := libraryBody["modules"].([]any)
	if !ok || len(modules) != 1 || modules[0] != "library" {
		t.Errorf("library config modules = %v, want [library]", libraryBody["modules"])
	}
	for _, key := range []string{"version", "llm", "telegram", "timezone"} {
		if _, ok := libraryBody[key]; !ok {
			t.Errorf("library config misses %q: %v", key, libraryBody)
		}
	}

	emptyHandler, _ := norteIntegrationRouter(t, "", nil)
	emptyBody := norteIntegrationGetConfig(t, emptyHandler)
	emptyModules, ok := emptyBody["modules"].([]any)
	if !ok {
		t.Fatalf("empty config modules = %v (%T), want []", emptyBody["modules"], emptyBody["modules"])
	}
	if len(emptyModules) != 0 {
		t.Errorf("empty config modules = %v, want []", emptyBody["modules"])
	}
	// The raw JSON must be [] rather than null.
	rawRequest := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rawRequest.Host = "localhost:8080"
	rawRecorder := httptest.NewRecorder()
	emptyHandler.ServeHTTP(rawRecorder, rawRequest)
	if strings.Contains(rawRecorder.Body.String(), `"modules":null`) {
		t.Errorf("empty config encodes modules as null, want []: %s", rawRecorder.Body.String())
	}
}

func TestNorteConfigLLMAndTelegramReflectTheirSettings(t *testing.T) {
	withBoth, _ := norteIntegrationRouter(t, "library", map[string]string{
		"NORTE_LLM_URL":        "https://llm.example",
		"NORTE_TELEGRAM_TOKEN": "token",
	})
	body := norteIntegrationGetConfig(t, withBoth)
	if body["llm"] != true {
		t.Errorf("with NORTE_LLM_URL set llm = %v, want true", body["llm"])
	}
	if body["telegram"] != true {
		t.Errorf("with NORTE_TELEGRAM_TOKEN set telegram = %v, want true", body["telegram"])
	}

	without, _ := norteIntegrationRouter(t, "library", nil)
	bare := norteIntegrationGetConfig(t, without)
	if bare["llm"] != false {
		t.Errorf("without NORTE_LLM_URL llm = %v, want false", bare["llm"])
	}
	if bare["telegram"] != false {
		t.Errorf("without NORTE_TELEGRAM_TOKEN telegram = %v, want false", bare["telegram"])
	}
}

func norteIntegrationTableSet(t *testing.T, databasePath string) map[string]bool {
	t.Helper()
	present := map[string]bool{}
	for _, name := range tableNames(t, databasePath) {
		present[name] = true
	}
	return present
}

func TestNorteMigrateAppliesCoreFirstThenLibrary(t *testing.T) {
	t.Setenv("NORTE_MODULES", "library")
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	present := norteIntegrationTableSet(t, dataDir+"/norte.db")
	for _, want := range []string{"goose_core", "goose_library", "library_items", "library_fts"} {
		if !present[want] {
			t.Errorf("after library migrate %s is missing; tables hold %v", want, present)
		}
	}
	if present["library_meta"] {
		t.Errorf("after library migrate the stub's library_meta survived; tables hold %v", present)
	}
}

func TestNorteMigrateEmptyCreatesNoLibraryTables(t *testing.T) {
	t.Setenv("NORTE_MODULES", "")
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	present := norteIntegrationTableSet(t, dataDir+"/norte.db")
	for _, banned := range []string{"goose_library", "library_items", "library_fts", "library_meta"} {
		if present[banned] {
			t.Errorf("after empty migrate %s exists, want it absent", banned)
		}
	}
	if !present["goose_core"] {
		t.Errorf("after empty migrate goose_core is missing; tables hold %v", present)
	}
}

func TestNorteMigrateEmptyLeavesLibraryTablesUntouched(t *testing.T) {
	t.Setenv("NORTE_MODULES", "library")
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	versionBefore := norteIntegrationGooseVersion(t, dataDir+"/norte.db", "goose_library")

	t.Setenv("NORTE_MODULES", "")
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("empty norte migrate: %v\n%s", err, out)
	}
	present := norteIntegrationTableSet(t, dataDir+"/norte.db")
	for _, want := range []string{"goose_library", "library_items", "library_fts"} {
		if !present[want] {
			t.Errorf("empty migrate removed %s; tables hold %v", want, present)
		}
	}
	if got := norteIntegrationGooseVersion(t, dataDir+"/norte.db", "goose_library"); got != versionBefore {
		t.Errorf("goose_library moved from %s to %s under empty migrate, want it unchanged", versionBefore, got)
	}
}

func norteIntegrationGooseVersion(t *testing.T, databasePath, table string) string {
	t.Helper()
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatalf("opening %s: %v", databasePath, err)
	}
	defer func() { _ = database.Close() }()
	var version string
	if err := database.QueryRow(`SELECT version_id FROM ` + table + ` ORDER BY version_id DESC LIMIT 1`).Scan(&version); err != nil {
		t.Fatalf("reading %s: %v", table, err)
	}
	return version
}

func TestNorteUnknownModuleExitsNamingIt(t *testing.T) {
	t.Setenv("NORTE_MODULES", "nope")
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err == nil {
		t.Fatalf("norte migrate with an unknown module succeeded, want a non-zero exit\n%s", out)
	} else if !strings.Contains(err.Error(), "nope") {
		t.Errorf("migrate error = %q, want it to name nope", err.Error())
	}
	if out, err := runNorte(t, dataDir, "serve"); err == nil {
		t.Fatalf("norte serve with an unknown module succeeded, want a non-zero exit\n%s", out)
	} else if !strings.Contains(err.Error(), "nope") {
		t.Errorf("serve error = %q, want it to name nope", err.Error())
	}
}

func TestNorteModuleCommandAppearsOnlyWhenEnabled(t *testing.T) {
	t.Setenv("NORTE_MODULES", "library")
	enabledOut, err := runNorte(t, emptyDataDirPath(t), "--help")
	if err != nil {
		t.Fatalf("norte --help: %v\n%s", err, enabledOut)
	}
	if !strings.Contains(enabledOut, "library") {
		t.Errorf("--help with library enabled misses it:\n%s", enabledOut)
	}

	t.Setenv("NORTE_MODULES", "")
	disabledOut, err := runNorte(t, emptyDataDirPath(t), "--help")
	if err != nil {
		t.Fatalf("norte --help: %v\n%s", err, disabledOut)
	}
	if strings.Contains(disabledOut, "library") {
		t.Errorf("--help with no modules still lists library:\n%s", disabledOut)
	}
}

func TestNorteJobKindIsClaimedOnlyWhenEnabled(t *testing.T) {
	enabledID := norteIntegrationRunStubJob(t, "library", true)
	if status := norteIntegrationJobStatus(t, enabledID.dir, enabledID.id); status != "done" {
		t.Errorf("enabled stub job = %s, want done", status)
	}
	disabled := norteIntegrationRunStubJob(t, "", false)
	if status := norteIntegrationJobStatus(t, disabled.dir, disabled.id); status != "queued" {
		t.Errorf("disabled stub job = %s, want queued", status)
	}
}

type norteIntegrationStubJob struct {
	dir string
	id  string
}

func norteIntegrationRunStubJob(t *testing.T, modules string, enabled bool) norteIntegrationStubJob {
	t.Helper()
	t.Setenv("NORTE_MODULES", modules)
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}

	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	defer func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	}()

	clock := clocktest.New(time.Now().UTC())
	queue := core.NewJobs(database.Writer(), clock, nil)
	cfg, _, err := app.Load(app.LoadOptions{LookupEnv: envLookupFromMap(map[string]string{"NORTE_MODULES": modules}), Home: t.TempDir()})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	resolved, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	app.RegisterNorteJobHandlers(queue, resolved)

	ctx := context.Background()
	tx, err := database.Writer().BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("beginning the enqueue transaction: %v", err)
	}
	id, err := queue.Enqueue(ctx, tx, "library.stub", "{}", "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("enqueueing the stub job: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("committing the enqueue: %v", err)
	}

	worker := core.NewJobsWorker(queue, clock, nil, core.NewID())
	workerCtx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(workerCtx) }()
	// The worker claims immediately, before any poll timer fires, so a short
	// real wait settles the enabled case and leaves the disabled one queued.
	time.Sleep(300 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the worker did not stop")
	}
	_ = enabled
	return norteIntegrationStubJob{dir: dataDir, id: id}
}

func norteIntegrationJobStatus(t *testing.T, dataDir, id string) string {
	t.Helper()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	defer func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	}()
	var status string
	if err := database.Reader().QueryRow(`SELECT status FROM core_jobs WHERE id = ?`, id).Scan(&status); err != nil {
		t.Fatalf("reading job %s: %v", id, err)
	}
	return status
}
