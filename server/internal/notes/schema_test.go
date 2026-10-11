package notes

import (
	"net/http"
	"strings"
	"testing"
)

// TestNoNotesTableHasAForeignKeyOutsideItsOwnModule is the module boundary as a
// test rather than as a convention.
//
// It reads PRAGMA foreign_key_list for every notes_ table and insists that
// every key it finds points at another notes_ table. A key into library_items
// or core_items would compile, pass every other test, and then delete a
// person's highlights the day the library is switched off -- or refuse to store
// one because another module's row is not there.
func TestNoNotesTableHasAForeignKeyOutsideItsOwnModule(t *testing.T) {
	harness := newNotesHarness(t)

	rows, err := harness.database.Reader().Query(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notes_%' ORDER BY name`)
	if err != nil {
		t.Fatalf("listing the notes tables: %v", err)
	}
	tables := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scanning a table name: %v", err)
		}
		tables = append(tables, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("listing the notes tables: %v", err)
	}

	want := []string{
		"notes_annotations", "notes_highlights", "notes_notes",
		"notes_question_sets", "notes_questions",
	}
	if strings.Join(tables, ",") != strings.Join(want, ",") {
		t.Fatalf("the notes tables are %v, want %v", tables, want)
	}

	found := 0
	for _, table := range tables {
		keys, err := harness.database.Reader().Query(`SELECT "table" FROM pragma_foreign_key_list(?)`, table)
		if err != nil {
			t.Fatalf("reading the foreign keys of %s: %v", table, err)
		}
		for keys.Next() {
			var target string
			if err := keys.Scan(&target); err != nil {
				t.Fatalf("scanning a foreign key of %s: %v", table, err)
			}
			found++
			if !strings.HasPrefix(target, "notes_") {
				t.Fatalf("%s has a foreign key to %s, which is outside the notes module", table, target)
			}
		}
		keys.Close()
		if err := keys.Err(); err != nil {
			t.Fatalf("reading the foreign keys of %s: %v", table, err)
		}
	}
	// A pragma that reads nothing proves nothing: the notes schema does have
	// keys between its own tables, and this is what says the loop saw them.
	if found < 3 {
		t.Fatalf("the pragma found %d foreign keys in the notes tables, want at least 3", found)
	}
}

// TestTheQuestionKindCheckRefusesAKindTheContractDoesNotName keeps the closed
// set closed at the one layer that is still there when the contract is bypassed
// -- a migration, a shell, a later module writing the table directly.
func TestTheQuestionKindCheckRefusesAKindTheContractDoesNotName(t *testing.T) {
	harness := newNotesHarness(t)
	insert := `INSERT INTO notes_questions (id, kind, text, status, created_at, updated_at)
	           VALUES (?, ?, 'a question?', 'open', '2026-10-08T20:00:00Z', '2026-10-08T20:00:00Z')`

	if _, err := harness.database.Writer().Exec(insert, "q-other", "other"); err == nil {
		t.Fatal("the CHECK accepted kind 'other'")
	} else if !strings.Contains(err.Error(), "CHECK constraint failed") {
		t.Fatalf("the insert failed for the wrong reason: %v", err)
	}

	for _, kind := range NotesQuestionKinds {
		if _, err := harness.database.Writer().Exec(insert, "q-"+kind, kind); err != nil {
			t.Fatalf("the CHECK refused kind %q: %v", kind, err)
		}
	}
	if _, err := harness.database.Writer().Exec(
		`INSERT INTO notes_questions (id, kind, text, status, created_at, updated_at)
		 VALUES ('q-null', NULL, 'a question?', 'open', '2026-10-08T20:00:00Z', '2026-10-08T20:00:00Z')`); err != nil {
		t.Fatalf("the CHECK refused a question with no kind: %v", err)
	}
}

// TestDeletingAHighlightTakesItsAnnotationsAndSparesTheQuestion is the two
// different answers the schema gives to "what happens to what hung on this":
// the margin note goes with the passage, the question the person wrote does
// not.
func TestDeletingAHighlightTakesItsAnnotationsAndSparesTheQuestion(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After.")

	highlight := notesDecode[map[string]any](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)
	annotation := notesDecode[map[string]any](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "highlight_id": highlight["id"], "text": "testing this"}),
		http.StatusCreated)
	question := notesDecode[map[string]any](t, harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{"annotation_id": annotation["id"], "text": "Why does this matter?"}),
		http.StatusCreated)

	if recorder := harness.request(http.MethodDelete,
		"/api/notes/highlights/"+highlight["id"].(string), nil); recorder.Code != http.StatusNoContent {
		t.Fatalf("deleting the highlight answered %d: %s", recorder.Code, recorder.Body.String())
	}

	if count := notesCount(t, harness, `SELECT COUNT(*) FROM notes_annotations WHERE id = ?`,
		annotation["id"]); count != 0 {
		t.Fatalf("the annotation survived the highlight it hung on")
	}
	if count := notesCount(t, harness, `SELECT COUNT(*) FROM notes_questions WHERE id = ? AND annotation_id IS NULL`,
		question["id"]); count != 1 {
		t.Fatalf("the question did not survive with its reference cleared")
	}
}

func notesCount(t *testing.T, harness *notesHarness, query string, args ...any) int {
	t.Helper()
	var count int
	if err := harness.database.Reader().QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("counting with %q: %v", query, err)
	}
	return count
}
