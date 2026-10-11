// The tag endpoints' and vocabulary's tests: what a hand add, a hand removal,
// a rename, a merge and the tag filter do, over the service and over the real
// router the API answers through.
package library

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// seedTags writes one item's tags straight through the service, so the
// scenarios below start from a library that already carries a vocabulary.
func seedTags(t *testing.T, service *LibraryService, url string, tags []string) string {
	t.Helper()
	id := librarySaveOne(t, service, url, "").ID
	for _, name := range tags {
		if _, err := service.AddItemTag(context.Background(), id, name); err != nil {
			t.Fatalf("adding the tag %s to %s: %v", name, id, err)
		}
	}
	return id
}

func countRows(t *testing.T, service *LibraryService, statement string, args ...any) int {
	t.Helper()
	var count int
	if err := service.database.Reader().QueryRowContext(context.Background(), statement, args...).Scan(&count); err != nil {
		t.Fatalf("counting %q: %v", statement, err)
	}
	return count
}

func wantTags(t *testing.T, got []string, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("the tags are %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("the tags are %v, want %v (the %dth differs)", got, want, i)
		}
	}
}

// TestAHandAddNormalizesIntoTheVocabulary is the add endpoint's side: the
// same normalizer the tagger runs, a duplicate add that stays one row, and
// the refusal of what normalization leaves with nothing.
func TestAHandAddNormalizesIntoTheVocabulary(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	id := librarySaveOne(t, service, "https://example.org/add-tag", "").ID

	tags, err := service.AddItemTag(context.Background(), id, "  Machine   Learning! ")
	if err != nil {
		t.Fatalf("the add failed: %v", err)
	}
	wantTags(t, tags, "machine learning")

	// A hand add over a tag the tagger already wrote makes it the person's
	// own: one row still, manual origin, and the job must never take it
	// down from here on.
	seedTag(t, database, id, "rust")
	tags, err = service.AddItemTag(context.Background(), id, "Rust")
	if err != nil {
		t.Fatalf("the add over the automatic row failed: %v", err)
	}
	wantTags(t, tags, "machine learning", "rust")
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_tags WHERE item_id = ? AND tag_name = 'rust' AND origin = 'manual'`, id); got != 1 {
		t.Errorf("the hand add left the automatic origin standing (%d manual rows)", got)
	}

	// The second spelling of machine learning is not a second tag.
	tags, err = service.AddItemTag(context.Background(), id, "machine learning")
	if err != nil {
		t.Fatalf("the duplicate add failed: %v", err)
	}
	wantTags(t, tags, "machine learning", "rust")
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_tags WHERE item_id = ?`, id); got != 2 {
		t.Errorf("the duplicate add left %d rows, want 2", got)
	}

	if _, err := service.AddItemTag(context.Background(), id, "!!!"); err == nil {
		t.Error("a tag that normalizes to nothing was accepted")
	}
	if _, err := service.AddItemTag(context.Background(), id, strings.Repeat("a", libraryTagMaxNameRunes+1)); err == nil {
		t.Error("a tag past the length cap was accepted")
	}
	if _, err := service.AddItemTag(context.Background(), id+"-gone", "rust"); err == nil {
		t.Error("a tag for an item that does not exist was accepted")
	}
}

