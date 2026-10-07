package library

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// libraryWorkerStep is how far the manual clock moves when a test is waiting
// for the worker to come round to its next poll. The worker polls once a
// second, so one step is one poll.
const libraryWorkerStep = time.Second

// libraryNudgeUntil advances the manual clock a poll at a time until done is
// closed, so a test waits on the worker's own schedule instead of on the
// machine's speed. It fails the test rather than hanging if the worker never
// gets there.
func libraryNudgeUntil(t *testing.T, clock *clocktest.Clock, done <-chan struct{}, what string) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		select {
		case <-done:
			return
		default:
		}
		if time.Now().After(deadline) {
			t.Fatalf("the worker never %s", what)
		}
		clock.Advance(libraryWorkerStep)
		// A short real pause lets the worker's goroutine run; the clock is
		// what makes progress, and this only yields the processor.
		time.Sleep(2 * time.Millisecond)
	}
}

// TestASaveAnswers201WhileTheExtractionIsStillBlocked is the reason extraction
// is a job at all: the person named "it takes long to save" as the way capture
// fails, so the save returns the id and the reader shows an extracting state
// while the work happens behind it.
//
// The handler is held on a channel from inside the worker, against the real
// router, so what is proved is the shipped path rather than a service call.
func TestASaveAnswers201WhileTheExtractionIsStillBlocked(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	page, err := os.ReadFile("testdata/pages/essay.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}

	reached := make(chan struct{})
	release := make(chan struct{})
	harness.extraction.afterSnapshot = func() {
		close(reached)
		<-release
	}
	harness.jobs.Register(LibraryExtractJobKind, harness.extraction.Handle)

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	worker := core.NewJobsWorker(harness.jobs, harness.clock, nil, core.NewID())
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	router := newLibraryTestRouter(t, harness.database, harness.dataDir, harness.clock)
	recorder := doLibraryRequest(t, router, http.MethodPost, "/api/library/items", map[string]any{
		"url":  "https://ortaessays.example/essays/notes-you-will-read-again",
		"html": string(page),
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("the save answered %d, want 201: %s", recorder.Code, recorder.Body.String())
	}
	var saved struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &saved); err != nil {
		t.Fatalf("reading the save's answer: %v", err)
	}
	if saved.ID == "" {
		t.Fatal("the save answered 201 with no id")
	}

	// The response is already written. The worker now reaches the handler and
	// parks in it, and the item is still pending while it sits there -- which
	// is the state the reader renders as "extraindo".
	libraryNudgeUntil(t, harness.clock, reached, "reached the extraction handler")
	if status := harness.item(saved.ID).ExtractStatus; status != "pending" {
		t.Errorf("extract_status = %q while the handler is blocked, want pending", status)
	}
	if harness.item(saved.ID).ContentHtml.Valid {
		t.Error("content_html was written before the handler finished")
	}

	close(release)
	stopWorker()
	select {
	case <-workerDone:
	case <-time.After(20 * time.Second):
		t.Fatal("the worker did not stop")
	}
}

// The subprocess crash test. The parent sets up a database with one saved item
// and its extract job, the child runs a worker whose handler exits between the
// commit and the publish, and the parent then proves the replay happens.
const (
	libraryCrashChildEnv = "NORTE_LIBRARY_TEST_CRASH_CHILD"
	libraryCrashDataEnv  = "NORTE_LIBRARY_TEST_CRASH_DATA"
	libraryCrashExitCode = 7
	// libraryCrashReactionKind stands in for a subscriber's own durable
	// reaction -- the notes module re-anchoring its highlights, in the bead
	// this one is a dependency of.
	libraryCrashReactionKind = "notes.reanchor"
)

// TestACrashBetweenTheCommitAndThePublishIsReplayed proves the one claim that
// makes publishing after the commit safe.
//
// The handler commits its transaction and publishes before returning, and the
// worker marks the job done only once the handler has returned. A crash in
// between therefore leaves the job running rather than done; its lease expires,
// a worker reclaims it, and the replay publishes again. Nothing but a real
// process exit can exercise that, because the window is defined by the process
// not reaching its next statement.
func TestACrashBetweenTheCommitAndThePublishIsReplayed(t *testing.T) {
	if os.Getenv(libraryCrashChildEnv) == "1" {
		libraryRunCrashChild(t)
		return
	}
	if testing.Short() {
		t.Skip("starts a subprocess")
	}

	dataDir := t.TempDir()
	itemID, jobID := libraryPrepareCrashFixture(t, dataDir)

	child := exec.Command(os.Args[0],
		"-test.run=^TestACrashBetweenTheCommitAndThePublishIsReplayed$", "-test.v")
	child.Env = append(os.Environ(),
		libraryCrashChildEnv+"=1",
		libraryCrashDataEnv+"="+dataDir,
	)
	output, err := child.CombinedOutput()
	if err == nil {
		t.Fatalf("the child exited cleanly instead of crashing in the failpoint:\n%s", output)
	}
	if code := child.ProcessState.ExitCode(); code != libraryCrashExitCode {
		t.Fatalf("the child exited %d, want the failpoint's %d:\n%s", code, libraryCrashExitCode, output)
	}

	// What the crash left behind: the extraction committed, and the job is
	// still running because the handler never returned.
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("reopening the database: %v", err)
	}
	defer func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	}()
	row, err := db.New(database.Reader()).GetLibraryItemByID(context.Background(), itemID)
	if err != nil {
		t.Fatalf("reading the item: %v", err)
	}
	if row.ExtractStatus != "done" {
		t.Fatalf("extract_status = %q after the crash, want the committed done:\n%s", row.ExtractStatus, output)
	}
	if status := libraryJobStatus(t, database, jobID); status != "running" {
		t.Fatalf("the job is %q after the crash, want running: a done job would never be replayed", status)
	}
	if count := libraryJobCount(t, database, libraryCrashReactionKind); count != 0 {
		t.Fatalf("the crashed run enqueued %d reactions, want 0: it died before publishing", count)
	}

	// A new worker, on a clock past the lease. Reclaiming is what turns the
	// abandoned lease back into a runnable job.
	clock := clocktest.New(time.Now().UTC().Add(time.Hour))
	queue := core.NewJobs(database.Writer(), clock, nil)
	events := core.NewEvents()
	reacted := make(chan struct{})
	events.Subscribe(LibraryItemExtractedEvent, func(ctx context.Context, event core.Event) error {
		tx, err := database.Writer().BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := queue.Enqueue(ctx, tx, libraryCrashReactionKind,
			`{"item_id":"`+event.Payload["item_id"]+`"}`,
			libraryCrashReactionKind+":"+event.Payload["item_id"]); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		select {
		case <-reacted:
		default:
			close(reacted)
		}
		return nil
	})
	queue.Register(LibraryExtractJobKind, libraryCrashExtraction(database, dataDir, clock, queue, events, nil).Handle)

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	worker := core.NewJobsWorker(queue, clock, nil, core.NewID())
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	libraryNudgeUntil(t, clock, reacted, "replayed the job and published again")

	stopWorker()
	select {
	case <-workerDone:
	case <-time.After(20 * time.Second):
		t.Fatal("the replaying worker did not stop")
	}

	if count := libraryJobCount(t, database, libraryCrashReactionKind); count != 1 {
		t.Errorf("the replay left %d reactions, want exactly 1", count)
	}
	if status := libraryJobStatus(t, database, jobID); status != "done" {
		t.Errorf("the reclaimed job is %q, want done", status)
	}
}

