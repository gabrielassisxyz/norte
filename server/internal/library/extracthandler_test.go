package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// libraryExtractHarness is a whole library, wired the way serve wires one, over
// a database and a file store of the test's own and a fetcher that reaches only
// the test's listener.
type libraryExtractHarness struct {
	t          *testing.T
	database   *core.Database
	dataDir    string
	clock      *clocktest.Clock
	files      *core.Files
	jobs       *core.Jobs
	events     *core.Events
	service    *LibraryService
	extraction *LibraryExtraction
	probe      *libraryFetchProbe
	server     *httptest.Server
}

// libraryHarnessOptions says what the extraction under test is given.
type libraryHarnessOptions struct {
	// FetchHandler, when set, is served at the test hostname. Names maps extra
	// hostnames the resolver answers for, on top of the test host.
	FetchHandler http.Handler
	Names        map[string][]string
	MaxBytes     int64
	LLM          bool
}

func newLibraryExtractHarness(t *testing.T, opts libraryHarnessOptions) *libraryExtractHarness {
	t.Helper()
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	files := core.NewFiles(dataDir, database.Writer(), clock)
	jobs := core.NewJobs(database.Writer(), clock, nil)
	events := core.NewEvents()
	harness := &libraryExtractHarness{
		t:        t,
		database: database,
		dataDir:  dataDir,
		clock:    clock,
		files:    files,
		jobs:     jobs,
		events:   events,
		service:  NewLibraryService(database, files, jobs, clock),
		probe:    &libraryFetchProbe{},
	}

	names := map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}}
	for name, addrs := range opts.Names {
		names[name] = addrs
	}
	listener := "127.0.0.1:1"
	if opts.FetchHandler != nil {
		harness.server = httptest.NewServer(opts.FetchHandler)
		t.Cleanup(harness.server.Close)
		listener = harness.server.Listener.Addr().String()
	}
	maxBytes := opts.MaxBytes
	if maxBytes == 0 {
		maxBytes = 1 << 20
	}
	harness.extraction = NewLibraryExtraction(LibraryExtractionOptions{
		Database:      database,
		Files:         files,
		Jobs:          jobs,
		Clock:         clock,
		Events:        events,
		Fetcher:       libraryTestFetcher(t, maxBytes, names, listener, harness.probe),
		LLMConfigured: opts.LLM,
	})
	return harness
}

// save puts an item in the library the way a request would.
func (h *libraryExtractHarness) save(pageURL string, html []byte) string {
	h.t.Helper()
	return h.saveFrom(pageURL, html, LibrarySourceCLI)
}

// saveFrom is save for a test that needs the capturer to be a particular one,
// because the snapshot the save stores and the one it replaces both depend on
// who captured the bytes.
func (h *libraryExtractHarness) saveFrom(pageURL string, html []byte, source string) string {
	h.t.Helper()
	outcome, err := h.service.Save(context.Background(), SaveInput{
		URL:    pageURL,
		HTML:   html,
		Source: source,
	})
	if err != nil {
		h.t.Fatalf("saving %s: %v", pageURL, err)
	}
	return outcome.ID
}

func (h *libraryExtractHarness) item(id string) db.LibraryItem {
	h.t.Helper()
	row, err := db.New(h.database.Reader()).GetLibraryItemByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("reading item %s: %v", id, err)
	}
	return row
}

// run calls the handler the way the worker would, with the attempt the caller
// is exercising.
func (h *libraryExtractHarness) run(id string, generation int64, refresh bool, attempt int) error {
	h.t.Helper()
	payload, err := json.Marshal(map[string]any{
		"item_id": id, "generation": generation, "refresh": refresh,
	})
	if err != nil {
		h.t.Fatalf("encoding the payload: %v", err)
	}
	return h.extraction.Handle(context.Background(), core.Job{
		ID:          "job-" + id,
		Kind:        LibraryExtractJobKind,
		Payload:     string(payload),
		Attempt:     attempt,
		MaxAttempts: core.JobsMaxAttempts,
	})
}

// enqueuedExtractPayload reads back the payload of the job a save or a retry
// queued for one generation. A test that builds the payload itself proves
// nothing about what was enqueued, which is exactly how a save that asked for a
// download stayed invisible to a green suite.
func (h *libraryExtractHarness) enqueuedExtractPayload(id string, generation int64) string {
	h.t.Helper()
	var payload string
	if err := h.database.Reader().QueryRow(
		`SELECT payload FROM core_jobs WHERE kind = ? AND dedupe_key = ?`,
		LibraryExtractJobKind, fmt.Sprintf("extract:%s:%d", id, generation)).Scan(&payload); err != nil {
		h.t.Fatalf("reading the enqueued extract job of %s generation %d: %v", id, generation, err)
	}
	return payload
}

// runAsEnqueued runs the handler over the payload that is in the jobs table,
// which is the only way to exercise what the save actually asked for.
func (h *libraryExtractHarness) runAsEnqueued(id string, generation int64, attempt int) error {
	h.t.Helper()
	return h.extraction.Handle(context.Background(), core.Job{
		ID:          "job-" + id,
		Kind:        LibraryExtractJobKind,
		Payload:     h.enqueuedExtractPayload(id, generation),
		Attempt:     attempt,
		MaxAttempts: core.JobsMaxAttempts,
	})
}

