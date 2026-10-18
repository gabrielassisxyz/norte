package notes

import (
	"net/http"
	"strings"
	"testing"
)

// The article every case here re-selects inside. The two passages are distinct
// sentences so that a search for either one has exactly one answer, and the
// corrected passage is longer than the first, which is the mistake the person
// is fixing: a mark that caught a few words too few.
const (
	notesReselectText      = "Before the passage. The marked passage. After the passage. A later sentence entirely."
	notesReselectShort     = "The marked passage."
	notesReselectCorrected = "The marked passage. After the passage."
)

// TestReSelectingAPassageKeepsTheNotesWrittenOnIt is the whole point of the
// route: a mark that caught the wrong words is corrected rather than deleted
// and made again, and the note written on it is still on it afterwards.
//
// The offset is counted against the article's own text here rather than read
// off the answer, because an assertion against whatever came back would hold
// for any number -- including the hint the request sent, which is what the
// server must not store.
func TestReSelectingAPassageKeepsTheNotesWrittenOnIt(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("A text to correct a mark in", notesReselectText)

	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   notesReselectShort,
			"prefix":  "Before the passage. ",
			"suffix":  " After the passage.",
		}), http.StatusCreated)
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{
			"item_id":      itemID,
			"highlight_id": highlight.ID,
			"text":         "Worth coming back to.",
		}), http.StatusCreated)

	moved := notesDecode[notesHighlightBody](t,
		harness.request(http.MethodPatch, "/api/notes/highlights/"+highlight.ID, map[string]any{
			"exact":         notesReselectCorrected,
			"prefix":        "Before the passage. ",
			"suffix":        " A later sentence entirely.",
			"position_hint": 0,
		}), http.StatusOK)

	if moved.ID != highlight.ID {
		t.Fatalf("the highlight came back as %s, want the id it had, %s", moved.ID, highlight.ID)
	}
	if moved.Exact != notesReselectCorrected {
		t.Fatalf("the passage came back %q, want %q", moved.Exact, notesReselectCorrected)
	}
	if moved.Status != NotesAnchored {
		t.Fatalf("the highlight came back %q, want anchored", moved.Status)
	}
	want := len([]rune(notesReselectText[:strings.Index(notesReselectText, notesReselectCorrected)]))
	if moved.Hint != want {
		t.Fatalf("the corrected passage was anchored at %d, want %d", moved.Hint, want)
	}
	if moved.ItemID != itemID {
		t.Fatalf("the highlight came back on the item %s, want %s", moved.ItemID, itemID)
	}

	// The note is what the id was kept for, so it is read back from storage
	// rather than inferred from the answer above.
	listed := notesDecode[struct {
		Items []notesAnnotationBody `json:"items"`
	}](t, harness.request(http.MethodGet, "/api/notes/annotations?item_id="+itemID, nil), http.StatusOK)
	if len(listed.Items) != 1 {
		t.Fatalf("the item carries %d annotations, want 1: %+v", len(listed.Items), listed.Items)
	}
	if listed.Items[0].ID != annotation.ID || listed.Items[0].HighlightID != highlight.ID {
		t.Fatalf("the note no longer hangs on the corrected passage: %+v", listed.Items[0])
	}
	if listed.Items[0].Quote != notesReselectCorrected {
		t.Fatalf("the note quotes %q, want the corrected passage", listed.Items[0].Quote)
	}
}

// TestAPassageReSelectedToNothingIsRefused keeps the one rule a replacement
// shares with a creation: a highlight is the words the person marked, and no
// words is not a passage. The whitespace is what makes it a case of its own --
// the contract cannot say "not empty once the whitespace is collapsed", so the
// refusal has to come from the module and name the field.
func TestAPassageReSelectedToNothingIsRefused(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("A text to correct a mark in", notesReselectText)
	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": notesReselectShort}), http.StatusCreated)

	field := notesRefusal(t, harness.request(http.MethodPatch, "/api/notes/highlights/"+highlight.ID,
		map[string]any{"exact": "   \n ", "prefix": "", "suffix": "", "position_hint": 0}),
		http.StatusBadRequest)
	if field != "exact" {
		t.Fatalf("the refusal named the field %q, want exact", field)
	}

	// Refused means nothing was written: the passage is the one it was.
	kept := notesDecode[notesHighlightListBody](t,
		harness.request(http.MethodGet, "/api/notes/highlights?item_id="+itemID, nil), http.StatusOK)
	if len(kept.Items) != 1 || kept.Items[0].Exact != notesReselectShort {
		t.Fatalf("the stored passage is %+v, want the one it had", kept.Items)
	}
}

// TestReSelectingAPassageOfAHighlightThatIsNotThere answers for an id nothing
// stored: a typo is a 404 rather than a row created out of a replacement.
func TestReSelectingAPassageOfAHighlightThatIsNotThere(t *testing.T) {
	harness := newNotesHarness(t)
	harness.saveArticle("A text nobody marked", notesReselectText)

	recorder := harness.request(http.MethodPatch, "/api/notes/highlights/no-such-highlight", map[string]any{
		"exact":         notesReselectCorrected,
		"prefix":        "",
		"suffix":        "",
		"position_hint": 0,
	})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", recorder.Code, recorder.Body.String())
	}
}

// TestReSelectingAnOrphanedPassageAnchorsItAgain is how a passage the server
// could not place is placed by hand: the person is looking at the words in the
// article, which is better evidence than a search that already failed.
func TestReSelectingAnOrphanedPassageAnchorsItAgain(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("A text that lost a passage", notesReselectText)

	orphan := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   "A sentence this article never held.",
		}), http.StatusCreated)
	if orphan.Status != NotesOrphaned {
		t.Fatalf("the highlight came back %q, want orphaned", orphan.Status)
	}

	moved := notesDecode[notesHighlightBody](t,
		harness.request(http.MethodPatch, "/api/notes/highlights/"+orphan.ID, map[string]any{
			"exact":         notesReselectShort,
			"prefix":        "Before the passage. ",
			"suffix":        " After the passage.",
			"position_hint": 0,
		}), http.StatusOK)
	if moved.Status != NotesAnchored {
		t.Fatalf("the re-selected passage came back %q, want anchored", moved.Status)
	}

	status, hint := harness.highlightStatus(orphan.ID)
	if status != NotesAnchored {
		t.Fatalf("the stored status is %q, want anchored", status)
	}
	want := int64(len([]rune(notesReselectText[:strings.Index(notesReselectText, notesReselectShort)])))
	if hint != want {
		t.Fatalf("the stored offset is %d, want %d", hint, want)
	}
}