// libraryPrepareCrashFixture builds the database the child will crash against:
// one saved item with its snapshot, and the extract job the save enqueued.
func libraryPrepareCrashFixture(t *testing.T, dataDir string) (itemID, jobID string) {
	t.Helper()
	page, err := os.ReadFile("testdata/pages/essay.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
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
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	if _, err := app.MigrateNorteModules(context.Background(), database.Writer(),
		[]app.Module{NewLibraryModule()}); err != nil {
		t.Fatalf("applying the library migrations: %v", err)
	}
	clock := core.SystemClock()
	service := NewLibraryService(database, core.NewFiles(dataDir, database.Writer(), clock),
		core.NewJobs(database.Writer(), clock, nil), clock)
	outcome, err := service.Save(context.Background(), SaveInput{
		URL:    "https://ortaessays.example/essays/notes-you-will-read-again",
		HTML:   page,
		Source: LibrarySourceCLI,
	})
	if err != nil {
		t.Fatalf("saving the item: %v", err)
	}
	if err := database.Reader().QueryRow(
		`SELECT id FROM core_jobs WHERE kind = ?`, LibraryExtractJobKind).Scan(&jobID); err != nil {
		t.Fatalf("reading the enqueued job: %v", err)
	}
	return outcome.ID, jobID
}

// libraryRunCrashChild is the child half: a worker whose extraction exits the
// process in the window between the commit and the publish.
//
// The failpoint lives here, in the test, rather than in the handler. The
// handler exposes the window as an unexported hook and nothing in the shipped
// binary can set it, so a build of `norte` carries no way to exit a process
// mid-job.
func libraryRunCrashChild(t *testing.T) {
	dataDir := os.Getenv(libraryCrashDataEnv)
	if dataDir == "" {
		t.Fatalf("the child was started without %s", libraryCrashDataEnv)
	}
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("the child could not open the database: %v", err)
	}
	clock := core.SystemClock()
	queue := core.NewJobs(database.Writer(), clock, nil)
	extraction := libraryCrashExtraction(database, dataDir, clock, queue, core.NewEvents(), func() {
		// Everything the extraction owns is committed; nothing it has to tell
		// anyone else is. This is the only window the replay exists for.
		os.Exit(libraryCrashExitCode)
	})
	queue.Register(LibraryExtractJobKind, extraction.Handle)

	workerCtx, stopWorker := context.WithTimeout(context.Background(), 30*time.Second)
	defer stopWorker()
	worker := core.NewJobsWorker(queue, clock, nil, core.NewID())
	if err := worker.Run(workerCtx); err != nil {
		t.Fatalf("the child's worker failed: %v", err)
	}
	t.Fatal("the child's worker returned without reaching the failpoint")
}

