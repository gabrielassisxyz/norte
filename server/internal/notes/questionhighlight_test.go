package notes

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/notes/migrations"
)

// The two versions this change sits between: every installation that already
// holds notes is at notesSchemaVersion, and notesQuestionHighlightVersion is
// the migration that gives a question the passage it was asked about.
const (
	notesSchemaVersion            = 1
	notesQuestionHighlightVersion = 2
)

// notesMigrationHarness is a database with the core migrated in full and the
// notes module stopped at version 1, so a test can write the rows the new
// column arrives over and then step forwards and backwards across it.
type notesMigrationHarness struct {
	t        *testing.T
	database *core.Database
	provider *goose.Provider
}

func newNotesMigrationHarness(t *testing.T) *notesMigrationHarness {
	t.Helper()
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, database.Writer(), migrations.FS,
		goose.WithTableName("goose_"+ModuleName),
		goose.WithDisableGlobalRegistry(true),
	)
	if err != nil {
		t.Fatalf("preparing the notes migrations: %v", err)
	}
	harness := &notesMigrationHarness{t: t, database: database, provider: provider}
	harness.upTo(notesSchemaVersion)
	return harness
}

func (h *notesMigrationHarness) upTo(version int64) {
	h.t.Helper()
	if _, err := h.provider.UpTo(context.Background(), version); err != nil {
		h.t.Fatalf("migrating notes up to %d: %v", version, err)
	}
}

func (h *notesMigrationHarness) down() {
	h.t.Helper()
	if _, err := h.provider.Down(context.Background()); err != nil {
		h.t.Fatalf("rolling notes back: %v", err)
	}
}

func (h *notesMigrationHarness) version() int64 {
	h.t.Helper()
	version, err := h.provider.GetDBVersion(context.Background())
	if err != nil {
		h.t.Fatalf("reading the notes schema version: %v", err)
	}
	return version
}

func (h *notesMigrationHarness) exec(statement string, args ...any) {
	h.t.Helper()
	if _, err := h.database.Writer().ExecContext(context.Background(), statement, args...); err != nil {
		h.t.Fatalf("running %q: %v", statement, err)
	}
}

func (h *notesMigrationHarness) queryInt(statement string, args ...any) int {
	h.t.Helper()
	var value int
	if err := h.database.Reader().QueryRowContext(context.Background(), statement, args...).Scan(&value); err != nil {
		h.t.Fatalf("reading %q: %v", statement, err)
	}
	return value
}

// notesQuestionColumns answers the columns notes_questions currently has, which
// is how "the column arrived" and "Down took it away again" are asserted
// without reading the migration file back.
func (h *notesMigrationHarness) notesQuestionColumns() map[string]bool {
	h.t.Helper()
	rows, err := h.database.Reader().QueryContext(context.Background(),
		`SELECT name FROM pragma_table_info('notes_questions')`)
	if err != nil {
		h.t.Fatalf("reading the columns of notes_questions: %v", err)
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			h.t.Fatalf("scanning a column name: %v", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		h.t.Fatalf("reading the columns of notes_questions: %v", err)
	}
	return columns
}

// TestTheQuestionHighlightMigrationLeavesEveryStoredQuestionUnanchored is the
// upgrade an installation actually performs: questions already written get the
// new column empty rather than guessed at, and the rollback leaves the rows and
// the schema as they were.
func TestTheQuestionHighlightMigrationLeavesEveryStoredQuestionUnanchored(t *testing.T) {
	harness := newNotesMigrationHarness(t)
	harness.exec(
		`INSERT INTO notes_questions (id, text, status, created_at, updated_at)
		 VALUES ('q-before', 'Asked before the column existed?', 'open',
		         '2026-10-08T20:00:00Z', '2026-10-08T20:00:00Z')`)
	if columns := harness.notesQuestionColumns(); columns["highlight_id"] {
		t.Fatal("notes_questions already had highlight_id at version 1")
	}

	harness.upTo(notesQuestionHighlightVersion)
	if version := harness.version(); version != notesQuestionHighlightVersion {
		t.Fatalf("the notes schema is at version %d, want %d", version, notesQuestionHighlightVersion)
	}
	if columns := harness.notesQuestionColumns(); !columns["highlight_id"] {
		t.Fatal("the migration did not add highlight_id to notes_questions")
	}
	if count := harness.queryInt(
		`SELECT COUNT(*) FROM notes_questions WHERE id = 'q-before' AND highlight_id IS NULL`); count != 1 {
		t.Fatal("the question stored before the migration did not come through it with an empty highlight_id")
	}

	harness.down()
	if version := harness.version(); version != notesSchemaVersion {
		t.Fatalf("after Down the notes schema is at version %d, want %d", version, notesSchemaVersion)
	}
	if columns := harness.notesQuestionColumns(); columns["highlight_id"] {
		t.Fatal("Down left highlight_id on notes_questions")
	}
	if count := harness.queryInt(`SELECT COUNT(*) FROM notes_questions WHERE id = 'q-before'`); count != 1 {
		t.Fatal("Down took the question with it")
	}
}

// TestAQuestionPointsAtThePassageItWasAskedAbout is the toolbar's "?" as the
// server sees it: the passage is all the client sends, and the question comes
// back carrying it and the item the passage belongs to.
func TestAQuestionPointsAtThePassageItWasAskedAbout(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After.")
	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)

	created := notesDecode[notesQuestionBody](t, harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{"highlight_id": highlight.ID, "text": "Why is this the passage?"}),
		http.StatusCreated)
	if created.HighlightID != highlight.ID {
		t.Fatalf("the question came back with highlight_id %q, want %q", created.HighlightID, highlight.ID)
	}
	if created.ItemID != itemID {
		t.Fatalf("the question came back on item %q, want the highlight's item %q", created.ItemID, itemID)
	}

	listed := notesDecode[notesQuestionListBody](t,
		harness.request(http.MethodGet, "/api/notes/questions?item_id="+itemID, nil), http.StatusOK)
	if len(listed.Items) != 1 || listed.Items[0].HighlightID != highlight.ID {
		t.Fatalf("the list did not answer with the question's passage: %+v", listed.Items)
	}
}

