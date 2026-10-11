package notes

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// The search fixtures are written with ids the test chooses, because an
// assertion about two equally ranked hits is about the ranking and not about
// which uuid the generator produced.
func (h *notesHarness) seedAnnotation(id, itemID, text string) {
	h.t.Helper()
	stamp := core.FormatTime(notesFixedInstant)
	if _, err := h.database.Writer().Exec(
		`INSERT INTO notes_annotations (id, item_id, text, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`, id, itemID, text, stamp, stamp); err != nil {
		h.t.Fatalf("seeding the annotation %q: %v", id, err)
	}
}

func (h *notesHarness) seedItemNote(id, itemID, text string) {
	h.t.Helper()
	stamp := core.FormatTime(notesFixedInstant)
	if _, err := h.database.Writer().Exec(
		`INSERT INTO notes_notes (id, item_id, text, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`, id, itemID, text, stamp, stamp); err != nil {
		h.t.Fatalf("seeding the item note %q: %v", id, err)
	}
}

func (h *notesHarness) seedQuestion(id, itemID, text, answer string) {
	h.t.Helper()
	stamp := core.FormatTime(notesFixedInstant)
	if _, err := h.database.Writer().Exec(
		`INSERT INTO notes_questions
		   (id, item_id, kind, text, answer, status, created_at, updated_at)
		 VALUES (?, ?, 'what', ?, ?, 'open', ?, ?)`,
		id, itemID, text, answer, stamp, stamp); err != nil {
		h.t.Fatalf("seeding the question %q: %v", id, err)
	}
}

func (h *notesHarness) seedHighlight(id, itemID, exact string) {
	h.t.Helper()
	stamp := core.FormatTime(notesFixedInstant)
	if _, err := h.database.Writer().Exec(
		`INSERT INTO notes_highlights (id, item_id, exact, prefix, suffix, created_at)
		 VALUES (?, ?, ?, '', '', ?)`, id, itemID, exact, stamp); err != nil {
		h.t.Fatalf("seeding the highlight %q: %v", id, err)
	}
}

func notesSearchIDs(entries []core.SearchEntry) []string {
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

func (h *notesHarness) search(query string, limit int) []core.SearchEntry {
	h.t.Helper()
	entries, err := notesSearchEntries(context.Background(), h.database, query, limit)
	if err != nil {
		h.t.Fatalf("searching the notes for %q: %v", query, err)
	}
	return entries
}

// TestEachKindOfWritingIsFoundAndCarriesItsDestination is the module's whole
// contribution: the three places the person writes, each pointing at where it
// is read -- an annotation and a question at the tab that lists them, an
// item's note at its item's reader, which is the only place it is shown.
func TestEachKindOfWritingIsFoundAndCarriesItsDestination(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the article text")
	harness.seedAnnotation("ann-1", item, "the blowgun appears here")
	harness.seedItemNote("note-1", item, "a note about the blowgun")
	harness.seedQuestion("q-1", item, "what is a blowgun?", "")

	entries := harness.search("blowgun", 10)
	byID := map[string]core.SearchEntry{}
	for _, entry := range entries {
		byID[entry.ID] = entry
	}
	for id, wantKind := range map[string]string{
		"ann-1": "annotation", "note-1": "note", "q-1": "question",
	} {
		entry, found := byID[id]
		if !found {
			t.Fatalf("%s is missing from %v", id, notesSearchIDs(entries))
		}
		if entry.Type != wantKind {
			t.Fatalf("%s came back as type %q, want %q", id, entry.Type, wantKind)
		}
		if entry.Module != ModuleName {
			t.Fatalf("%s came back from module %q, want %q", id, entry.Module, ModuleName)
		}
		if entry.Subtitle != "About habits" {
			t.Fatalf("%s renders its origin as %q, want the item's title", id, entry.Subtitle)
		}
	}
	if byID["q-1"].Path != notesQuestionsPath {
		t.Fatalf("a question points at %q, want %q", byID["q-1"].Path, notesQuestionsPath)
	}
	if byID["ann-1"].Path != notesAnnotationsPath {
		t.Fatalf("an annotation points at %q, want %q", byID["ann-1"].Path, notesAnnotationsPath)
	}
	// The wants are written out rather than built from the constants above: a
	// test whose expectations the code under test computes proves nothing.
	if byID["q-1"].Path != "/notes?tab=questions" {
		t.Fatalf("a question points at %q, want the questions tab", byID["q-1"].Path)
	}
	if byID["ann-1"].Path != "/notes?tab=annotations" {
		t.Fatalf("an annotation points at %q, want the annotations tab", byID["ann-1"].Path)
	}
}

// TestAnItemNoteHitOpensTheItemsReaderOnItsNote is the one hit with no tab:
// an item's note is listed on no notes tab, so the hit opens the item's
// reader with the note asked for.
func TestAnItemNoteHitOpensTheItemsReaderOnItsNote(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedItemNote("note-1", item, "a note about the blowgun")

	entries := harness.search("blowgun", 10)
	if len(entries) != 1 {
		t.Fatalf("the query matched %v, want only note-1", notesSearchIDs(entries))
	}
	entry := entries[0]
	if entry.Type != "note" {
		t.Fatalf("the hit came back as type %q, want %q", entry.Type, "note")
	}
	// The want is written out rather than built by the path helper: a test
	// whose expectation the code under test computes proves nothing.
	if want := "/library/" + item + "?notes=note"; entry.Path != want {
		t.Fatalf("an item note points at %q, want %q", entry.Path, want)
	}
}

// TestAHighlightIsNeverASearchHit is the deliberate exclusion: a highlight is
// a passage copied out of an article, so indexing it would make one article
// answer the same query twice -- once as itself and once as every passage
// marked in it.
func TestAHighlightIsNeverASearchHit(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "a text with blowgun in it")
	harness.seedHighlight("hl-1", item, "blowgun")

	if entries := harness.search("blowgun", 10); len(entries) != 0 {
		t.Fatalf("a highlight was returned as %v, want no notes hit", notesSearchIDs(entries))
	}
}

