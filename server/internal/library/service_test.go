package library

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func librarySaveOne(t *testing.T, service *LibraryService, url, reason string) SaveOutcome {
	t.Helper()
	outcome, err := service.Save(context.Background(), SaveInput{
		URL:    url,
		Reason: reason,
		Source: LibrarySourceCLI,
	})
	if err != nil {
		t.Fatalf("saving %s: %v", url, err)
	}
	return outcome
}

func libraryCountRows(t *testing.T, service *LibraryService, query string, args ...any) int {
	t.Helper()
	var count int
	if err := service.database.Reader().QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("counting (%s): %v", query, err)
	}
	return count
}

func TestLibraryPatchUnreadTransitions(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/unread", "")

	row, err := service.Get(context.Background(), outcome.ID)
	if err != nil {
		t.Fatalf("reading the item: %v", err)
	}
	if row.Unread != 1 || row.ReadAt.Valid {
		t.Fatalf("a new item is unread=%d read_at=%v, want 1 and NULL", row.Unread, row.ReadAt)
	}

	markFalse := false
	patched, err := service.Patch(context.Background(), outcome.ID, PatchInput{Unread: &markFalse})
	if err != nil {
		t.Fatalf("patching unread=false: %v", err)
	}
	if patched.Unread != 0 || !patched.ReadAt.Valid {
		t.Errorf("after unread=false the item is unread=%d read_at=%v, want 0 and set", patched.Unread, patched.ReadAt)
	}

	markTrue := true
	patched, err = service.Patch(context.Background(), outcome.ID, PatchInput{Unread: &markTrue})
	if err != nil {
		t.Fatalf("patching unread=true: %v", err)
	}
	if patched.Unread != 1 || patched.ReadAt.Valid {
		t.Errorf("after unread=true the item is unread=%d read_at=%v, want 1 and NULL", patched.Unread, patched.ReadAt)
	}
}

func TestLibraryPatchLocationTransitions(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/location", "")

	for _, location := range []string{"up_next", "later", "archive", "stash", "inbox"} {
		patched, err := service.Patch(context.Background(), outcome.ID, PatchInput{Location: &location})
		if err != nil {
			t.Fatalf("patching location=%s: %v", location, err)
		}
		if patched.Location != location {
			t.Errorf("location = %q, want %q", patched.Location, location)
		}
	}
}

// TestLibraryPatchRefusesAPortugueseLocation is the other half of the rename:
// the five English values are accepted above, and the value a pre-rename
// client would send is refused on the field it was sent on rather than stored.
func TestLibraryPatchRefusesAPortugueseLocation(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/refused", "")

	old := "depois"
	_, err := service.Patch(context.Background(), outcome.ID, PatchInput{Location: &old})
	var domain *LibraryError
	if !errors.As(err, &domain) {
		t.Fatalf("patching an unknown location gave %v, want a domain error", err)
	}
	if domain.Message != `unknown location "depois"` || domain.Field != "location" {
		t.Errorf("the refusal is %q on %q, want the unknown-location message on location",
			domain.Message, domain.Field)
	}
}

// TestLibrarySaveRollsBackWhenTheJobEnqueueFails forces the last step of the
// save to fail and proves nothing was left behind: no item, no registry row,
// no file reference. The blob itself may survive -- it was stored before the
// transaction on purpose, and norte files gc is what clears it.
func TestLibrarySaveRollsBackWhenTheJobEnqueueFails(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	service.libraryExtractKind = ""

	_, err := service.Save(context.Background(), SaveInput{
		URL:    "https://example.org/rollback",
		HTML:   []byte("<html>doomed</html>"),
		Reason: "doomed",
		Source: LibrarySourceCLI,
	})
	if err == nil {
		t.Fatal("the save with a failing enqueue succeeded, want an error")
	}
	for query, want := range map[string]int{
		`SELECT count(*) FROM library_items`:  0,
		`SELECT count(*) FROM core_items`:     0,
		`SELECT count(*) FROM core_file_refs`: 0,
		`SELECT count(*) FROM core_jobs`:      0,
		`SELECT count(*) FROM library_fts`:    0,
	} {
		if got := libraryCountRows(t, service, query); got != want {
			t.Errorf("%s = %d, want %d: the failed save left a row behind", query, got, want)
		}
	}
}

// TestLibraryFTSTriggersTrackInsertUpdateDelete proves the full-text index
// follows the item across its whole life: the save inserts, a note update
// rewrites, and a delete removes.
func TestLibraryFTSTriggersTrackInsertUpdateDelete(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/fts", "zebra")

	var indexed string
	if err := database.Reader().QueryRow(
		`SELECT reason FROM library_fts WHERE id = ?`, outcome.ID).Scan(&indexed); err != nil {
		t.Fatalf("reading the inserted full-text row: %v", err)
	}
	if indexed != "zebra" {
		t.Errorf("the indexed note = %q, want zebra", indexed)
	}

	other := "other"
	if _, err := service.Patch(context.Background(), outcome.ID, PatchInput{Reason: &other}); err != nil {
		t.Fatalf("patching the reason: %v", err)
	}
	if err := database.Reader().QueryRow(
		`SELECT reason FROM library_fts WHERE id = ?`, outcome.ID).Scan(&indexed); err != nil {
		t.Fatalf("reading the updated full-text row: %v", err)
	}
	if indexed != "other" {
		t.Errorf("the indexed note after the patch = %q, want other", indexed)
	}

	if _, err := database.Writer().Exec(`DELETE FROM library_items WHERE id = ?`, outcome.ID); err != nil {
		t.Fatalf("deleting the item: %v", err)
	}
	if got := libraryCountRows(t, service,
		`SELECT count(*) FROM library_fts WHERE id = ?`, outcome.ID); got != 0 {
		t.Errorf("%d full-text rows survived the delete, want 0", got)
	}
	if !strings.Contains(outcome.ID, "-") {
		t.Errorf("the item id %q is not a UUID", outcome.ID)
	}
}

// A word in the title must outrank the same word in the note: the weights only
// mean anything if they land on the columns they were written for.
func TestLibraryFTSRanksTitleAboveTheNote(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	inNote := librarySaveOne(t, service, "https://example.org/in-note", "zebra")
	inTitle := librarySaveOne(t, service, "https://example.org/in-title", "")
	title := "zebra"
	if _, err := service.Patch(context.Background(), inTitle.ID, PatchInput{Title: &title}); err != nil {
		t.Fatalf("patching the title: %v", err)
	}

	var first string
	if err := database.Reader().QueryRow(
		`SELECT id FROM library_fts WHERE library_fts MATCH 'zebra' ORDER BY ` + libraryFTSRank + ` LIMIT 1`).Scan(&first); err != nil {
		t.Fatalf("ranking: %v", err)
	}
	if first != inTitle.ID {
		t.Errorf("the note match ranked first (%s); the title match %s must outrank it", inNote.ID, inTitle.ID)
	}
}
