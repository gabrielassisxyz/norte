package library

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// librarySaveWithSnapshot saves a link with an HTML snapshot, so the item owns
// a core_file_refs row as well as a registry row: a delete that forgot the
// registry would leave the snapshot reference behind and the blob uncollectable.
func librarySaveWithSnapshot(t *testing.T, service *LibraryService, url string, linkTo ...string) SaveOutcome {
	t.Helper()
	outcome, err := service.Save(context.Background(), SaveInput{
		URL:    url,
		Title:  "A saved page",
		HTML:   []byte("<html><body><p>A saved page worth keeping.</p></body></html>"),
		LinkTo: linkTo,
		Source: LibrarySourceCLI,
	})
	if err != nil {
		t.Fatalf("saving %s: %v", url, err)
	}
	return outcome
}

// TestLibraryDeleteTakesEverythingThatBelongsToTheItem is the whole of what a
// delete owns on the library's side: the row, the tag rows, the shared tag
// vocabulary, the full-text index row, the registry row and the links and file
// references that follow it -- and nothing that belongs to another item.
func TestLibraryDeleteTakesEverythingThatBelongsToTheItem(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	subject, err := core.NewSubjects(database, clock).Create(context.Background(), "Distributed systems", false)
	if err != nil {
		t.Fatalf("creating a subject: %v", err)
	}
	doomed := librarySaveWithSnapshot(t, service, "https://example.org/doomed", subject.Row.ID)
	kept := librarySaveWithSnapshot(t, service, "https://example.org/kept")

	// "shared" is carried by both items and must survive; "alone" is carried
	// by the deleted item only and must be retired with it.
	for _, tag := range []string{"shared", "alone"} {
		if _, err := service.AddItemTag(context.Background(), doomed.ID, tag); err != nil {
			t.Fatalf("tagging the doomed item %s: %v", tag, err)
		}
	}
	if _, err := service.AddItemTag(context.Background(), kept.ID, "shared"); err != nil {
		t.Fatalf("tagging the kept item: %v", err)
	}
	if _, err := service.RemoveItemTag(context.Background(), doomed.ID, "alone"); err != nil {
		t.Fatalf("recording a removed tag: %v", err)
	}
	if _, err := service.AddItemTag(context.Background(), doomed.ID, "alone"); err != nil {
		t.Fatalf("re-adding the removed tag: %v", err)
	}

	if libraryCountRows(t, service, `SELECT COUNT(*) FROM core_file_refs WHERE owner_id = ?`, doomed.ID) == 0 {
		t.Fatalf("the saved item owns no snapshot reference, so the delete would prove nothing about one")
	}
	if libraryCountRows(t, service, `SELECT COUNT(*) FROM core_links WHERE src_id = ? OR dst_id = ?`,
		doomed.ID, doomed.ID) == 0 {
		t.Fatalf("the saved item owns no link, so the delete would prove nothing about one")
	}

	if libraryCountRows(t, service, `SELECT COUNT(*) FROM library_fts WHERE id = ?`, doomed.ID) == 0 {
		t.Fatalf("the saved item has no full-text row, so the delete would prove nothing about one")
	}

	if err := service.Delete(context.Background(), doomed.ID); err != nil {
		t.Fatalf("deleting %s: %v", doomed.ID, err)
	}

	for _, check := range []struct {
		what  string
		query string
	}{
		{"library_items", `SELECT COUNT(*) FROM library_items WHERE id = ?`},
		{"library_fts", `SELECT COUNT(*) FROM library_fts WHERE id = ?`},
		{"library_item_tags", `SELECT COUNT(*) FROM library_item_tags WHERE item_id = ?`},
		{"library_item_removed_tags", `SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ?`},
		{"core_items", `SELECT COUNT(*) FROM core_items WHERE id = ?`},
		{"core_file_refs", `SELECT COUNT(*) FROM core_file_refs WHERE owner_id = ?`},
	} {
		if rows := libraryCountRows(t, service, check.query, doomed.ID); rows != 0 {
			t.Errorf("%s still holds %d row(s) for the deleted item", check.what, rows)
		}
	}
	if rows := libraryCountRows(t, service,
		`SELECT COUNT(*) FROM core_links WHERE src_id = ? OR dst_id = ?`, doomed.ID, doomed.ID); rows != 0 {
		t.Errorf("core_links still holds %d row(s) touching the deleted item", rows)
	}
	if rows := libraryCountRows(t, service,
		`SELECT COUNT(*) FROM library_tags WHERE name = 'alone'`); rows != 0 {
		t.Errorf("the tag nothing carries any more is still in the vocabulary (%d row(s))", rows)
	}
	if rows := libraryCountRows(t, service,
		`SELECT COUNT(*) FROM library_tags WHERE name = 'shared'`); rows != 1 {
		t.Errorf("the tag the other item still carries is in the vocabulary %d time(s), want 1", rows)
	}

	if _, err := service.Get(context.Background(), kept.ID); err != nil {
		t.Errorf("the other item did not survive the delete: %v", err)
	}
	if rows := libraryCountRows(t, service, `SELECT COUNT(*) FROM core_items WHERE id = ?`, kept.ID); rows != 1 {
		t.Errorf("the other item's registry row is gone (%d row(s))", rows)
	}
}