// TestAQuestionIsFoundByItsAnswer is why the answer is part of the searched
// text: the pair is one thought, and the conclusion is the half worth finding.
func TestAQuestionIsFoundByItsAnswer(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedQuestion("q-1", item, "what became clear?", "that the blowgun is a tube")

	entries := harness.search("blowgun", 10)
	if got := notesSearchIDs(entries); len(got) != 1 || got[0] != "q-1" {
		t.Fatalf("the answer matched %v, want only q-1", got)
	}
}

// TestANoteRepeatingTheWordOutranksOneMentioningItOnce is the raw-to-score
// mapping: the raw value is how often the note comes back to what was asked,
// and the mapping puts the most insistent note at 1 and the least at 0.
func TestANoteRepeatingTheWordOutranksOneMentioningItOnce(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedAnnotation("ann-once", item, "mentions blowgun once")
	harness.seedAnnotation("ann-twice", item, "blowgun here and blowgun there")
	harness.seedAnnotation("ann-thrice", item,
		"blowgun, blowgun and blowgun again")

	entries := harness.search("blowgun", 10)
	want := []string{"ann-thrice", "ann-twice", "ann-once"}
	if got := notesSearchIDs(entries); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("the hits came back as %v, want %v", got, want)
	}
	if entries[0].Score != 1 {
		t.Fatalf("the most insistent note scored %v, want 1", entries[0].Score)
	}
	if entries[2].Score != 0 {
		t.Fatalf("the least insistent note scored %v, want 0", entries[2].Score)
	}
	if middle := entries[1].Score; middle <= 0 || middle >= 1 {
		t.Fatalf("the middle note scored %v, want it strictly between 0 and 1", middle)
	}
}

// TestASingleNotesHitScoresOne is the degenerate end of the same mapping:
// with one hit there is no spread, and 0 would bury a query's only answer
// under every other module's.
func TestASingleNotesHitScoresOne(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedAnnotation("ann-1", item, "mentions blowgun once")
	harness.seedAnnotation("ann-2", item, "talks about something else")

	entries := harness.search("blowgun", 10)
	if len(entries) != 1 {
		t.Fatalf("the query matched %v, want one hit", notesSearchIDs(entries))
	}
	if entries[0].Score != 1 {
		t.Fatalf("the only hit scored %v, want 1", entries[0].Score)
	}
}