// runToCompletion runs every attempt the worker would, so a handler that only
// gives up on its last one gets there.
func (h *libraryExtractHarness) runToCompletion(id string, generation int64, refresh bool) error {
	h.t.Helper()
	var err error
	for attempt := 1; attempt <= core.JobsMaxAttempts; attempt++ {
		err = h.run(id, generation, refresh, attempt)
		if err == nil || core.IsPermanent(err) {
			return err
		}
	}
	return err
}

func (h *libraryExtractHarness) countJobs(kind string) int {
	h.t.Helper()
	var count int
	if err := h.database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_jobs WHERE kind = ?`, kind).Scan(&count); err != nil {
		h.t.Fatalf("counting %s jobs: %v", kind, err)
	}
	return count
}

func (h *libraryExtractHarness) countSnapshotRefs(id string) int {
	h.t.Helper()
	var count int
	if err := h.database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_file_refs WHERE owner_id = ? AND kind = 'snapshot'`, id).Scan(&count); err != nil {
		h.t.Fatalf("counting snapshot references: %v", err)
	}
	return count
}

func (h *libraryExtractHarness) setMeta(id string, meta map[string]any) {
	h.t.Helper()
	encoded, err := json.Marshal(meta)
	if err != nil {
		h.t.Fatalf("encoding meta: %v", err)
	}
	if _, err := h.database.Writer().Exec(
		`UPDATE library_items SET meta = ? WHERE id = ?`, string(encoded), id); err != nil {
		h.t.Fatalf("setting meta: %v", err)
	}
}

func (h *libraryExtractHarness) setColumn(id, column string, value any) {
	h.t.Helper()
	if _, err := h.database.Writer().Exec(
		fmt.Sprintf(`UPDATE library_items SET %s = ? WHERE id = ?`, column), value, id); err != nil {
		h.t.Fatalf("setting %s: %v", column, err)
	}
}

// libraryServeFixture serves one of the corpus fixtures as a real page.
func libraryServeFixture(t *testing.T, name string) http.Handler {
	t.Helper()
	page, err := os.ReadFile("testdata/pages/" + name + ".html")
	if err != nil {
		t.Fatalf("reading the %s fixture: %v", name, err)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(page)
	})
}

// TestARefusedFetchFailsTheItemOnTheFirstAttempt covers the four refusals the
// bead names, each through the whole handler: the item ends failed after one
// attempt, with a reason on the row that carries no query string.
func TestARefusedFetchFailsTheItemOnTheFirstAttempt(t *testing.T) {
	const oneMegabyte = 1 << 20
	hugeBody := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		filler := strings.Repeat("a", oneMegabyte)
		for written := 0; written < 30*oneMegabyte; written += oneMegabyte {
			if _, err := w.Write([]byte(filler)); err != nil {
				return
			}
		}
	})
	redirectToPrivate := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://10.0.0.5/metadata", http.StatusFound)
	})

	for _, tc := range []struct {
		name     string
		pageURL  string
		handler  http.Handler
		maxBytes int64
		names    map[string][]string
	}{
		{
			name:    "a loopback literal",
			pageURL: "http://127.0.0.1/?token=secret-value",
		},
		{
			name:    "a hostname resolving to a private address",
			pageURL: "http://internal.test/doc?token=secret-value",
			names:   map[string][]string{"internal.test": {"10.0.0.5"}},
		},
		{
			name:    "a redirect chain ending at a private address",
			pageURL: "http://" + libraryFetchTestHost + "/start?token=secret-value",
			handler: redirectToPrivate,
		},
		{
			name: "a body over the cap",
			// The default NORTE_FETCH_MAX_BYTES, which is what the bead names.
			pageURL:  "http://" + libraryFetchTestHost + "/huge?token=secret-value",
			handler:  hugeBody,
			maxBytes: 20 * 1024 * 1024,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryExtractHarness(t, libraryHarnessOptions{
				FetchHandler: tc.handler,
				Names:        tc.names,
				MaxBytes:     tc.maxBytes,
			})
			id := harness.save(tc.pageURL, nil)

			err := harness.run(id, 1, false, 1)
			if err == nil {
				t.Fatal("the extraction succeeded")
			}
			if !core.IsPermanent(err) {
				t.Errorf("the error is retryable, so the worker would try twice more: %v", err)
			}

			row := harness.item(id)
			if row.ExtractStatus != "failed" {
				t.Errorf("extract_status = %q after one attempt, want failed", row.ExtractStatus)
			}
			if !row.ExtractError.Valid || row.ExtractError.String == "" {
				t.Fatal("extract_error is empty, so the screen has nothing to show")
			}
			for _, secret := range []string{"secret-value", "token="} {
				if strings.Contains(row.ExtractError.String, secret) {
					t.Errorf("extract_error carries %q: %s", secret, row.ExtractError.String)
				}
			}
			if row.ContentHtml.Valid {
				t.Errorf("a refused fetch still wrote content_html: %q", row.ContentHtml.String)
			}
		})
	}
}