// libraryCrashExtraction wires an extraction over an already-open database. The
// fetcher is nil: the item carries a snapshot, and a child that reached the
// network would be testing something else.
func libraryCrashExtraction(
	database *core.Database,
	dataDir string,
	clock core.Clock,
	queue *core.Jobs,
	events *core.Events,
	afterCommit func(),
) *LibraryExtraction {
	extraction := NewLibraryExtraction(LibraryExtractionOptions{
		Database: database,
		Files:    core.NewFiles(dataDir, database.Writer(), clock),
		Jobs:     queue,
		Clock:    clock,
		Events:   events,
	})
	extraction.afterCommit = afterCommit
	return extraction
}

func libraryJobStatus(t *testing.T, database *core.Database, jobID string) string {
	t.Helper()
	var status string
	if err := database.Reader().QueryRow(
		`SELECT status FROM core_jobs WHERE id = ?`, jobID).Scan(&status); err != nil {
		t.Fatalf("reading job %s: %v", jobID, err)
	}
	return status
}

func libraryJobCount(t *testing.T, database *core.Database, kind string) int {
	t.Helper()
	var count int
	if err := database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_jobs WHERE kind = ?`, kind).Scan(&count); err != nil {
		t.Fatalf("counting %s jobs: %v", kind, err)
	}
	return count
}

// TestTheCrashFailpointIsNotReachableFromTheShippedBinary is the guard on the
// seam above. afterCommit is unexported and set by nothing outside this
// package's tests, so a release build has no way to exit a process in the
// middle of a job.
func TestTheCrashFailpointIsNotReachableFromTheShippedBinary(t *testing.T) {
	for _, path := range []string{"extract.go", "library.go", "extractcmd.go", "handlers.go", "service.go"} {
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("reading %s: %v", path, err)
		}
		if strings.Contains(string(source), "os.Exit") {
			t.Errorf("%s calls os.Exit; a job handler must never end the process", path)
		}
	}
	extraction := NewLibraryExtraction(LibraryExtractionOptions{})
	if extraction.afterCommit != nil || extraction.afterSnapshot != nil {
		t.Error("a freshly constructed extraction carries a test hook")
	}
}