// TestNotesHitsThatRankEquallyAllScoreOne is the all-equal case: three notes
// repeating the word the same number of times are all the best of the query.
func TestNotesHitsThatRankEquallyAllScoreOne(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	for i := 0; i < 3; i++ {
		harness.seedAnnotation(fmt.Sprintf("ann-%d", i), item, "blowgun twice: blowgun")
	}

	entries := harness.search("blowgun", 10)
	if len(entries) != 3 {
		t.Fatalf("the query matched %v, want three hits", notesSearchIDs(entries))
	}
	for _, entry := range entries {
		if entry.Score != 1 {
			t.Fatalf("%s scored %v, want 1", entry.ID, entry.Score)
		}
	}
}

// TestAnAccentlessQueryFindsAnAccentedNote is what routing the comparison
// through the core's slug rule buys: nobody types the accents into a search
// box, and a note written properly must still be found.
func TestAnAccentlessQueryFindsAnAccentedNote(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedAnnotation("ann-1", item, "the na\u00efve working memory is limited")
	harness.seedAnnotation("ann-2", item, "nothing about that")

	entries := harness.search("naive", 10)
	if got := notesSearchIDs(entries); len(got) != 1 || got[0] != "ann-1" {
		t.Fatalf("the accentless query matched %v, want only ann-1", got)
	}
}

// TestTheNotesProviderNeverAnswersMoreThanItsLimit is the per-provider cap,
// and the cut has to fall on the weakest hits rather than on whichever row
// the scan reached last.
func TestTheNotesProviderNeverAnswersMoreThanItsLimit(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	for i := 0; i < 15; i++ {
		// The repeated word count rises with i, so the three the limit keeps
		// out are knowably the three weakest.
		harness.seedAnnotation(fmt.Sprintf("ann-%02d", i), item,
			strings.TrimSpace(strings.Repeat("blowgun ", i+1)))
	}

	entries := harness.search("blowgun", 3)
	want := []string{"ann-14", "ann-13", "ann-12"}
	if got := notesSearchIDs(entries); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("a limit of 3 kept %v, want the three strongest %v", got, want)
	}
}

// TestANotesHitTitleIsAOneLineExcerpt keeps a paragraph from being pasted
// into a palette row: the title is a line, and the rest is read on the tab
// the hit opens.
func TestANotesHitTitleIsAOneLineExcerpt(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedAnnotation("ann-1", item,
		"blowgun\n\n"+strings.Repeat("word ", 60))

	entries := harness.search("blowgun", 10)
	if len(entries) != 1 {
		t.Fatalf("the query matched %v, want one hit", notesSearchIDs(entries))
	}
	title := entries[0].Title
	if strings.ContainsAny(title, "\n\r") {
		t.Fatalf("the title holds a newline: %q", title)
	}
	if len([]rune(title)) > notesSearchTitleRunes+1 {
		t.Fatalf("the title is %d runes, want at most %d plus the ellipsis",
			len([]rune(title)), notesSearchTitleRunes)
	}
	if !strings.HasSuffix(title, "…") {
		t.Fatalf("a cut title is %q, want it to end in an ellipsis", title)
	}
}

// TestEveryWordOfTheNotesQueryIsCountedOnce guards the ranking against a word
// of the query that is not in the note at all: it must not be able to raise a
// note's count, which a substring count over a joined query would do.
func TestEveryWordOfTheNotesQueryIsCountedOnce(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	harness.seedAnnotation("ann-both", item, "blowgun and tambourine")
	harness.seedAnnotation("ann-one", item, "blowgun blowgun")

	// Every word has to be there, so the note repeating one of the three
	// does not match while the one carrying all three does.
	entries := harness.search("blowgun and tambourine", 10)
	if got := notesSearchIDs(entries); len(got) != 1 || got[0] != "ann-both" {
		t.Fatalf("the fragment matched %v, want only ann-both", got)
	}
}

// TestEveryNotesScoreIsInTheContractsRange is the invariant the merge
// enforces and refuses.
func TestEveryNotesScoreIsInTheContractsRange(t *testing.T) {
	harness := newNotesHarness(t)
	item := harness.saveArticle("About habits", "the text")
	for i := 0; i < 12; i++ {
		harness.seedAnnotation(fmt.Sprintf("ann-%02d", i), item,
			strings.TrimSpace(strings.Repeat("blowgun ", i*3+1)))
	}

	entries := harness.search("blowgun", 10)
	if len(entries) == 0 {
		t.Fatal("the fixtures matched nothing")
	}
	for _, entry := range entries {
		if !core.ValidSearchScore(entry.Score) {
			t.Fatalf("%s scored %v, outside [0, 1]", entry.ID, entry.Score)
		}
	}
}