// TestAQuestionCannotPointAtAPassageOfAnotherItem keeps the quote beside the
// question honest: a passage of a different text is not the passage this
// question was asked about.
func TestAQuestionCannotPointAtAPassageOfAnotherItem(t *testing.T) {
	harness := newNotesHarness(t)
	first := harness.saveArticle("First", "Before. The marked passage. After.")
	second := harness.saveArticle("Second", "Another whole text.")
	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": first, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)

	field := notesRefusal(t, harness.request(http.MethodPost, "/api/notes/questions", map[string]any{
		"item_id":      second,
		"highlight_id": highlight.ID,
		"text":         "Does this belong to another text?",
	}), http.StatusBadRequest)
	if field != "highlight_id" {
		t.Fatalf("the refusal named %q, want highlight_id", field)
	}
	if count := notesCount(t, harness, `SELECT COUNT(*) FROM notes_questions`); count != 0 {
		t.Fatal("the refused question was stored")
	}
}

// TestAQuestionOnAPassageThatIsNotThereIsNotFound separates a typo from a
// mismatch: an id nothing holds is a 404, not a 400 about the body.
func TestAQuestionOnAPassageThatIsNotThereIsNotFound(t *testing.T) {
	harness := newNotesHarness(t)
	recorder := harness.request(http.MethodPost, "/api/notes/questions", map[string]any{
		"highlight_id": core.NewID(),
		"text":         "Asked about nothing?",
	})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", recorder.Code, recorder.Body.String())
	}
}

// TestDeletingAPassageSparesTheQuestionAskedAboutIt is the SET NULL as the
// person experiences it: dropping a highlight is not a reason to lose the
// question written about it.
func TestDeletingAPassageSparesTheQuestionAskedAboutIt(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After.")
	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)
	question := notesDecode[notesQuestionBody](t, harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{"highlight_id": highlight.ID, "text": "Why is this the passage?"}),
		http.StatusCreated)

	if recorder := harness.request(http.MethodDelete,
		"/api/notes/highlights/"+highlight.ID, nil); recorder.Code != http.StatusNoContent {
		t.Fatalf("deleting the highlight answered %d: %s", recorder.Code, recorder.Body.String())
	}

	if count := notesCount(t, harness,
		`SELECT COUNT(*) FROM notes_questions WHERE id = ? AND highlight_id IS NULL`,
		question.ID); count != 1 {
		t.Fatal("the question did not survive the passage with its link cleared")
	}
	listed := notesDecode[notesQuestionListBody](t,
		harness.request(http.MethodGet, "/api/notes/questions?item_id="+itemID, nil), http.StatusOK)
	if len(listed.Items) != 1 || listed.Items[0].HighlightID != "" {
		t.Fatalf("the list did not answer with the orphaned question: %+v", listed.Items)
	}
}

// TestANoteWrittenWithoutAPassageIsAttachedToOneSelectedLater is the other half
// of the toolbar: the note is typed in the margin first and anchored to a
// passage afterwards.
func TestANoteWrittenWithoutAPassageIsAttachedToOneSelectedLater(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After.")
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "text": "a note with no passage"}), http.StatusCreated)
	if annotation.HighlightID != "" {
		t.Fatalf("the note was created already anchored to %q", annotation.HighlightID)
	}
	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)

	patched := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPatch,
		"/api/notes/annotations/"+annotation.ID,
		map[string]any{"highlight_id": highlight.ID}), http.StatusOK)
	if patched.HighlightID != highlight.ID {
		t.Fatalf("the note came back with highlight_id %q, want %q", patched.HighlightID, highlight.ID)
	}
	if patched.Text != "a note with no passage" {
		t.Fatalf("attaching the passage rewrote the text to %q", patched.Text)
	}
	// The quote is what the margin renders, so the attach is only complete
	// once the passage comes back with the note.
	if patched.Quote != "The marked passage." {
		t.Fatalf("the note came back quoting %q", patched.Quote)
	}
}