// TestAHandAddForgivesTheRemovalItUndoes: the removal record exists to keep
// the tagger away; the person bringing the tag back is them changing their
// mind, and the job should be free to reach for that name again.
func TestAHandAddForgivesTheRemovalItUndoes(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	id := librarySaveOne(t, service, "https://example.org/forgive", "").ID
	if _, err := service.AddItemTag(context.Background(), id, "llm"); err != nil {
		t.Fatalf("the add failed: %v", err)
	}
	if _, err := service.RemoveItemTag(context.Background(), id, "llm"); err != nil {
		t.Fatalf("the removal failed: %v", err)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ?`, id); got != 1 {
		t.Fatalf("the removal left %d records, want 1", got)
	}

	if _, err := service.AddItemTag(context.Background(), id, "llm"); err != nil {
		t.Fatalf("the re-add failed: %v", err)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ?`, id); got != 0 {
		t.Errorf("the re-add left %d removal records, want none", got)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_tags WHERE item_id = ? AND tag_name = 'llm' AND origin = 'manual'`, id); got != 1 {
		t.Errorf("the re-add left the tag on the item %d time as manual, want 1", got)
	}
}

// TestAHandRemovalRecordsItselfAndRetiresTheTag is the removal rule: the
// record the tagger reads, a tag that outlives its items, and the 404 for a
// pair the item does not carry.
func TestAHandRemovalRecordsItselfAndRetiresTheTag(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	first := seedTags(t, service, "https://example.org/remove-a", []string{"llm", "rust"})
	second := seedTags(t, service, "https://example.org/remove-b", []string{"llm"})

	if _, err := service.RemoveItemTag(context.Background(), first, "llm"); err != nil {
		t.Fatalf("the removal failed: %v", err)
	}
	wantTags(t, tagsOf(t, service, first), "rust")
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ? AND tag_name = 'llm'`, first); got != 1 {
		t.Errorf("the removal left %d records, want 1", got)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_tags WHERE name = 'llm'`); got != 1 {
		t.Errorf("a tag still carried by another item was retired (%d vocabulary rows)", got)
	}

	if _, err := service.RemoveItemTag(context.Background(), second, "llm"); err != nil {
		t.Fatalf("the removal failed: %v", err)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_tags WHERE name = 'llm'`); got != 0 {
		t.Errorf("a tag nothing carries was left in the vocabulary (%d rows)", got)
	}
	tags, err := service.Tags(context.Background())
	if err != nil {
		t.Fatalf("listing the tags: %v", err)
	}
	// rust outlived llm on the first item, so the vocabulary holds exactly it.
	if len(tags) != 1 || tags[0].Name != "rust" || tags[0].Count != 1 {
		t.Fatalf("the vocabulary is %v, want rust(1) alone", tags)
	}

	if _, err := service.RemoveItemTag(context.Background(), first, "llm"); err == nil {
		t.Error("removing a tag the item does not carry was accepted")
	}
	if _, err := service.RemoveItemTag(context.Background(), first+"-gone", "rust"); err == nil {
		t.Error("a removal for an item that does not exist was accepted")
	}
}

// TestTheVocabularyListsMostUsedFirst is the read the library screen shows
// and the tagger asks for.
func TestTheVocabularyListsMostUsedFirst(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	seedTags(t, service, "https://example.org/vocab-a", []string{"rust", "llm"})
	seedTags(t, service, "https://example.org/vocab-b", []string{"rust", "docker"})

	tags, err := service.Tags(context.Background())
	if err != nil {
		t.Fatalf("listing the tags: %v", err)
	}
	if len(tags) != 3 {
		t.Fatalf("the vocabulary holds %d tags, want 3", len(tags))
	}
	if tags[0].Name != "rust" || tags[0].Count != 2 {
		t.Errorf("the most used tag is %s(%d), want rust(2)", tags[0].Name, tags[0].Count)
	}
	if tags[1].Name != "docker" || tags[1].Count != 1 {
		t.Errorf("the second tag is %s(%d), want docker(1): equal counts break alphabetical", tags[1].Name, tags[1].Count)
	}
	if tags[2].Name != "llm" || tags[2].Count != 1 {
		t.Errorf("the third tag is %s(%d), want llm(1)", tags[2].Name, tags[2].Count)
	}
}

// tagsOf reads one item's tags through the service.
func tagsOf(t *testing.T, service *LibraryService, itemID string) []string {
	t.Helper()
	tags, err := service.ItemTags(context.Background(), itemID)
	if err != nil {
		t.Fatalf("reading the tags of %s: %v", itemID, err)
	}
	return tags
}