// TestAFailingFetchStaysPendingUntilTheLastAttempt is the other side of the
// same decision: a retryable failure records the reason and keeps the item
// pending, because the screen reads pending as "still working".
func TestAFailingFetchStaysPendingUntilTheLastAttempt(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{
		FetchHandler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}),
	})
	id := harness.save("http://"+libraryFetchTestHost+"/flaky", nil)

	for attempt := 1; attempt < core.JobsMaxAttempts; attempt++ {
		if err := harness.run(id, 1, false, attempt); err == nil {
			t.Fatalf("attempt %d succeeded", attempt)
		}
		row := harness.item(id)
		if row.ExtractStatus != "pending" {
			t.Errorf("after attempt %d extract_status = %q, want pending", attempt, row.ExtractStatus)
		}
		if !row.ExtractError.Valid {
			t.Errorf("after attempt %d extract_error is empty", attempt)
		}
	}
	if err := harness.run(id, 1, false, core.JobsMaxAttempts); err == nil {
		t.Fatal("the last attempt succeeded")
	}
	if status := harness.item(id).ExtractStatus; status != "failed" {
		t.Errorf("after the last attempt extract_status = %q, want failed", status)
	}
}

// TestASuccessfulExtractionWritesEverythingAndPublishesOnce is the happy path,
// end to end, from a stored snapshot.
func TestASuccessfulExtractionWritesEverythingAndPublishesOnce(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	page, _ := os.ReadFile("testdata/pages/essay.html")
	id := harness.save("https://ortaessays.example/essays/notes-you-will-read-again", page)

	published := []core.Event{}
	harness.events.Subscribe(LibraryItemExtractedEvent, func(_ context.Context, event core.Event) error {
		// Published after the commit: the row is already done when a
		// subscriber reads it, which is what lets one react without a
		// transaction of its own.
		if status := harness.item(id).ExtractStatus; status != "done" {
			t.Errorf("a subscriber saw extract_status = %q, want done", status)
		}
		published = append(published, event)
		return nil
	})

	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the extraction failed: %v", err)
	}
	row := harness.item(id)
	if row.ExtractStatus != "done" {
		t.Fatalf("extract_status = %q, want done", row.ExtractStatus)
	}
	if !row.ExtractedAt.Valid {
		t.Error("extracted_at was not written")
	}
	if row.Title != "On Keeping Notes You Will Read Again" {
		t.Errorf("title = %q, want the extracted one", row.Title)
	}
	if !row.Author.Valid || row.Author.String != "Mariana Orta" {
		t.Errorf("author = %v, want the declared one", row.Author)
	}
	if !row.Minutes.Valid || row.Minutes.Int64 < 1 {
		t.Errorf("minutes = %v, want at least 1", row.Minutes)
	}
	if !row.ContentHeadings.Valid || !strings.Contains(row.ContentHeadings.String, "what-a-note-is-for") {
		t.Errorf("content_headings = %v, want the anchors", row.ContentHeadings)
	}
	// The registry row follows the title, or a link to this item renders the
	// tab title the save started with.
	var registered string
	if err := harness.database.Reader().QueryRow(
		`SELECT title FROM core_items WHERE id = ?`, id).Scan(&registered); err != nil {
		t.Fatalf("reading the registry row: %v", err)
	}
	if registered != row.Title {
		t.Errorf("the registry title = %q, want %q", registered, row.Title)
	}
	if len(published) != 1 {
		t.Errorf("the event was published %d times, want once", len(published))
	}
	if len(published) == 1 && published[0].Payload["item_id"] != id {
		t.Errorf("the event names %q, want %q", published[0].Payload["item_id"], id)
	}
}

func TestAFailedExtractionPublishesNothing(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	id := harness.save("http://127.0.0.1/private", nil)
	published := 0
	harness.events.Subscribe(LibraryItemExtractedEvent, func(context.Context, core.Event) error {
		published++
		return nil
	})
	if err := harness.run(id, 1, false, 1); err == nil {
		t.Fatal("the extraction succeeded")
	}
	if published != 0 {
		t.Errorf("a failed extraction published %d events, want 0", published)
	}
}

// TestASubscriberFailureMakesTheJobRetryAndTheReplayIsHarmless is why the
// publish happens before the handler returns and why its error is returned: the
// worker replays until every durable reaction has been enqueued, and the
// subscriber's own dedupe key makes the replay cost nothing.
func TestASubscriberFailureMakesTheJobRetryAndTheReplayIsHarmless(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	page, _ := os.ReadFile("testdata/pages/essay.html")
	id := harness.save("https://ortaessays.example/essays/notes-you-will-read-again", page)

	const reactionKind = "notes.reanchor"
	calls := 0
	harness.events.Subscribe(LibraryItemExtractedEvent, func(ctx context.Context, event core.Event) error {
		calls++
		if calls == 1 {
			return fmt.Errorf("the subscriber could not enqueue its reaction")
		}
		tx, err := harness.database.Writer().BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := harness.jobs.Enqueue(ctx, tx, reactionKind,
			`{"item_id":"`+event.Payload["item_id"]+`"}`, reactionKind+":"+event.Payload["item_id"]); err != nil {
			return err
		}
		return tx.Commit()
	})

	if err := harness.run(id, 1, false, 1); err == nil {
		t.Fatal("the handler returned nil although its subscriber failed")
	}
	before := harness.item(id)
	if before.ExtractStatus != "done" {
		t.Errorf("extract_status = %q; the extraction itself committed and must stand", before.ExtractStatus)
	}
	if harness.countJobs(reactionKind) != 0 {
		t.Fatal("the failing subscriber enqueued something after all")
	}

	// The replay the worker would run.
	if err := harness.run(id, 1, false, 2); err != nil {
		t.Fatalf("the replay failed: %v", err)
	}
	if got := harness.countJobs(reactionKind); got != 1 {
		t.Errorf("the replay left %d reaction jobs, want exactly 1", got)
	}
	after := harness.item(id)
	if after.ContentHtml.String != before.ContentHtml.String ||
		after.ContentText.String != before.ContentText.String ||
		after.ContentHeadings.String != before.ContentHeadings.String {
		t.Error("the replay changed the extraction columns")
	}
}