// TestLibraryDeleteRefusesAnUnknownID: a delete of something already gone is a
// 404 the person can read, not a silent success.
func TestLibraryDeleteRefusesAnUnknownID(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	err := service.Delete(context.Background(), "no-such-item")
	var domain *LibraryError
	if !errors.As(err, &domain) {
		t.Fatalf("deleting an unknown id gave %v, want a domain error", err)
	}
	if domain.Status != http.StatusNotFound || domain.Code != "not_found" {
		t.Errorf("the refusal is %d %q, want 404 not_found", domain.Status, domain.Code)
	}
}

// TestLibraryDeleteOverHTTP is the route itself: 204 with no body, the item
// then unreadable, and an unknown id answered in the standard envelope.
func TestLibraryDeleteOverHTTP(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	outcome := librarySaveWithSnapshot(t, service, "https://example.org/over-http")

	deleted := doLibraryRequest(t, handler, http.MethodDelete, "/api/library/items/"+outcome.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("DELETE answered %d, want 204: %s", deleted.Code, deleted.Body.String())
	}
	if body := deleted.Body.String(); body != "" {
		t.Errorf("DELETE answered with a body %q, want none", body)
	}

	read := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/"+outcome.ID, nil)
	if read.Code != http.StatusNotFound {
		t.Errorf("reading the deleted item answered %d, want 404: %s", read.Code, read.Body.String())
	}

	unknown := doLibraryRequest(t, handler, http.MethodDelete, "/api/library/items/no-such-item", nil)
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("deleting an unknown id answered %d, want 404: %s", unknown.Code, unknown.Body.String())
	}
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(unknown.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding the refusal: %v: %s", err, unknown.Body.String())
	}
	if envelope.Error.Code != "not_found" || !strings.Contains(envelope.Error.Message, "no-such-item") {
		t.Errorf("the refusal is %q / %q, want not_found naming the id",
			envelope.Error.Code, envelope.Error.Message)
	}
}

// TestLibraryRemoveCommand is `norte rm`: nothing on stdout on success, and the
// service's own sentence on a non-zero exit for an id that is not there.
func TestLibraryRemoveCommand(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveWithSnapshot(t, service, "https://example.org/by-command")

	out, err := runLibraryCLI(t, dataDir, "rm", outcome.ID)
	if err != nil {
		t.Fatalf("norte rm %s: %v: %s", outcome.ID, err, out)
	}
	if strings.TrimSpace(out) != "" {
		t.Errorf("norte rm printed %q, want nothing", out)
	}
	if rows := libraryCountRows(t, service, `SELECT COUNT(*) FROM library_items WHERE id = ?`, outcome.ID); rows != 0 {
		t.Errorf("the item is still there after norte rm (%d row(s))", rows)
	}

	out, err = runLibraryCLI(t, dataDir, "rm", "no-such-item")
	if err == nil {
		t.Fatalf("norte rm of an unknown id exited 0: %s", out)
	}
	if !strings.Contains(err.Error(), "no library item no-such-item") {
		t.Errorf("norte rm of an unknown id said %q, want the service's sentence", err.Error())
	}
}

// TestAnExtractJobWhoseItemWasDeletedFinishesDone runs the real worker over
// the job a save queued, after the item has been deleted under it.
//
// The job has to end done rather than failed: the person removed the link on
// purpose, so the work is genuinely finished, and a queue of failures for
// deliberately deleted items is a queue nobody can read. Done also means no
// re-queuing, which `attempts` shows: a retry would claim it a second time.
func TestAnExtractJobWhoseItemWasDeletedFinishesDone(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	id := harness.save("https://"+libraryFetchTestHost+"/deleted-under-the-job",
		[]byte("<html><body><p>Saved, then deleted.</p></body></html>"))
	if err := harness.service.Delete(context.Background(), id); err != nil {
		t.Fatalf("deleting %s: %v", id, err)
	}
	harness.jobs.Register(LibraryExtractJobKind, harness.extraction.Handle)

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	worker := core.NewJobsWorker(harness.jobs, harness.clock, nil, core.NewID())
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	settled := make(chan struct{})
	go func() {
		defer close(settled)
		for {
			if status, _ := libraryJobOutcome(t, harness, id); status != "queued" {
				return
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()
	libraryNudgeUntil(t, harness.clock, settled, "claimed the extract job")
	stopWorker()
	select {
	case <-workerDone:
	case <-time.After(20 * time.Second):
		t.Fatal("the worker did not stop")
	}

	status, attempts := libraryJobOutcome(t, harness, id)
	if status != "done" {
		t.Errorf("the extract job of a deleted item ended %q, want done", status)
	}
	if attempts != 1 {
		t.Errorf("the job was claimed %d times, want 1: a retry means it was re-queued", attempts)
	}
}

// libraryJobOutcome reads the extract job of one item: what the worker left it
// at, and how many times it was claimed.
func libraryJobOutcome(t *testing.T, harness *libraryExtractHarness, itemID string) (string, int) {
	t.Helper()
	var status string
	var attempts int
	if err := harness.database.Reader().QueryRow(
		`SELECT status, attempts FROM core_jobs WHERE kind = ? AND payload LIKE ?`,
		LibraryExtractJobKind, "%"+itemID+"%").Scan(&status, &attempts); err != nil {
		t.Fatalf("reading the extract job of %s: %v", itemID, err)
	}
	return status, attempts
}