// TestARenameMovesEveryCarrierAndItsRemovals is the pure rename: the name is
// all there is to a tag, and the removal records are the tag's memory.
func TestARenameMovesEveryCarrierAndItsRemovals(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	carrier := seedTags(t, service, "https://example.org/rename-carrier", []string{"rust"})
	remover := librarySaveOne(t, service, "https://example.org/rename-remover", "").ID
	if _, err := service.AddItemTag(context.Background(), remover, "rust"); err != nil {
		t.Fatalf("adding: %v", err)
	}
	if _, err := service.RemoveItemTag(context.Background(), remover, "rust"); err != nil {
		t.Fatalf("removing rust from the second item: %v", err)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ? AND tag_name = 'rust'`, remover); got != 1 {
		t.Fatalf("the removal record is %d, want 1", got)
	}

	tag, err := service.RenameTag(context.Background(), "rust", "  Rust Lang. ")
	if err != nil {
		t.Fatalf("the rename failed: %v", err)
	}
	if tag.Name != "rust lang" || tag.Count != 1 {
		t.Fatalf("the renamed tag is %s(%d), want rust lang(1)", tag.Name, tag.Count)
	}
	wantTags(t, tagsOf(t, service, carrier), "rust lang")
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_tags WHERE tag_name = 'rust'`); got != 0 {
		t.Errorf("%d rows still carry the old name", got)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ? AND tag_name = 'rust lang'`, remover); got != 1 {
		t.Errorf("the removal record did not follow the rename (%d rows under the new name)", got)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_tags WHERE name = 'rust lang'`); got != 1 {
		t.Errorf("the renamed tag holds %d vocabulary rows, want 1", got)
	}
}