// TestRunningTheHandlerTwiceLeavesIdenticalColumnsAndOneClassifyJob is the
// idempotence the replay depends on.
func TestRunningTheHandlerTwiceLeavesIdenticalColumnsAndOneClassifyJob(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	page, _ := os.ReadFile("testdata/pages/bliki.html")
	id := harness.save("https://haldonsoftware.example/reversible-migration", page)

	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the first run failed: %v", err)
	}
	first := harness.item(id)
	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the second run failed: %v", err)
	}
	second := harness.item(id)

	for _, field := range []struct {
		name        string
		one, theOne string
	}{
		{"content_html", first.ContentHtml.String, second.ContentHtml.String},
		{"content_text", first.ContentText.String, second.ContentText.String},
		{"content_headings", first.ContentHeadings.String, second.ContentHeadings.String},
		{"title", first.Title, second.Title},
		{"author", first.Author.String, second.Author.String},
		{"meta", first.Meta, second.Meta},
	} {
		if field.one != field.theOne {
			t.Errorf("%s changed on the second run:\n%q\n%q", field.name, field.one, field.theOne)
		}
	}
	if got := harness.countJobs(LibraryClassifyJobKind); got != 1 {
		t.Errorf("two runs left %d classify jobs, want 1", got)
	}
}

// TestOnlyTheCurrentGenerationLands is the stale-run rule. Generation 1 is held
// after it has read its snapshot; a duplicate save installs a new snapshot as
// generation 2 and extracts it; generation 1 then finishes and must write
// nothing, publish nothing and enqueue nothing.
func TestOnlyTheCurrentGenerationLands(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	const pageURL = "https://ortaessays.example/essays/notes-you-will-read-again"
	first, _ := os.ReadFile("testdata/pages/essay.html")
	id := harness.save(pageURL, first)

	events := 0
	harness.events.Subscribe(LibraryItemExtractedEvent, func(context.Context, core.Event) error {
		events++
		return nil
	})

	// The second generation's page, so the two extractions are distinguishable
	// by their content and not only by their timing.
	second := []byte(`<!doctype html><html><head><title>The Second Snapshot</title>` +
		`<meta property="og:site_name" content="Orta Essays">` +
		`<meta name="author" content="Mariana Orta"></head><body><article><h1>The Second Snapshot</h1><p>` +
		strings.Repeat("The newer capture of the same page, with different words in it. ", 20) +
		`</p></article></body></html>`)

	// The hook parks generation 1 after it has read its snapshot. It is
	// cleared once that run is known to be inside it, so generation 2 -- which
	// is what releases it -- is not parked there too.
	reached := make(chan struct{})
	released := make(chan struct{})
	harness.extraction.afterSnapshot = func() {
		close(reached)
		<-released
	}

	staleDone := make(chan error, 1)
	go func() { staleDone <- harness.run(id, 1, false, 1) }()
	<-reached
	harness.extraction.afterSnapshot = nil

	// The duplicate save installs generation 2 while generation 1 is held.
	if sameID := harness.save(pageURL, second); sameID != id {
		t.Fatalf("the duplicate save created %s instead of folding into %s", sameID, id)
	}
	if got := harness.item(id).ExtractGeneration; got != 2 {
		t.Fatalf("extract_generation = %d after the duplicate save, want 2", got)
	}
	if err := harness.run(id, 2, false, 1); err != nil {
		t.Fatalf("generation 2 failed: %v", err)
	}
	afterCurrent := harness.item(id)

	close(released)
	if err := <-staleDone; err != nil {
		t.Fatalf("the superseded run returned an error instead of succeeding quietly: %v", err)
	}

	final := harness.item(id)
	if final.Title != "The Second Snapshot" {
		t.Errorf("title = %q, want generation 2's", final.Title)
	}
	if final.ContentHtml.String != afterCurrent.ContentHtml.String {
		t.Error("the superseded run overwrote content_html")
	}
	if final.ExtractedAt.String != afterCurrent.ExtractedAt.String {
		t.Error("the superseded run moved extracted_at")
	}
	if events != 1 {
		t.Errorf("%d events were published, want only generation 2's", events)
	}
	if got := harness.countJobs(LibraryClassifyJobKind); got != 1 {
		t.Errorf("%d classify jobs were enqueued, want only generation 2's", got)
	}
}

