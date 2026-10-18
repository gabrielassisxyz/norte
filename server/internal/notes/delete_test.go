package notes

import (
	"net/http"
	"testing"
)

// TestDeletingALibraryItemTakesItsNotesWithIt is the cross-module half of the
// delete, through the library's own route: the passage, the margin notes and
// the note written on an item go when the item goes, and the questions stay.
//
// It deletes over HTTP rather than publishing the event by hand, so the event
// name is the one the library actually publishes and the subscription is the
// one the module installs. A test that published the name itself would keep
// passing after either side renamed it.
func TestDeletingALibraryItemTakesItsNotesWithIt(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Retention and memory", "Before. The marked passage. After.")
	other := harness.saveArticle("Another article", "Before. Another passage. After.")

	highlight, err := harness.service.CreateHighlight(t.Context(), NewHighlightInput{
		ItemID: itemID, Exact: "The marked passage",
	})
	if err != nil {
		t.Fatalf("creating the highlight: %v", err)
	}
	for _, text := range []string{"the first margin note", "the second margin note"} {
		if _, err := harness.service.CreateAnnotation(t.Context(), NewAnnotationInput{
			ItemID: itemID, HighlightID: highlight.Row.ID, Text: text,
		}); err != nil {
			t.Fatalf("creating the annotation %q: %v", text, err)
		}
	}
	loose, err := harness.service.CreateAnnotation(t.Context(), NewAnnotationInput{
		ItemID: itemID, Text: "a margin note with no passage",
	})
	if err != nil {
		t.Fatalf("creating the annotation without a highlight: %v", err)
	}
	if _, _, err := harness.service.PutItemNote(t.Context(), itemID, "what this article is for"); err != nil {
		t.Fatalf("writing the note: %v", err)
	}
	question, err := harness.service.CreateQuestion(t.Context(), NewQuestionInput{
		ItemID: itemID, AnnotationID: loose.Row.ID, Text: "Why does rehearsal fail?",
	})
	if err != nil {
		t.Fatalf("creating the question: %v", err)
	}
	if _, err := harness.service.UpdateQuestion(t.Context(), question.Row.ID, NotesQuestionPatch{
		Answer: notesTestString("because the cue is gone"),
		Status: notesTestString("answered"),
	}); err != nil {
		t.Fatalf("answering the question: %v", err)
	}
	// Another item's note, which must be untouched: a reaction that deleted by
	// nothing at all would pass every assertion about the deleted one.
	keptHighlight, err := harness.service.CreateHighlight(t.Context(), NewHighlightInput{
		ItemID: other, Exact: "Another passage",
	})
	if err != nil {
		t.Fatalf("creating the other item's highlight: %v", err)
	}
	if _, _, err := harness.service.PutItemNote(t.Context(), other, "the other article's note"); err != nil {
		t.Fatalf("writing the other item's note: %v", err)
	}

	answer, status, updated := notesQuestionFields(t, harness, question.Row.ID)

	// The clock moves before the delete so that "the question was touched" is
	// a different stamp rather than the same one written twice.
	harness.clock.Advance(notesWorkerStep)
	deleted := harness.request(http.MethodDelete, "/api/library/items/"+itemID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("deleting the item answered %d, want 204: %s", deleted.Code, deleted.Body.String())
	}

	for _, check := range []struct {
		what  string
		query string
	}{
		{"notes_highlights", `SELECT COUNT(*) FROM notes_highlights WHERE item_id = ?`},
		{"notes_annotations", `SELECT COUNT(*) FROM notes_annotations WHERE item_id = ?`},
		{"notes_notes", `SELECT COUNT(*) FROM notes_notes WHERE item_id = ?`},
	} {
		if rows := notesCountRows(t, harness, check.query, itemID); rows != 0 {
			t.Errorf("%s still holds %d row(s) for the deleted item", check.what, rows)
		}
	}

	if rows := notesCountRows(t, harness,
		`SELECT COUNT(*) FROM notes_questions WHERE id = ? AND item_id IS NULL`, question.Row.ID); rows != 1 {
		t.Errorf("the question is not kept with a NULL item (%d matching row(s))", rows)
	}
	nowAnswer, nowStatus, nowUpdated := notesQuestionFields(t, harness, question.Row.ID)
	if nowAnswer != answer || nowStatus != status {
		t.Errorf("the question now answers %q at %q, want %q at %q",
			nowAnswer, nowStatus, answer, status)
	}
	if nowUpdated == updated {
		t.Errorf("updated_at is still %q, so losing the item was not recorded", updated)
	}
	if question.Row.Text == "" {
		t.Fatal("the fixture question has no text, so its survival proves nothing")
	}
	if rows := notesCountRows(t, harness,
		`SELECT COUNT(*) FROM notes_questions WHERE id = ? AND text = ?`,
		question.Row.ID, question.Row.Text); rows != 1 {
		t.Errorf("the question's own sentence did not survive the delete (%d matching row(s))", rows)
	}

	if rows := notesCountRows(t, harness,
		`SELECT COUNT(*) FROM notes_highlights WHERE id = ?`, keptHighlight.Row.ID); rows != 1 {
		t.Errorf("the other item's highlight went with the delete (%d row(s))", rows)
	}
	if rows := notesCountRows(t, harness,
		`SELECT COUNT(*) FROM notes_notes WHERE item_id = ?`, other); rows != 1 {
		t.Errorf("the other item's note went with the delete (%d row(s))", rows)
	}
}

func notesTestString(value string) *string { return &value }

func notesCountRows(t *testing.T, harness *notesHarness, query string, args ...any) int {
	t.Helper()
	var count int
	if err := harness.database.Reader().QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("counting (%s): %v", query, err)
	}
	return count
}

// notesQuestionFields reads what a delete must leave alone, plus the stamp it
// must move.
func notesQuestionFields(t *testing.T, harness *notesHarness, id string) (string, string, string) {
	t.Helper()
	var answer, status, updated string
	if err := harness.database.Reader().QueryRow(
		`SELECT COALESCE(answer, ''), status, updated_at FROM notes_questions WHERE id = ?`,
		id).Scan(&answer, &status, &updated); err != nil {
		t.Fatalf("reading the question %s: %v", id, err)
	}
	return answer, status, updated
}
