package library

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/llmtest"
)

// TestASavedLinkGetsASuggestionWithinOneWorkerCycle is the bead's "done when":
// a link saved with no destination is extracted, classified and suggested by
// the worker, with nothing but the save asked for.
//
// It runs the real queue and the real worker over both handlers, because the
// thing under test is the chain -- the extraction enqueueing a classify job
// and the worker claiming it -- and a test that called the two handlers in
// order would prove neither link of it.
func TestASavedLinkGetsASuggestionWithinOneWorkerCycle(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	subjects := core.NewSubjects(harness.database, harness.clock)
	about, err := subjects.Create(context.Background(), "Sistemas distribuídos", false)
	if err != nil {
		t.Fatalf("creating the subject: %v", err)
	}
	elsewhere, err := subjects.Create(context.Background(), "Jardinagem", false)
	if err != nil {
		t.Fatalf("creating the second subject: %v", err)
	}

	stub := llmtest.New(fmt.Sprintf(`{"suggestions":[{"id":%q,"confidence":0.88}]}`, about.Row.ID))
	defer stub.Close()
	classify := NewLibraryClassify(LibraryClassifyOptions{
		Database:   harness.database,
		Clock:      harness.clock,
		LLM:        core.NewLLM(stub.URL(), "a-test-model", "sk-vertical-test"),
		Candidates: core.NewLinkCandidates(harness.database, nil),
	})
	harness.jobs.Register(LibraryExtractJobKind, harness.extraction.Handle)
	harness.jobs.Register(LibraryClassifyJobKind, classify.Handle)

	page, err := os.ReadFile("testdata/pages/essay.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}
	item := harness.save("https://ortaessays.example/essays/notes-you-will-read-again", page)

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	worker := core.NewJobsWorker(harness.jobs, harness.clock, nil, core.NewID())
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	suggested := make(chan struct{})
	go func() {
		for {
			if librarySuggestedLinkCount(harness.database, item) > 0 {
				close(suggested)
				return
			}
			select {
			case <-workerCtx.Done():
				return
			case <-time.After(2 * time.Millisecond):
			}
		}
	}()
	libraryNudgeUntil(t, harness.clock, suggested, "suggested a destination for the saved link")

	stopWorker()
	select {
	case <-workerDone:
	case <-time.After(20 * time.Second):
		t.Fatal("the worker did not stop")
	}

	var dst string
	var confidence sql.NullFloat64
	var status, source string
	if err := harness.database.Reader().QueryRow(
		`SELECT dst_id, confidence, status, source FROM core_links WHERE src_id = ?`, item).
		Scan(&dst, &confidence, &status, &source); err != nil {
		t.Fatalf("reading the suggestion: %v", err)
	}
	if dst != about.Row.ID {
		t.Errorf("the suggestion points at %s, want the subject the stub named", dst)
	}
	if dst == elsewhere.Row.ID {
		t.Error("the suggestion points at the subject the stub did not name")
	}
	if confidence.Float64 != 0.88 || status != core.LinkStatusSuggested || source != core.LinkSourceLLM {
		t.Errorf("the suggestion is %v/%s/%s, want 0.88/suggested/llm",
			confidence.Float64, status, source)
	}
	// Nothing was decided: the point of the queue is that a person says yes.
	var decided sql.NullString
	if err := harness.database.Reader().QueryRow(
		`SELECT decided_at FROM core_links WHERE src_id = ?`, item).Scan(&decided); err != nil {
		t.Fatalf("reading decided_at: %v", err)
	}
	if decided.Valid {
		t.Errorf("the suggestion arrived already decided at %s", decided.String)
	}
}

// librarySuggestedLinkCount is how many suggestions the item has, read without
// a *testing.T so the polling goroutine above never touches one.
func librarySuggestedLinkCount(database *core.Database, itemID string) int {
	var count int
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_links WHERE src_id = ? AND status = 'suggested'`,
		itemID).Scan(&count); err != nil {
		return 0
	}
	return count
}