// TestASupersededRunThatFailsWritesNothing is the failure-side twin of the test
// above: a run that lost its generation must not mark the newer one failed or
// announce a failure to someone the newer run is about to answer.
func TestASupersededRunThatFailsWritesNothing(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	const pageURL = "https://ortaessays.example/essays/notes-you-will-read-again"
	empty := []byte(`<!doctype html><html><head><title>x</title></head><body></body></html>`)
	id := harness.save(pageURL, empty)

	reached := make(chan struct{})
	released := make(chan struct{})
	harness.extraction.afterSnapshot = func() {
		close(reached)
		<-released
	}
	staleDone := make(chan error, 1)
	go func() { staleDone <- harness.run(id, 1, false, core.JobsMaxAttempts) }()
	<-reached
	harness.extraction.afterSnapshot = nil

	second, _ := os.ReadFile("testdata/pages/essay.html")
	if sameID := harness.save(pageURL, second); sameID != id {
		t.Fatalf("the duplicate save created %s instead of folding into %s", sameID, id)
	}
	if err := harness.run(id, 2, false, 1); err != nil {
		t.Fatalf("generation 2 failed: %v", err)
	}
	// Added after generation 2 finished, so the only thing that could enqueue
	// a reply for it is the stale run's failure path.
	harness.setMeta(id, map[string]any{"telegram_messages": []any{
		map[string]any{"chat_id": 4242, "message_id": 21},
	}})
	done := harness.item(id)
	if done.ExtractStatus != "done" {
		t.Fatalf("extract_status = %q after generation 2, want done", done.ExtractStatus)
	}

	close(released)
	if err := <-staleDone; err != nil {
		t.Fatalf("the superseded run returned an error instead of succeeding quietly: %v", err)
	}

	final := harness.item(id)
	if final.ExtractStatus != "done" {
		t.Errorf("extract_status = %q, the stale failure overwrote the newer result", final.ExtractStatus)
	}
	if final.ExtractError.Valid {
		t.Errorf("extract_error = %q, the stale failure wrote a reason", final.ExtractError.String)
	}
	if final.ContentHtml.String != done.ContentHtml.String {
		t.Error("the stale failure disturbed content_html")
	}
	if got := harness.countJobs(LibraryNotifyTelegramJobKind); got != 0 {
		t.Errorf("%d notify_telegram jobs were enqueued by a superseded run, want 0", got)
	}
}

// TestAnEditedTitleSurvivesExtraction keeps the person's own words and puts the
// extractor's where the screen can offer it without overwriting anything.
func TestAnEditedTitleSurvivesExtraction(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	page, _ := os.ReadFile("testdata/pages/bliki.html")
	id := harness.save("https://haldonsoftware.example/reversible-migration", page)

	chosen := "The migration note I keep coming back to"
	if _, err := harness.service.Patch(context.Background(), id, PatchInput{Title: &chosen}); err != nil {
		t.Fatalf("retitling: %v", err)
	}
	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the extraction failed: %v", err)
	}
	row := harness.item(id)
	if row.Title != chosen {
		t.Errorf("title = %q, want the one the person chose", row.Title)
	}
	meta := libraryDecodeMeta(row.Meta)
	if meta["extracted_title"] != "Reversible Migration" {
		t.Errorf("meta.extracted_title = %v, want the extracted title", meta["extracted_title"])
	}
}

// TestAReadPositionSurvivesWhatItCan is the re-extraction rule: an anchor that
// still occurs is kept whole, and one that is gone takes only itself with it.
func TestAReadPositionSurvivesWhatItCan(t *testing.T) {
	for _, tc := range []struct {
		name       string
		anchor     string
		wantAnchor bool
	}{
		{"an anchor that still occurs", "what-a-note-is-for", true},
		{"an anchor that is gone", "a-section-that-was-removed", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
			page, _ := os.ReadFile("testdata/pages/essay.html")
			id := harness.save("https://ortaessays.example/essays/notes-you-will-read-again", page)
			harness.setColumn(id, "read_position",
				sql.NullString{String: `{"v":1,"anchor":"` + tc.anchor + `","percent":62.5}`, Valid: true})

			if err := harness.run(id, 1, false, 1); err != nil {
				t.Fatalf("the extraction failed: %v", err)
			}
			var position map[string]any
			row := harness.item(id)
			if err := json.Unmarshal([]byte(row.ReadPosition.String), &position); err != nil {
				t.Fatalf("reading the stored position %q: %v", row.ReadPosition.String, err)
			}
			if _, present := position["anchor"]; present != tc.wantAnchor {
				t.Errorf("anchor present = %v, want %v (%q)", present, tc.wantAnchor, row.ReadPosition.String)
			}
			if position["percent"] != 62.5 {
				t.Errorf("percent = %v, want it kept as the fallback (%q)", position["percent"], row.ReadPosition.String)
			}
			if position["v"] != float64(1) {
				t.Errorf("v = %v, want it kept", position["v"])
			}
		})
	}
}

