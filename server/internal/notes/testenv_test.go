package notes

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	_ "github.com/gabrielassisxyz/norte/server/internal/library"
)

// notesFixedInstant is the deterministic now the notes tests run on, so an
// ordering assertion never depends on how fast the machine is.
var notesFixedInstant = time.Date(2026, 10, 8, 20, 0, 0, 0, time.UTC)

// notesWorkerStep is one of the worker's polls, which is how far the manual
// clock moves when a test is waiting for the queue to come round.
const notesWorkerStep = time.Second

// notesHarness is a whole server wired the way serve wires one, over a
// database of the test's own.
//
// The library is enabled alongside notes in the default harness, because half
// of what this module does is react to the library: the extraction event, the
// text a highlight anchors against, and the registry row a note renders its
// origin from. The notes-only harness is the same thing with that module left
// out, which is how "Notas still lists them with titles from the registry" is
// proved rather than asserted.
type notesHarness struct {
	t        *testing.T
	database *core.Database
	dataDir  string
	clock    *clocktest.Clock
	deps     app.Deps
	modules  []app.Module
	service  *NotesService
	router   http.Handler
}

// newNotesHarness wires the enabled modules over one database. An empty list of
// names means library and notes both.
func newNotesHarness(t *testing.T, names ...string) *notesHarness {
	t.Helper()
	if len(names) == 0 {
		names = []string{"library", "notes"}
	}
	clock := clocktest.New(notesFixedInstant)
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

	cfg, _, err := app.Load(app.LoadOptions{
		LookupEnv: func(name string) (string, bool) {
			if name == "NORTE_MODULES" {
				return notesJoin(names), true
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
		t.Fatalf("ResolveNorteModules: %v", err)
	}
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	if _, err := app.MigrateNorteModules(context.Background(), database.Writer(), modules); err != nil {
		t.Fatalf("applying the module migrations: %v", err)
	}

	queue := core.NewJobs(database.Writer(), clock, nil)
	texts := core.NewTexts(database.Reader(), nil)
	deps := app.Deps{
		Database:      database,
		Jobs:          queue,
		Files:         core.NewFiles(dataDir, database.Writer(), clock),
		Clock:         clock,
		Events:        core.NewEvents(),
		Texts:         texts,
		Logger:        slog.New(slog.NewJSONHandler(io.Discard, nil)),
		FetchMaxBytes: 1 << 20,
	}
	texts.SetProviders(app.NorteTextProviders(modules, deps))
	app.RegisterNorteJobHandlers(queue, modules, deps)
	// The same subscription Start installs, without an adapter the test would
	// then have to shut down. TestStartSubscribesToTheExtractionEvent is what
	// proves Start installs this one.
	if notesEnabled(names) {
		notesSubscribeToExtractions(deps)
	}

	handler, err := app.NewRouter(app.RouterOptions{
		Config:     cfg,
		Logger:     deps.Logger,
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Norte</title>")}},
		Modules:    modules,
		ModuleDeps: deps,
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return &notesHarness{
		t:        t,
		database: database,
		dataDir:  dataDir,
		clock:    clock,
		deps:     deps,
		modules:  modules,
		service:  NewNotesService(database, queue, clock, texts),
		router:   handler,
	}
}

func notesJoin(names []string) string {
	joined := ""
	for i, name := range names {
		if i > 0 {
			joined += ","
		}
		joined += name
	}
	return joined
}

func notesEnabled(names []string) bool {
	for _, name := range names {
		if name == ModuleName {
			return true
		}
	}
	return false
}

// request sends one JSON request at the harness's real router with an allowed
// Host. A nil body sends no body at all.
func (h *notesHarness) request(method, path string, body any) *httptest.ResponseRecorder {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.t.Fatalf("encoding the request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Host = "localhost:8080"
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	h.router.ServeHTTP(recorder, request)
	return recorder
}

// decode reads a successful answer, failing the test with the body when the
// status is not the one expected -- the error envelope is what says why.
func notesDecode[T any](t *testing.T, recorder *httptest.ResponseRecorder, want int) T {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("status %d, want %d: %s", recorder.Code, want, recorder.Body.String())
	}
	var decoded T
	if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decoding the answer: %v: %s", err, recorder.Body.String())
	}
	return decoded
}

// registerItem puts a row in the item registry, which is what a note points at.
// The module name is the caller's, so a test can register an item owned by a
// module that is not enabled.
func (h *notesHarness) registerItem(module, itemType, title string) string {
	h.t.Helper()
	id := core.NewID()
	tx, err := h.database.Writer().Begin()
	if err != nil {
		h.t.Fatalf("beginning a transaction: %v", err)
	}
	if err := core.RegisterItem(context.Background(), tx, core.ItemRegistration{
		ID:        id,
		Module:    module,
		Type:      itemType,
		Title:     title,
		CreatedAt: notesFixedInstant,
	}); err != nil {
		_ = tx.Rollback()
		h.t.Fatalf("registering an item: %v", err)
	}
	if err := tx.Commit(); err != nil {
		h.t.Fatalf("committing the registration: %v", err)
	}
	return id
}

// saveArticle puts an extracted article in the library, the way a save followed
// by a finished extraction leaves one.
//
// It writes the row rather than running the extraction, because what the notes
// tests are about is the text a passage anchors against: the extraction itself
// is the library suite's subject, and the path from a real extraction through
// the event to the re-anchoring has a test of its own.
func (h *notesHarness) saveArticle(title, text string) string {
	h.t.Helper()
	id := h.registerItem("library", "article", title)
	stamp := core.FormatTime(notesFixedInstant)
	_, err := h.database.Writer().Exec(
		`INSERT INTO library_items (
			id, kind, url, canonical_url, title, title_edited, location, unread,
			saved_at, source, content_text, extract_status, extract_generation,
			extracted_at, meta, created_at, updated_at
		) VALUES (?, 'article', ?, ?, ?, 0, 'inbox', 1, ?, 'app', ?, 'done', 1, ?, '{}', ?, ?)`,
		id, "https://example.invalid/"+id, "https://example.invalid/"+id, title,
		stamp, text, stamp, stamp, stamp)
	if err != nil {
		h.t.Fatalf("writing a library item: %v", err)
	}
	return id
}

// setArticleText is a re-extraction's effect on the text, for a test that then
// asks what re-anchoring makes of it.
func (h *notesHarness) setArticleText(id, text string) {
	h.t.Helper()
	if _, err := h.database.Writer().Exec(
		`UPDATE library_items SET content_text = ?, extract_generation = extract_generation + 1 WHERE id = ?`,
		text, id); err != nil {
		h.t.Fatalf("rewriting the text of %s: %v", id, err)
	}
}

// drainJobs runs the real worker until the queue holds nothing runnable, so a
// test exercises the path production takes rather than calling a handler.
func (h *notesHarness) drainJobs() {
	h.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	worker := core.NewJobsWorker(h.deps.Jobs, h.clock, h.deps.Logger, core.NewID())
	done := make(chan struct{})
	go func() {
		_ = worker.Run(ctx)
		close(done)
	}()
	deadline := time.Now().Add(20 * time.Second)
	for h.outstandingJobs() > 0 {
		if time.Now().After(deadline) {
			h.t.Fatalf("the worker never drained the queue: %d jobs left", h.outstandingJobs())
		}
		h.clock.Advance(notesWorkerStep)
		// A short real pause lets the worker's goroutine run; the clock is
		// what makes progress, and this only yields the processor.
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
	<-done
}

func (h *notesHarness) outstandingJobs() int {
	h.t.Helper()
	var count int
	if err := h.database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_jobs WHERE status IN ('queued', 'running')`).Scan(&count); err != nil {
		h.t.Fatalf("counting the outstanding jobs: %v", err)
	}
	return count
}

// publishExtracted is the library's own publish, as the notes subscriber sees
// it: identifiers and nothing else.
func (h *notesHarness) publishExtracted(itemID string) {
	h.t.Helper()
	if err := h.deps.Events.Publish(context.Background(), core.Event{
		Name:    notesLibraryItemExtractedEvent,
		Payload: map[string]string{"item_id": itemID},
	}); err != nil {
		h.t.Fatalf("publishing %s: %v", notesLibraryItemExtractedEvent, err)
	}
}

func (h *notesHarness) highlightStatus(id string) (string, int64) {
	h.t.Helper()
	var status string
	var hint int64
	if err := h.database.Reader().QueryRow(
		`SELECT status, position_hint FROM notes_highlights WHERE id = ?`, id).Scan(&status, &hint); err != nil {
		h.t.Fatalf("reading the highlight %s: %v", id, err)
	}
	return status, hint
}