// TestARenameIntoAnExistingTagMergesWithoutDuplicates is the merge: one tag
// where there were two, a manual row beating an automatic one on a collision,
// and an item's removal of the target tag staying a removal.
func TestARenameIntoAnExistingTagMergesWithoutDuplicates(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	// item-1 carries both spellings, one of each origin: the collision the
	// merge has to collapse without a duplicate row, manual on top.
	both := librarySaveOne(t, service, "https://example.org/merge-both", "").ID
	if _, err := service.AddItemTag(context.Background(), both, "llm"); err != nil {
		t.Fatalf("the hand add failed: %v", err)
	}
	// The automatic row of the same pair is written below, straight through,
	// because the service has no path to a duplicate pair.
	seedTag(t, database, both, "large language model")
	// item-2 carries only the automatic spelling.
	onlyAuto := librarySaveOne(t, service, "https://example.org/merge-auto", "").ID
	seedTag(t, database, onlyAuto, "large language model")
	// item-3 carried it too but removed llm by hand, which the merge must
	// read rather than override.
	remover := librarySaveOne(t, service, "https://example.org/merge-remover", "").ID
	seedTag(t, database, remover, "large language model")
	if _, err := service.AddItemTag(context.Background(), remover, "llm"); err != nil {
		t.Fatalf("the hand add failed: %v", err)
	}
	if _, err := service.RemoveItemTag(context.Background(), remover, "llm"); err != nil {
		t.Fatalf("the removal failed: %v", err)
	}

	tag, err := service.RenameTag(context.Background(), "large language model", "llm")
	if err != nil {
		t.Fatalf("the merge failed: %v", err)
	}
	if tag.Name != "llm" || tag.Count != 2 {
		t.Fatalf("the merged tag is %s(%d), want llm(2)", tag.Name, tag.Count)
	}

	// No duplicate rows anywhere, the two spellings gone, and the origins
	// read as the rules leave them.
	rows := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_tags WHERE tag_name IN ('large language model', 'llm')`)
	if rows != 2 {
		t.Fatalf("the merge left %d item rows, want 2", rows)
	}
	wantTags(t, tagsOf(t, service, both), "llm")
	var origin string
	if err := database.Reader().QueryRowContext(context.Background(),
		`SELECT origin FROM library_item_tags WHERE item_id = ? AND tag_name = 'llm'`, both).Scan(&origin); err != nil {
		t.Fatalf("reading the merged row's origin: %v", err)
	}
	if origin != "manual" {
		t.Errorf("the colliding row is %q, want manual: the hand add must beat the automatic one", origin)
	}
	wantTags(t, tagsOf(t, service, onlyAuto), "llm")
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_tags WHERE item_id = ? AND tag_name = 'llm'`, onlyAuto); got != 1 {
		t.Errorf("the item that carried one spelling now carries %d rows for the merged tag", got)
	}
	// item-3 removed llm by hand and must end with neither spelling: the tag
	// it dropped was the target, so the merge leaves it empty rather than
	// sneaking the tag back on.
	wantTags(t, tagsOf(t, service, remover))
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_item_removed_tags WHERE item_id = ? AND tag_name = 'llm'`, remover); got != 1 {
		t.Errorf("the removal record is %d, want 1, so the tagger stays refused for %s", got, remover)
	}
	if got := countRows(t, service,
		`SELECT COUNT(*) FROM library_tags WHERE name = 'large language model'`); got != 0 {
		t.Errorf("the folded spelling is still a tag in the vocabulary (%d rows)", got)
	}
	tags, err := service.Tags(context.Background())
	if err != nil {
		t.Fatalf("listing the tags: %v", err)
	}
	if len(tags) != 1 || tags[0].Name != "llm" || tags[0].Count != 2 {
		t.Fatalf("the vocabulary is %v, want llm(2) alone", tags)
	}
}

// TestARenameRefusesWhatItShould pins the 404 and the 400, and the no-op the
// contract names.
func TestARenameRefusesWhatItShould(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	seedTags(t, service, "https://example.org/rename-refuses", []string{"rust"})

	if _, err := service.RenameTag(context.Background(), "rust", "!!!"); err == nil {
		t.Error("a rename to an empty name was accepted")
	}
	if _, err := service.RenameTag(context.Background(), "docker", "memory"); err == nil {
		t.Error("a rename of a tag that does not exist was accepted")
	}
	tag, err := service.RenameTag(context.Background(), "rust", "rust")
	if err != nil {
		t.Fatalf("the same-name rename failed: %v", err)
	}
	if tag.Name != "rust" || tag.Count != 1 {
		t.Errorf("the same-name rename answered %s(%d), want rust(1)", tag.Name, tag.Count)
	}
	if got := countRows(t, service, `SELECT COUNT(*) FROM library_tags`); got != 1 {
		t.Errorf("the no-op rename left %d vocabulary rows, want 1", got)
	}
	wantTags(t, tagsOf(t, service, serviceFirstItem(t, service)), "rust")
}

// serviceFirstItem reads back the one item the seed above saved.
func serviceFirstItem(t *testing.T, service *LibraryService) string {
	t.Helper()
	result, err := service.List(context.Background(), ListInput{Limit: 1})
	if err != nil {
		t.Fatalf("listing: %v", err)
	}
	if len(result.Items) != 1 {
		t.Fatalf("the list holds %d items, want 1", len(result.Items))
	}
	return result.Items[0].ID
}

// TestTheTagFilterKeepsOnlyTaggedItemsAndBindsItsCursor is the list side: a
// tag filter that reads the normalized name, keeps only carriers, and
// refuses a cursor that belongs to another tag.
func TestTheTagFilterKeepsOnlyTaggedItemsAndBindsItsCursor(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	rustOne := seedTags(t, service, "https://example.org/filter-a", []string{"rust"})
	llmOne := seedTags(t, service, "https://example.org/filter-b", []string{"llm"})
	llmTwo := seedTags(t, service, "https://example.org/filter-d", []string{"llm"})
	seedTags(t, service, "https://example.org/filter-c", nil)

	filtered, err := service.List(context.Background(), ListInput{View: "all", Tag: "rust"})
	if err != nil {
		t.Fatalf("the filtered list failed: %v", err)
	}
	if len(filtered.Items) != 1 || filtered.Items[0].ID != rustOne {
		t.Fatalf("view=all with the rust filter listed %d items, want only %s", len(filtered.Items), rustOne)
	}

	// The filter reads the normalized name, so the casing the caller typed
	// changes nothing.
	again, err := service.List(context.Background(), ListInput{View: "all", Tag: " Rust! "})
	if err != nil {
		t.Fatalf("the normalized filter failed: %v", err)
	}
	if len(again.Items) != 1 || again.Items[0].ID != rustOne {
		t.Fatalf("view=all with Rust! as the filter listed %d items, want the rust ones", len(again.Items))
	}

	page, err := service.List(context.Background(), ListInput{Tag: "llm", Limit: 1})
	if err != nil {
		t.Fatalf("the paged list failed: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("the llm page holds %d items, want 1", len(page.Items))
	}
	// The saves share one clock, so the page order is the id's, not a date
	// the test could name; what it can assert is that the two pages split
	// the two carriers and never repeat one.
	first := page.Items[0].ID
	if first != llmOne && first != llmTwo {
		t.Fatalf("the llm page holds %s, want one of the two carriers", first)
	}
	if page.NextCursor == "" {
		t.Fatal("the llm page carried no cursor, want one for the pages that follow")
	}
	bound, err := service.List(context.Background(), ListInput{Tag: "llm", Cursor: page.NextCursor})
	if err != nil {
		t.Fatalf("the cursor continued nowhere: %v", err)
	}
	if len(bound.Items) != 1 {
		t.Fatalf("the llm cursor continued onto %d items, want the other carrier", len(bound.Items))
	}
	if second := bound.Items[0].ID; second != llmOne && second != llmTwo {
		t.Fatalf("the cursor continued onto %s, want the other carrier", second)
	} else if second == first {
		t.Fatalf("the cursor repeated %s instead of continuing past it", second)
	}
	if _, err := service.List(context.Background(), ListInput{Tag: "rust", Cursor: page.NextCursor}); err == nil {
		t.Error("a cursor bound to llm was accepted under the rust filter")
	} else if domain, ok := err.(*LibraryError); !ok || domain.Code != "invalid_cursor" {
		t.Errorf("the stray cursor failed with %v, want an invalid_cursor request error", err)
	}

	if _, err := service.List(context.Background(), ListInput{View: "all", Tag: "!!!"}); err == nil {
		t.Error("a tag that normalizes to nothing was accepted as a filter")
	}
}

// TestTheCountsCountOnlyTaggedItems is the counts side of the same filter.
func TestTheCountsCountOnlyTaggedItems(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	rustOne := seedTags(t, service, "https://example.org/counts-a", []string{"rust"})
	librarySaveOne(t, service, "https://example.org/counts-b", "")
	librarySaveOne(t, service, "https://example.org/counts-c", "")
	// The tagged item is moved out of the inbox, so the tagged counts have a
	// view with a zero to show beside the one.
	place := "archive"
	if _, err := service.Patch(context.Background(), rustOne, PatchInput{Location: &place}); err != nil {
		t.Fatalf("placing the tagged item in the archive: %v", err)
	}

	counts, err := service.Counts(context.Background(), "rust")
	if err != nil {
		t.Fatalf("the tagged counts failed: %v", err)
	}
	// The archive is where the tagged item sits, so it reads 1 and the inbox
	// reads 0 -- the header a tag-filtered screen shows.
	if counts.Views.All != 1 || counts.Views.Inbox != 0 || counts.Views.Archive != 1 {
		t.Fatalf("the rust counts are all=%d inbox=%d archive=%d, want 1/0/1 over the tagged item",
			counts.Views.All, counts.Views.Inbox, counts.Views.Archive)
	}
	if counts.Unread != 1 {
		t.Errorf("the rust count of unread is %d, want 1", counts.Unread)
	}

	whole, err := service.Counts(context.Background(), "")
	if err != nil {
		t.Fatalf("the whole counts failed: %v", err)
	}
	if whole.Views.All != 3 {
		t.Errorf("the whole library counts %d items, want 3", whole.Views.All)
	}
	if _, err := service.Counts(context.Background(), "!!!"); err == nil {
		t.Error("counts for a tag that normalizes to nothing were answered")
	}
}

// TestTheTagEndpointsAnswerThroughTheRouter drives the four new endpoints
// over the real router: the contract is what the wire sees, and the statuses
// are what the UI bead depends on.
func TestTheTagEndpointsAnswerThroughTheRouter(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	id := librarySaveRouterHelper(t, handler, "https://example.org/wire-a")
	other := librarySaveRouterHelper(t, handler, "https://example.org/wire-b")

	// The add writes by hand and answers the item's tags sorted.
	status, body := libraryRequest(t, handler, http.MethodPost,
		"/api/library/items/"+id+"/tags", map[string]any{"name": "  Rust, "})
	if status != http.StatusOK {
		t.Fatalf("POST tags answered %d: %v", status, body)
	}
	if fmt.Sprint(body["tags"]) != "[rust]" {
		t.Fatalf("the add answered tags %v, want [rust]", body["tags"])
	}
	status, body = libraryRequest(t, handler, http.MethodPost,
		"/api/library/items/"+id+"/tags", map[string]any{"name": "llm"})
	if status != http.StatusOK || fmt.Sprint(body["tags"]) != "[llm rust]" {
		t.Fatalf("the second add answered %d %v, want [llm rust]", status, body["tags"])
	}
	// The second item carries the spelling that is about to be folded in, so
	// the counts below have a merge to prove.
	status, _ = libraryRequest(t, handler, http.MethodPost,
		"/api/library/items/"+other+"/tags", map[string]any{"name": "llm"})
	if status != http.StatusOK {
		t.Fatalf("the second item's add answered %d", status)
	}

	// The list reads its tags before anything is folded, in the order the
	// vocabulary reads them -- not the order they were written in.
	status, body = libraryRequest(t, handler, http.MethodGet,
		"/api/library/items?view=all", nil)
	if status != http.StatusOK {
		t.Fatalf("the list answered %d: %v", status, body)
	}
	for _, item := range body["items"].([]any) {
		summary := item.(map[string]any)
		if summary["id"] == id && fmt.Sprint(summary["tags"]) != "[llm rust]" {
			t.Fatalf("the summary carries tags %v, want [llm rust], sorted", summary["tags"])
		}
	}

	// The vocabulary reads back through its own endpoint, most used first.
	status, body = libraryRequest(t, handler, http.MethodGet, "/api/library/tags", nil)
	if status != http.StatusOK {
		t.Fatalf("GET tags answered %d: %v", status, body)
	}
	list := body["tags"].([]any)
	if len(list) != 2 {
		t.Fatalf("the vocabulary holds %d tags, want 2", len(list))
	}
	if list[0].(map[string]any)["name"] != "llm" || list[0].(map[string]any)["count"] != float64(2) {
		t.Fatalf("the vocabulary starts with %v, want llm(2)", list[0])
	}
	if list[1].(map[string]any)["name"] != "rust" {
		t.Fatalf("the second tag is %v, want rust", list[1])
	}

	// The second item reads both spellings now, because the merge folds the
	// one into the other.
	status, body = libraryRequest(t, handler, http.MethodPatch,
		"/api/library/tags/rust", map[string]any{"name": "llm"})
	if status != http.StatusOK {
		t.Fatalf("PATCH tag answered %d: %v", status, body)
	}
	if body["name"] != "llm" || body["count"] != float64(2) {
		t.Fatalf("the merge answered %v, want llm(2)", body)
	}

	// The rename is refused for a tag that is no longer there.
	status, body = libraryRequest(t, handler, http.MethodPatch,
		"/api/library/tags/rust", map[string]any{"name": "llm"})
	if status != http.StatusNotFound {
		t.Fatalf("PATCH a missing tag answered %d: %v", status, body)
	}

	// The summaries carry their tags, sorted.
	status, body = libraryRequest(t, handler, http.MethodGet,
		"/api/library/items/"+id, nil)
	if status != http.StatusOK {
		t.Fatalf("GET detail answered %d: %v", status, body)
	}
	if fmt.Sprint(body["tags"]) != "[llm]" {
		t.Fatalf("the detail carries tags %v, want [llm] after the merge", body["tags"])
	}
	status, body = libraryRequest(t, handler, http.MethodGet,
		"/api/library/items?view=all", nil)
	if status != http.StatusOK {
		t.Fatalf("the list answered %d: %v", status, body)
	}
	items := body["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("the list holds %d items, want 2", len(items))
	}
	for _, item := range items {
		if item.(map[string]any)["tags"] == nil {
			t.Fatalf("a summary carries no tags field: %v", item)
		}
	}

	// The removal records itself and answers what remains.
	status, body = libraryRequest(t, handler, http.MethodDelete,
		"/api/library/items/"+id+"/tags/llm", nil)
	if status != http.StatusOK || fmt.Sprint(body["tags"]) != "[]" {
		t.Fatalf("DELETE answered %d %v, want an empty list", status, body["tags"])
	}
	status, _ = libraryRequest(t, handler, http.MethodDelete,
		"/api/library/items/"+id+"/tags/llm", nil)
	if status != http.StatusNotFound {
		t.Fatalf("a second DELETE answered %d, want 404", status)
	}

	// The add endpoint refuses what the service refuses, with the envelope
	// the contract names.
	status, _ = libraryRequest(t, handler, http.MethodPost,
		"/api/library/items/"+id+"/tags", map[string]any{"name": "!!!"})
	if status != http.StatusBadRequest {
		t.Fatalf("an empty tag answered %d, want 400", status)
	}
	status, _ = libraryRequest(t, handler, http.MethodPost,
		"/api/library/items/"+id+"-gone/tags", map[string]any{"name": "llm"})
	if status != http.StatusNotFound {
		t.Fatalf("an add for a missing item answered %d, want 404", status)
	}

	// The counts read the tag filter. The first item removed its llm by hand
	// in the step above, which is exactly what the counts must see: only the
	// second item still carries it.
	status, body = libraryRequest(t, handler, http.MethodGet,
		"/api/library/counts?tag=llm", nil)
	if status != http.StatusOK {
		t.Fatalf("GET counts with a tag answered %d: %v", status, body)
	}
	views := body["views"].(map[string]any)
	if views["all"] != float64(1) {
		t.Fatalf("the llm counts read all=%v, want 1", views["all"])
	}

	// The list reads the tag filter too, under the same hand removal.
	status, body = libraryRequest(t, handler, http.MethodGet,
		"/api/library/items?view=all&tag=llm", nil)
	if status != http.StatusOK {
		t.Fatalf("the filtered list answered %d: %v", status, body)
	}
	filtered := body["items"].([]any)
	if len(filtered) != 1 {
		t.Fatalf("the llm filter listed %d items, want 1", len(filtered))
	}

	// The draw answers summaries that carry the tags field as well.
	status, body = libraryRequest(t, handler, http.MethodGet,
		"/api/library/items/random?away_from_focus=false", nil)
	if status != http.StatusOK {
		t.Fatalf("the draw answered %d: %v", status, body)
	}
	drawn := body["items"].([]any)
	if len(drawn) == 0 || drawn[0].(map[string]any)["tags"] == nil {
		t.Fatalf("the drawn summary carries no tags field: %v", body)
	}
}

// librarySaveRouterHelper saves one link through the router and answers its id.
func librarySaveRouterHelper(t *testing.T, handler http.Handler, pageURL string) string {
	t.Helper()
	_, body := libraryPostSave(t, handler, map[string]any{"url": pageURL})
	return body["id"].(string)
}

// libraryRequest sends one request and decodes the JSON body it answered.
func libraryRequest(t *testing.T, handler http.Handler, method, path string, body any) (int, map[string]any) {
	t.Helper()
	response := doLibraryRequest(t, handler, method, path, body)
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the %s %s answer is not JSON: %v (%q)", method, path, err, response.Body.String())
	}
	return response.Code, decoded
}