// TestTheFollowUpJobsFollowTheRules covers the enqueueing decisions in one
// place, because what separates them is which row the handler read rather than
// which code path it took.
func TestTheFollowUpJobsFollowTheRules(t *testing.T) {
	twoMessages := []any{
		map[string]any{"chat_id": 4242, "message_id": 11},
		map[string]any{"chat_id": 4242, "message_id": 12},
		map[string]any{"chat_id": 4242, "message_id": 13, "replied_at": "2026-10-07T20:00:00.000Z"},
	}

	t.Run("success replies to every unreplied message and classifies once", func(t *testing.T) {
		harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
		page, _ := os.ReadFile("testdata/pages/bliki.html")
		id := harness.save("https://haldonsoftware.example/reversible-migration", page)
		harness.setMeta(id, map[string]any{"telegram_messages": twoMessages})

		if err := harness.run(id, 1, false, 1); err != nil {
			t.Fatalf("the extraction failed: %v", err)
		}
		if got := harness.countJobs(LibraryNotifyTelegramJobKind); got != 2 {
			t.Errorf("%d notify_telegram jobs, want one per unreplied message", got)
		}
		if got := harness.countJobs(LibraryClassifyJobKind); got != 1 {
			t.Errorf("%d classify jobs, want 1", got)
		}
	})

	t.Run("a final failure replies and does not classify", func(t *testing.T) {
		harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
		id := harness.save("http://127.0.0.1/private", nil)
		harness.setMeta(id, map[string]any{"telegram_messages": twoMessages})

		if err := harness.run(id, 1, false, 1); err == nil {
			t.Fatal("the extraction succeeded")
		}
		if got := harness.countJobs(LibraryNotifyTelegramJobKind); got != 2 {
			t.Errorf("%d notify_telegram jobs after a final failure, want one per unreplied message", got)
		}
		if got := harness.countJobs(LibraryClassifyJobKind); got != 0 {
			t.Errorf("%d classify jobs after a failure, want 0: there is no text to classify", got)
		}
	})

	t.Run("no LLM configured means no classify job", func(t *testing.T) {
		harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: false})
		page, _ := os.ReadFile("testdata/pages/bliki.html")
		id := harness.save("https://haldonsoftware.example/reversible-migration", page)
		if err := harness.run(id, 1, false, 1); err != nil {
			t.Fatalf("the extraction failed: %v", err)
		}
		if got := harness.countJobs(LibraryClassifyJobKind); got != 0 {
			t.Errorf("%d classify jobs with no LLM configured, want 0", got)
		}
	})

	t.Run("a confirmed link means no classify job", func(t *testing.T) {
		harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
		page, _ := os.ReadFile("testdata/pages/bliki.html")
		target := harness.save("https://haldonsoftware.example/expand-contract", page)
		id := harness.save("https://haldonsoftware.example/reversible-migration", page)

		tx, err := harness.database.Writer().Begin()
		if err != nil {
			t.Fatalf("beginning: %v", err)
		}
		if err := core.Links.Confirm(context.Background(), tx, harness.clock.Now(),
			id, target, core.LinkKindAbout); err != nil {
			t.Fatalf("confirming the link: %v", err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("committing: %v", err)
		}

		if err := harness.run(id, 1, false, 1); err != nil {
			t.Fatalf("the extraction failed: %v", err)
		}
		if got := harness.countJobs(LibraryClassifyJobKind); got != 0 {
			t.Errorf("%d classify jobs for an item the person has already linked, want 0", got)
		}
	})
}

// TestARefreshSwapsTheSnapshotAndReleasesTheOldBlob is the refresh path end to
// end, including the garbage collection the released reference makes possible.
func TestARefreshSwapsTheSnapshotAndReleasesTheOldBlob(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{
		FetchHandler: libraryServeFixture(t, "bliki"),
	})
	original := []byte(`<!doctype html><html><head><title>The Stored Snapshot</title></head><body><article>` +
		`<h1>The Stored Snapshot</h1><p>` +
		strings.Repeat("The snapshot the extension captured when the link was saved. ", 20) +
		`</p></article></body></html>`)
	id := harness.save("http://"+libraryFetchTestHost+"/page", original)

	before := harness.item(id)
	if !before.HtmlHash.Valid {
		t.Fatal("the save stored no snapshot")
	}
	oldHash := before.HtmlHash.String

	if err := harness.run(id, 1, true, 1); err != nil {
		t.Fatalf("the refreshing extraction failed: %v", err)
	}
	after := harness.item(id)
	if after.HtmlHash.String == oldHash {
		t.Fatal("html_hash still points at the old snapshot")
	}
	if got := harness.countSnapshotRefs(id); got != 1 {
		t.Errorf("%d snapshot references remain, want exactly 1", got)
	}
	if source := librarySnapshotSource(after.Meta); source != "server_fetch" {
		t.Errorf("meta.snapshot_source = %q, want server_fetch", source)
	}
	if after.Title != "Reversible Migration" {
		t.Errorf("title = %q, want the refetched page's", after.Title)
	}

	// The old blob is unreferenced now, and the collector leaves a blob alone
	// for an hour in case the save that wrote it has not committed yet.
	collected, err := harness.files.CollectGarbage(context.Background())
	if err != nil {
		t.Fatalf("collecting garbage: %v", err)
	}
	if collected.Removed != 0 {
		t.Errorf("the collector removed %d blobs inside the grace period, want 0", collected.Removed)
	}
	// A minute, not a nanosecond: every stored timestamp is truncated to the
	// millisecond, so a nanosecond past the grace period formats as exactly the
	// cutoff and the strictly-older comparison leaves the blob alone.
	harness.clock.Advance(core.UnreferencedBlobGrace + time.Minute)
	collected, err = harness.files.CollectGarbage(context.Background())
	if err != nil {
		t.Fatalf("collecting garbage after the grace period: %v", err)
	}
	if collected.Removed != 1 {
		t.Errorf("the collector removed %d blobs after the grace period, want the released one", collected.Removed)
	}
	if _, err := os.Stat(harness.files.Path(oldHash)); !os.IsNotExist(err) {
		t.Errorf("the old blob is still on disk: %v", err)
	}
}