// TestANoteThatAlreadyHangsOnAPassageIsNotMoved refuses the one case the
// column would otherwise allow silently: replacing the passage a note was
// written about.
func TestANoteThatAlreadyHangsOnAPassageIsNotMoved(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After. The other passage. End.")
	first := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)
	second := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The other passage.", "prefix": "After. ", "suffix": " End."}),
		http.StatusCreated)
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "highlight_id": first.ID, "text": "a note on the first passage"}),
		http.StatusCreated)

	field := notesRefusal(t, harness.request(http.MethodPatch, "/api/notes/annotations/"+annotation.ID,
		map[string]any{"highlight_id": second.ID}), http.StatusConflict)
	if field != "highlight_id" {
		t.Fatalf("the refusal named %q, want highlight_id", field)
	}
	if count := notesCount(t, harness,
		`SELECT COUNT(*) FROM notes_annotations WHERE id = ? AND highlight_id = ?`,
		annotation.ID, first.ID); count != 1 {
		t.Fatal("the refused patch moved the note to the other passage")
	}
}

// TestANoteCannotBeAttachedToAPassageOfAnotherItem is the same rule creation
// already enforces, on the path that attaches a passage afterwards.
func TestANoteCannotBeAttachedToAPassageOfAnotherItem(t *testing.T) {
	harness := newNotesHarness(t)
	first := harness.saveArticle("First", "Before. The marked passage. After.")
	second := harness.saveArticle("Second", "Elsewhere. Another passage. End.")
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": first, "text": "a note with no passage"}), http.StatusCreated)
	elsewhere := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": second, "exact": "Another passage.", "prefix": "Elsewhere. ", "suffix": " End."}),
		http.StatusCreated)

	field := notesRefusal(t, harness.request(http.MethodPatch, "/api/notes/annotations/"+annotation.ID,
		map[string]any{"highlight_id": elsewhere.ID}), http.StatusBadRequest)
	if field != "highlight_id" {
		t.Fatalf("the refusal named %q, want highlight_id", field)
	}
	if count := notesCount(t, harness,
		`SELECT COUNT(*) FROM notes_annotations WHERE id = ? AND highlight_id IS NULL`,
		annotation.ID); count != 1 {
		t.Fatal("the refused patch attached the passage of another item")
	}
}

// TestPatchingOnlyTheTextOfANoteStillRewritesIt is the behaviour that was there
// before the new field and has to stay: text alone rewrites the note and leaves
// the passage it hangs on alone.
func TestPatchingOnlyTheTextOfANoteStillRewritesIt(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After.")
	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "The marked passage.", "prefix": "Before. ", "suffix": " After."}),
		http.StatusCreated)
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "highlight_id": highlight.ID, "text": "the first wording"}),
		http.StatusCreated)

	patched := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPatch,
		"/api/notes/annotations/"+annotation.ID,
		map[string]any{"text": "the second wording"}), http.StatusOK)
	if patched.Text != "the second wording" {
		t.Fatalf("the note came back reading %q", patched.Text)
	}
	if patched.HighlightID != highlight.ID {
		t.Fatalf("rewriting the text changed the passage to %q", patched.HighlightID)
	}

	// The two refusals that were there before: a blank text, and a note that
	// is not there at all.
	if field := notesRefusal(t, harness.request(http.MethodPatch,
		"/api/notes/annotations/"+annotation.ID,
		map[string]any{"text": "   "}), http.StatusBadRequest); field != "text" {
		t.Fatalf("a blank text was refused naming %q, want text", field)
	}
	if recorder := harness.request(http.MethodPatch, "/api/notes/annotations/"+core.NewID(),
		map[string]any{"text": "nowhere"}); recorder.Code != http.StatusNotFound {
		t.Fatalf("patching a note that is not there answered %d: %s", recorder.Code, recorder.Body.String())
	}
}

// TestAnAnnotationPatchCarryingNothingIsRefused keeps a request that asks for
// nothing from answering 200 over an untouched row, which is what makes both
// fields optional safe.
func TestAnAnnotationPatchCarryingNothingIsRefused(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("An article", "Before. The marked passage. After.")
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "text": "a note"}), http.StatusCreated)

	recorder := harness.request(http.MethodPatch, "/api/notes/annotations/"+annotation.ID, map[string]any{})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", recorder.Code, recorder.Body.String())
	}
	if body := recorder.Body.String(); !strings.Contains(body, "invalid_request") {
		t.Fatalf("the empty patch was refused with %s", body)
	}
}