// TestTheRetryEndpointResetsAndEnqueuesOneJob covers both retry entry points:
// they are the same service call, so proving one proves the other.
func TestTheRetryEndpointResetsAndEnqueuesOneJob(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{
		FetchHandler: libraryServeFixture(t, "bliki"),
	})
	id := harness.save("http://127.0.0.1/private", nil)
	if err := harness.run(id, 1, false, 1); err == nil {
		t.Fatal("the first extraction succeeded")
	}
	if status := harness.item(id).ExtractStatus; status != "failed" {
		t.Fatalf("extract_status = %q, want failed", status)
	}
	queuedBefore := harness.countJobs(LibraryExtractJobKind)

	outcome, err := harness.service.RequestExtraction(context.Background(), id, false)
	if err != nil {
		t.Fatalf("RequestExtraction: %v", err)
	}
	if outcome.JobID == "" {
		t.Error("the retry reported no job")
	}
	row := harness.item(id)
	if row.ExtractStatus != "pending" {
		t.Errorf("extract_status = %q after a retry, want pending", row.ExtractStatus)
	}
	if row.ExtractError.Valid {
		t.Errorf("extract_error = %q after a retry, want it cleared", row.ExtractError.String)
	}
	if row.ExtractGeneration != 2 {
		t.Errorf("extract_generation = %d after a retry, want 2", row.ExtractGeneration)
	}
	if got := harness.countJobs(LibraryExtractJobKind) - queuedBefore; got != 1 {
		t.Errorf("the retry enqueued %d extract jobs, want exactly 1", got)
	}

	if _, err := harness.service.RequestExtraction(context.Background(), "missing", false); err == nil {
		t.Error("retrying an item that does not exist succeeded")
	}
}

// TestARetryWithRefreshRefetches proves the flag reaches the handler rather
// than only the job row.
func TestARetryWithRefreshRefetches(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{
		FetchHandler: libraryServeFixture(t, "bliki"),
	})
	original := []byte(`<!doctype html><html><head><title>The Stored Snapshot</title></head><body><article>` +
		`<h1>The Stored Snapshot</h1><p>` +
		strings.Repeat("The snapshot the extension captured when the link was saved. ", 20) +
		`</p></article></body></html>`)
	id := harness.save("http://"+libraryFetchTestHost+"/page", original)

	outcome, err := harness.service.RequestExtraction(context.Background(), id, true)
	if err != nil {
		t.Fatalf("RequestExtraction: %v", err)
	}
	if err := harness.run(id, outcome.Generation, true, 1); err != nil {
		t.Fatalf("the refreshing extraction failed: %v", err)
	}
	if lookups, _ := harness.probe.snapshot(); len(lookups) == 0 {
		t.Error("the refresh read the stored snapshot instead of refetching")
	}
	if title := harness.item(id).Title; title != "Reversible Migration" {
		t.Errorf("title = %q, want the refetched page's", title)
	}
}

// TestAMalformedPayloadFailsPermanently keeps a job nothing can ever run from
// costing three attempts.
func TestAMalformedPayloadFailsPermanently(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	for _, payload := range []string{`{`, `{}`, `{"item_id":"x"}`, `{"generation":1}`} {
		err := harness.extraction.Handle(context.Background(), core.Job{
			ID: "job", Kind: LibraryExtractJobKind, Payload: payload,
			Attempt: 1, MaxAttempts: core.JobsMaxAttempts,
		})
		if err == nil {
			t.Errorf("the payload %s was accepted", payload)
			continue
		}
		if !core.IsPermanent(err) {
			t.Errorf("the payload %s gave a retryable error: %v", payload, err)
		}
	}
}

// TestADuplicateSaveExtractsItsCarriedSnapshot is the whole point of a save
// that carries HTML: the browser already has the page, often behind a login the
// server cannot pass, so the job the save queues reads those bytes instead of
// downloading the address again. The job is read back from the table rather
// than built here, because the defect was in what the save enqueued and a
// hand-built payload cannot see it.
func TestADuplicateSaveExtractsItsCarriedSnapshot(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	// A host the harness resolver has no mapping for, so any download fails:
	// that is what a login-walled page looks like from the server's side.
	const pageURL = "https://fixtures.invalid/resave"
	first := []byte(`<!doctype html><html><head><title>Primeira</title></head><body><article><h1>Primeira</h1><p>` +
		strings.Repeat("The first capture of this page, taken by the command line. ", 20) +
		`</p></article></body></html>`)
	id := harness.saveFrom(pageURL, first, LibrarySourceCLI)
	if err := harness.runAsEnqueued(id, 1, 1); err != nil {
		t.Fatalf("the first extraction failed: %v", err)
	}
	if status := harness.item(id).ExtractStatus; status != "done" {
		t.Fatalf("extract_status = %q after the first save, want done", status)
	}

	second := []byte(`<!doctype html><html><head><title>Segunda</title></head><body><article><h1>Segunda</h1><p>` +
		strings.Repeat("The second capture, the one the extension had on screen. ", 20) +
		`</p></article></body></html>`)
	if sameID := harness.saveFrom(pageURL, second, LibrarySourceExtension); sameID != id {
		t.Fatalf("the duplicate save created %s instead of folding into %s", sameID, id)
	}
	stored := harness.item(id)
	if stored.ExtractGeneration != 2 {
		t.Fatalf("extract_generation = %d after the duplicate save, want 2", stored.ExtractGeneration)
	}

	raw := harness.enqueuedExtractPayload(id, 2)
	var payload libraryExtractPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("the enqueued payload is not JSON: %v\n%s", err, raw)
	}
	if payload.Refresh {
		t.Errorf("the duplicate save enqueued refresh:true, which downloads the page: %s", raw)
	}

	if err := harness.runAsEnqueued(id, 2, 1); err != nil {
		t.Fatalf("the extraction of the carried snapshot failed: %v", err)
	}
	final := harness.item(id)
	if final.ExtractStatus != "done" {
		t.Errorf("extract_status = %q, want done (extract_error %q)", final.ExtractStatus, final.ExtractError.String)
	}
	if final.Title != "Segunda" {
		t.Errorf("title = %q, want the second capture's", final.Title)
	}
	if final.ExtractGeneration != 2 {
		t.Errorf("extract_generation = %d, want 2", final.ExtractGeneration)
	}
	if !strings.Contains(final.ContentText.String, "the one the extension had on screen") {
		t.Errorf("content_text is not the second capture's:\n%s", final.ContentText.String)
	}
	if strings.Contains(final.ContentText.String, "taken by the command line") {
		t.Errorf("content_text still carries the first capture:\n%s", final.ContentText.String)
	}
	// A download would have stored its own blob, moved the hash and rewritten
	// the capturer as server_fetch. None of the three may have happened.
	if final.HtmlHash.String != stored.HtmlHash.String {
		t.Errorf("html_hash moved from %q to %q, so a snapshot was fetched",
			stored.HtmlHash.String, final.HtmlHash.String)
	}
	if source := librarySnapshotSource(final.Meta); source != LibrarySourceExtension {
		t.Errorf("meta.snapshot_source = %q, want extension", source)
	}
	if lookups, dialed := harness.probe.snapshot(); len(lookups) != 0 || len(dialed) != 0 {
		t.Errorf("the extraction reached the network: looked up %v, dialed %v", lookups, dialed)
	}
}

// TestADuplicateSaveWithoutHTMLQueuesNoExtraction keeps the fix narrow: a save
// that carries no bytes has nothing to extract, so it must still leave the
// snapshot, the generation and the queue exactly as they were.
func TestADuplicateSaveWithoutHTMLQueuesNoExtraction(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	const pageURL = "https://fixtures.invalid/note-only"
	page := []byte(`<!doctype html><html><head><title>Primeira</title></head><body><article><h1>Primeira</h1><p>` +
		strings.Repeat("The only capture this item will ever have stored. ", 20) +
		`</p></article></body></html>`)
	// A CLI capture, not an extension one: a stored extension snapshot is
	// protected by a rule of its own, and this test is about the absent bytes.
	id := harness.saveFrom(pageURL, page, LibrarySourceCLI)
	if err := harness.runAsEnqueued(id, 1, 1); err != nil {
		t.Fatalf("the first extraction failed: %v", err)
	}
	before := harness.item(id)
	queuedBefore := harness.countJobs(LibraryExtractJobKind)

	note := "a thought I had on the second reading"
	if _, err := harness.service.Save(context.Background(), SaveInput{
		URL:    pageURL,
		Why:    note,
		Source: LibrarySourceApp,
	}); err != nil {
		t.Fatalf("the duplicate save without HTML failed: %v", err)
	}

	after := harness.item(id)
	if after.ExtractGeneration != before.ExtractGeneration {
		t.Errorf("extract_generation moved from %d to %d", before.ExtractGeneration, after.ExtractGeneration)
	}
	if after.HtmlHash.String != before.HtmlHash.String {
		t.Errorf("html_hash moved from %q to %q", before.HtmlHash.String, after.HtmlHash.String)
	}
	if after.Title != before.Title {
		t.Errorf("title moved from %q to %q", before.Title, after.Title)
	}
	if after.Why.String != note {
		t.Errorf("why = %q, want the duplicate's note", after.Why.String)
	}
	if got := harness.countJobs(LibraryExtractJobKind) - queuedBefore; got != 0 {
		t.Errorf("a duplicate save without HTML enqueued %d extract jobs, want 0", got)
	}
}

// TestAnEnqueuedRefreshStillDownloads is the other side of the same flag: the
// retry endpoint's explicit refresh must still reach the handler as a download,
// read from the row it enqueued rather than from a payload written here.
func TestAnEnqueuedRefreshStillDownloads(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{
		FetchHandler: libraryServeFixture(t, "bliki"),
	})
	original := []byte(`<!doctype html><html><head><title>The Stored Snapshot</title></head><body><article>` +
		`<h1>The Stored Snapshot</h1><p>` +
		strings.Repeat("The snapshot the extension captured when the link was saved. ", 20) +
		`</p></article></body></html>`)
	id := harness.saveFrom("http://"+libraryFetchTestHost+"/page", original, LibrarySourceExtension)

	outcome, err := harness.service.RequestExtraction(context.Background(), id, true)
	if err != nil {
		t.Fatalf("RequestExtraction: %v", err)
	}
	raw := harness.enqueuedExtractPayload(id, outcome.Generation)
	var payload libraryExtractPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("the enqueued payload is not JSON: %v\n%s", err, raw)
	}
	if !payload.Refresh {
		t.Errorf("the retry with refresh enqueued refresh:false: %s", raw)
	}

	if err := harness.runAsEnqueued(id, outcome.Generation, 1); err != nil {
		t.Fatalf("the refreshing extraction failed: %v", err)
	}
	if lookups, _ := harness.probe.snapshot(); len(lookups) == 0 {
		t.Error("the refresh read the stored snapshot instead of downloading the page")
	}
	after := harness.item(id)
	if after.Title != "Reversible Migration" {
		t.Errorf("title = %q, want the downloaded page's", after.Title)
	}
	if source := librarySnapshotSource(after.Meta); source != "server_fetch" {
		t.Errorf("meta.snapshot_source = %q, want server_fetch", source)
	}
}
