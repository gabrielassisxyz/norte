package notes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/notes/db"
)

// NotesQuestionKinds are the six prompts a question set offers, in the order
// the screen shows them. A question written outside a set has no kind at all.
var NotesQuestionKinds = []string{"what", "why", "who", "when", "where", "how"}

// NotesSourceRef is the item a note sits on, as the registry holds it.
//
// It is read from core_items rather than from the owning module, which is what
// lets a highlight render its origin with the library switched off. Found is
// false when the registry has no such row, so the screen can say "fonte
// desconhecida" instead of printing an empty title.
type NotesSourceRef struct {
	ID     string
	Module string
	Type   string
	Title  string
	URL    string
	Found  bool
}

// NotesHighlightRecord is one highlight as the API answers with it.
type NotesHighlightRecord struct {
	Row db.NotesHighlight
	// Ambiguous is set on the answer to a creation whose passage appeared
	// several times with indistinguishable context, so the reader can say why
	// the highlight came back orphaned. It is not stored: the status is.
	Ambiguous bool
	Source    NotesSourceRef
}

// NotesAnnotationRecord is one annotation, with the passage it hangs on.
type NotesAnnotationRecord struct {
	Row    db.NotesAnnotation
	Quote  string
	Source NotesSourceRef
}

// NotesQuestionRecord is one question.
type NotesQuestionRecord struct {
	Row    db.NotesQuestion
	Source NotesSourceRef
}

// NotesQuestionSetRecord is one set and how many questions it holds.
type NotesQuestionSetRecord struct {
	Row       db.NotesQuestionSet
	Questions []NotesQuestionRecord
	Count     int
}

// NotesCounts is what the sidebar and the Notas tabs print.
type NotesCounts struct {
	Highlights  int
	Annotations int
	Questions   int
	Sets        int
}

// NotesService is the notes domain: writing and reading the four kinds of note,
// and re-anchoring a passage against an item's current text.
type NotesService struct {
	database *core.Database
	jobs     *core.Jobs
	clock    core.Clock
	texts    *core.Texts
}

// NewNotesService returns the service over the module's dependencies.
func NewNotesService(database *core.Database, jobs *core.Jobs, clock core.Clock, texts *core.Texts) *NotesService {
	return &NotesService{database: database, jobs: jobs, clock: clock, texts: texts}
}

/* ------------------------------------------------------------- highlights */

// NewHighlightInput is what a reader's selection sends: the passage and the
// words around it, never an offset. An offset measured in the browser's DOM has
// no relation to the offsets of the text the server anchors against.
type NewHighlightInput struct {
	ItemID string
	Exact  string
	Prefix string
	Suffix string
}

// CreateHighlight stores a passage and anchors it against the item's text.
//
// A unique context match is stored anchored at the offset it was found. A
// passage that is not in the text, or that appears several times with the same
// words around it, is stored orphaned with its own text intact -- the person
// marked those words and they are not thrown away because the server cannot
// place them. When the owning module is switched off there is no text to search
// and the highlight is stored anchored at no offset, because "the library is
// off tonight" is not evidence that the passage is gone.
func (s *NotesService) CreateHighlight(ctx context.Context, in NewHighlightInput) (NotesHighlightRecord, error) {
	exact := notesNormalizeText(in.Exact)
	if exact == "" {
		return NotesHighlightRecord{}, notesBadRequest("invalid_request", "a highlight needs a passage", "exact")
	}
	source, err := s.requireSource(ctx, in.ItemID)
	if err != nil {
		return NotesHighlightRecord{}, err
	}
	prefix := notesTrimContext(in.Prefix, true)
	suffix := notesTrimContext(in.Suffix, false)

	result := notesAnchorResult{Status: NotesAnchored}
	text, textErr := s.texts.Text(ctx, in.ItemID)
	switch {
	case textErr == nil:
		result = notesAnchor(text, exact, prefix, suffix, 0)
	case errors.Is(textErr, core.ErrNoText):
	default:
		return NotesHighlightRecord{}, fmt.Errorf("reading the text of %s: %w", in.ItemID, textErr)
	}

	row := db.NotesHighlight{
		ID:           core.NewID(),
		ItemID:       in.ItemID,
		Exact:        exact,
		Prefix:       prefix,
		Suffix:       suffix,
		PositionHint: int64(result.Hint),
		Status:       result.Status,
		CreatedAt:    core.FormatTime(s.clock.Now()),
	}
	if err := db.New(s.database.Writer()).InsertNotesHighlight(ctx, db.InsertNotesHighlightParams{
		ID:            row.ID,
		ItemID:        row.ItemID,
		SectionRef:    row.SectionRef,
		LocationLabel: row.LocationLabel,
		Exact:         row.Exact,
		Prefix:        row.Prefix,
		Suffix:        row.Suffix,
		PositionHint:  row.PositionHint,
		Status:        row.Status,
		CreatedAt:     row.CreatedAt,
	}); err != nil {
		return NotesHighlightRecord{}, fmt.Errorf("storing the highlight of %s: %w", in.ItemID, err)
	}
	return NotesHighlightRecord{Row: row, Ambiguous: result.Ambiguous, Source: source}, nil
}

// DeleteHighlight removes a passage, and with it the annotations hanging on it.
func (s *NotesService) DeleteHighlight(ctx context.Context, id string) error {
	deleted, err := db.New(s.database.Writer()).DeleteNotesHighlight(ctx, id)
	if err != nil {
		return fmt.Errorf("deleting the highlight %s: %w", id, err)
	}
	return notesRequireOneRow(deleted, "highlight", id)
}

/* ------------------------------------------------------------ annotations */

// NewAnnotationInput is a margin note, on a highlight or loose on the item.
type NewAnnotationInput struct {
	ItemID      string
	HighlightID string
	Text        string
}

// CreateAnnotation writes a margin note.
func (s *NotesService) CreateAnnotation(ctx context.Context, in NewAnnotationInput) (NotesAnnotationRecord, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return NotesAnnotationRecord{}, notesBadRequest("invalid_request", "an annotation needs text", "text")
	}
	source, err := s.requireSource(ctx, in.ItemID)
	if err != nil {
		return NotesAnnotationRecord{}, err
	}
	quote := ""
	queries := db.New(s.database.Writer())
	if in.HighlightID != "" {
		highlight, err := queries.GetNotesHighlightByID(ctx, in.HighlightID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return NotesAnnotationRecord{}, notesNotFound("highlight", in.HighlightID)
			}
			return NotesAnnotationRecord{}, fmt.Errorf("reading the highlight %s: %w", in.HighlightID, err)
		}
		if highlight.ItemID != in.ItemID {
			return NotesAnnotationRecord{}, notesBadRequest("invalid_request",
				"the highlight belongs to another item", "highlight_id")
		}
		quote = highlight.Exact
	}
	stamp := core.FormatTime(s.clock.Now())
	row := db.NotesAnnotation{
		ID:          core.NewID(),
		ItemID:      in.ItemID,
		HighlightID: notesNullableText(in.HighlightID),
		Text:        text,
		CreatedAt:   stamp,
		UpdatedAt:   stamp,
	}
	if err := queries.InsertNotesAnnotation(ctx, db.InsertNotesAnnotationParams{
		ID:          row.ID,
		ItemID:      row.ItemID,
		HighlightID: row.HighlightID,
		Text:        row.Text,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}); err != nil {
		return NotesAnnotationRecord{}, fmt.Errorf("storing the annotation of %s: %w", in.ItemID, err)
	}
	return NotesAnnotationRecord{Row: row, Quote: quote, Source: source}, nil
}

// UpdateAnnotation rewrites a margin note.
func (s *NotesService) UpdateAnnotation(ctx context.Context, id, text string) (NotesAnnotationRecord, error) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return NotesAnnotationRecord{}, notesBadRequest("invalid_request", "an annotation needs text", "text")
	}
	queries := db.New(s.database.Writer())
	updated, err := queries.UpdateNotesAnnotationText(ctx, db.UpdateNotesAnnotationTextParams{
		Text:      trimmed,
		UpdatedAt: core.FormatTime(s.clock.Now()),
		ID:        id,
	})
	if err != nil {
		return NotesAnnotationRecord{}, fmt.Errorf("rewriting the annotation %s: %w", id, err)
	}
	if err := notesRequireOneRow(updated, "annotation", id); err != nil {
		return NotesAnnotationRecord{}, err
	}
	return s.annotation(ctx, id)
}

// DeleteAnnotation removes a margin note. A question written from it keeps its
// own text and loses the reference, which is what the schema's SET NULL says.
func (s *NotesService) DeleteAnnotation(ctx context.Context, id string) error {
	deleted, err := db.New(s.database.Writer()).DeleteNotesAnnotation(ctx, id)
	if err != nil {
		return fmt.Errorf("deleting the annotation %s: %w", id, err)
	}
	return notesRequireOneRow(deleted, "annotation", id)
}

func (s *NotesService) annotation(ctx context.Context, id string) (NotesAnnotationRecord, error) {
	queries := db.New(s.database.Reader())
	row, err := queries.GetNotesAnnotationByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NotesAnnotationRecord{}, notesNotFound("annotation", id)
		}
		return NotesAnnotationRecord{}, fmt.Errorf("reading the annotation %s: %w", id, err)
	}
	quote := ""
	if row.HighlightID.Valid {
		highlight, err := queries.GetNotesHighlightByID(ctx, row.HighlightID.String)
		if err == nil {
			quote = highlight.Exact
		} else if !errors.Is(err, sql.ErrNoRows) {
			return NotesAnnotationRecord{}, fmt.Errorf("reading the highlight of %s: %w", id, err)
		}
	}
	source, err := s.source(ctx, row.ItemID)
	if err != nil {
		return NotesAnnotationRecord{}, err
	}
	return NotesAnnotationRecord{Row: row, Quote: quote, Source: source}, nil
}

/* ------------------------------------------------------- the item's note */

// ItemNote reads the one freeform note an item carries. An item that has never
// been annotated answers with an empty note rather than a failure: the reader's
// tab is a place to write, and a missing note is an empty one.
func (s *NotesService) ItemNote(ctx context.Context, itemID string) (db.NotesNote, bool, error) {
	row, err := db.New(s.database.Reader()).GetNotesItemNote(ctx, itemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return db.NotesNote{ItemID: itemID}, false, nil
		}
		return db.NotesNote{}, false, fmt.Errorf("reading the note of %s: %w", itemID, err)
	}
	return row, true, nil
}

// PutItemNote replaces the item's note, and deletes it when the text is empty
// so the tab leaves no blank row behind.
func (s *NotesService) PutItemNote(ctx context.Context, itemID, text string) (db.NotesNote, bool, error) {
	if _, err := s.requireSource(ctx, itemID); err != nil {
		return db.NotesNote{}, false, err
	}
	trimmed := strings.TrimSpace(text)
	queries := db.New(s.database.Writer())
	if trimmed == "" {
		if _, err := queries.DeleteNotesItemNote(ctx, itemID); err != nil {
			return db.NotesNote{}, false, fmt.Errorf("clearing the note of %s: %w", itemID, err)
		}
		return db.NotesNote{ItemID: itemID}, false, nil
	}
	stamp := core.FormatTime(s.clock.Now())
	if err := queries.UpsertNotesItemNote(ctx, db.UpsertNotesItemNoteParams{
		ID:        core.NewID(),
		ItemID:    itemID,
		Text:      trimmed,
		CreatedAt: stamp,
		UpdatedAt: stamp,
	}); err != nil {
		return db.NotesNote{}, false, fmt.Errorf("writing the note of %s: %w", itemID, err)
	}
	return s.ItemNote(ctx, itemID)
}

/* --------------------------------------------------------------- questions */

// NewQuestionInput is a question, written on its own, turned from a margin
// note, or answered into one of a set's prompts.
type NewQuestionInput struct {
	ItemID       string
	AnnotationID string
	SetID        string
	Kind         string
	Text         string
}

// CreateQuestion stores one question.
func (s *NotesService) CreateQuestion(ctx context.Context, in NewQuestionInput) (NotesQuestionRecord, error) {
	prepared, err := s.prepareQuestion(ctx, in)
	if err != nil {
		return NotesQuestionRecord{}, err
	}
	if err := db.New(s.database.Writer()).InsertNotesQuestion(ctx, prepared); err != nil {
		return NotesQuestionRecord{}, fmt.Errorf("storing the question: %w", err)
	}
	return s.question(ctx, prepared.ID)
}

// prepareQuestion validates one question and renders it as the row to insert,
// so a single question and a set's prompts cannot disagree about what a valid
// question is.
func (s *NotesService) prepareQuestion(ctx context.Context, in NewQuestionInput) (db.InsertNotesQuestionParams, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return db.InsertNotesQuestionParams{}, notesBadRequest("invalid_request", "a question needs text", "text")
	}
	if in.Kind != "" && !notesValidQuestionKind(in.Kind) {
		return db.InsertNotesQuestionParams{}, notesBadRequest("invalid_request",
			fmt.Sprintf("unknown question kind %q", in.Kind), "kind")
	}
	if in.ItemID != "" {
		if _, err := s.requireSource(ctx, in.ItemID); err != nil {
			return db.InsertNotesQuestionParams{}, err
		}
	}
	if in.AnnotationID != "" {
		if _, err := db.New(s.database.Reader()).GetNotesAnnotationByID(ctx, in.AnnotationID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return db.InsertNotesQuestionParams{}, notesNotFound("annotation", in.AnnotationID)
			}
			return db.InsertNotesQuestionParams{}, fmt.Errorf("reading the annotation %s: %w", in.AnnotationID, err)
		}
	}
	if in.SetID != "" {
		if _, err := db.New(s.database.Reader()).GetNotesQuestionSetByID(ctx, in.SetID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return db.InsertNotesQuestionParams{}, notesNotFound("question set", in.SetID)
			}
			return db.InsertNotesQuestionParams{}, fmt.Errorf("reading the question set %s: %w", in.SetID, err)
		}
	}
	stamp := core.FormatTime(s.clock.Now())
	return db.InsertNotesQuestionParams{
		ID:           core.NewID(),
		ItemID:       notesNullableText(in.ItemID),
		AnnotationID: notesNullableText(in.AnnotationID),
		SetID:        notesNullableText(in.SetID),
		Kind:         notesNullableText(in.Kind),
		Text:         text,
		Status:       "open",
		CreatedAt:    stamp,
		UpdatedAt:    stamp,
	}, nil
}

// NotesQuestionPatch is the three things a question can be changed to. A nil
// field is a field the request did not carry.
type NotesQuestionPatch struct {
	Text   *string
	Answer *string
	Status *string
}

// UpdateQuestion applies only the fields the request carried.
func (s *NotesService) UpdateQuestion(ctx context.Context, id string, patch NotesQuestionPatch) (NotesQuestionRecord, error) {
	queries := db.New(s.database.Writer())
	row, err := queries.GetNotesQuestionByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NotesQuestionRecord{}, notesNotFound("question", id)
		}
		return NotesQuestionRecord{}, fmt.Errorf("reading the question %s: %w", id, err)
	}
	text := row.Text
	if patch.Text != nil {
		text = strings.TrimSpace(*patch.Text)
		if text == "" {
			return NotesQuestionRecord{}, notesBadRequest("invalid_request", "a question needs text", "text")
		}
	}
	answer := row.Answer
	if patch.Answer != nil {
		answer = notesNullableText(strings.TrimSpace(*patch.Answer))
	}
	status := row.Status
	if patch.Status != nil {
		status = *patch.Status
		if !notesValidQuestionStatus(status) {
			return NotesQuestionRecord{}, notesBadRequest("invalid_request",
				fmt.Sprintf("unknown question status %q", status), "status")
		}
	}
	updated, err := queries.UpdateNotesQuestion(ctx, db.UpdateNotesQuestionParams{
		Text:      text,
		Answer:    answer,
		Status:    status,
		UpdatedAt: core.FormatTime(s.clock.Now()),
		ID:        id,
	})
	if err != nil {
		return NotesQuestionRecord{}, fmt.Errorf("changing the question %s: %w", id, err)
	}
	if err := notesRequireOneRow(updated, "question", id); err != nil {
		return NotesQuestionRecord{}, err
	}
	return s.question(ctx, id)
}

func (s *NotesService) question(ctx context.Context, id string) (NotesQuestionRecord, error) {
	row, err := db.New(s.database.Reader()).GetNotesQuestionByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NotesQuestionRecord{}, notesNotFound("question", id)
		}
		return NotesQuestionRecord{}, fmt.Errorf("reading the question %s: %w", id, err)
	}
	source := NotesSourceRef{}
	if row.ItemID.Valid {
		source, err = s.source(ctx, row.ItemID.String)
		if err != nil {
			return NotesQuestionRecord{}, err
		}
	}
	return NotesQuestionRecord{Row: row, Source: source}, nil
}

/* ----------------------------------------------------------- question sets */

// NewQuestionSetInput is a topic and the prompts the person actually wrote
// into. A prompt sent blank stores nothing: six empty boxes are six questions
// nobody asked.
type NewQuestionSetInput struct {
	Topic   string
	Prompts []NotesQuestionSetPrompt
}

// NotesQuestionSetPrompt is one of the six prompts, with what was written.
type NotesQuestionSetPrompt struct {
	Kind string
	Text string
}

// CreateQuestionSet opens a set on a topic and stores its questions.
//
// The set, its registry row and every question land in one transaction: a set
// with no registry entry cannot be linked to a subject, and a registry entry
// with no set renders a link to something that is not there.
func (s *NotesService) CreateQuestionSet(ctx context.Context, in NewQuestionSetInput) (NotesQuestionSetRecord, error) {
	topic := strings.TrimSpace(in.Topic)
	if topic == "" {
		return NotesQuestionSetRecord{}, notesBadRequest("invalid_request", "a question set needs a topic", "topic")
	}
	now := s.clock.Now()
	stamp := core.FormatTime(now)
	set := db.NotesQuestionSet{ID: core.NewID(), Topic: topic, CreatedAt: stamp}

	seen := map[string]bool{}
	questions := make([]db.InsertNotesQuestionParams, 0, len(in.Prompts))
	for _, prompt := range in.Prompts {
		text := strings.TrimSpace(prompt.Text)
		if text == "" {
			continue
		}
		if !notesValidQuestionKind(prompt.Kind) {
			return NotesQuestionSetRecord{}, notesBadRequest("invalid_request",
				fmt.Sprintf("unknown question kind %q", prompt.Kind), "questions")
		}
		if seen[prompt.Kind] {
			return NotesQuestionSetRecord{}, notesBadRequest("invalid_request",
				fmt.Sprintf("the prompt %q was sent twice", prompt.Kind), "questions")
		}
		seen[prompt.Kind] = true
		questions = append(questions, db.InsertNotesQuestionParams{
			ID:        core.NewID(),
			SetID:     sql.NullString{String: set.ID, Valid: true},
			Kind:      sql.NullString{String: prompt.Kind, Valid: true},
			Text:      text,
			Status:    "open",
			CreatedAt: stamp,
			UpdatedAt: stamp,
		})
	}

	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return NotesQuestionSetRecord{}, fmt.Errorf("beginning the question set transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	if err := queries.InsertNotesQuestionSet(ctx, db.InsertNotesQuestionSetParams{
		ID: set.ID, Topic: set.Topic, CreatedAt: set.CreatedAt,
	}); err != nil {
		return NotesQuestionSetRecord{}, fmt.Errorf("storing the question set: %w", err)
	}
	if err := core.RegisterItem(ctx, tx, core.ItemRegistration{
		ID:        set.ID,
		Module:    ModuleName,
		Type:      NotesQuestionSetItemType,
		Title:     topic,
		CreatedAt: now,
	}); err != nil {
		return NotesQuestionSetRecord{}, err
	}
	for _, question := range questions {
		if err := queries.InsertNotesQuestion(ctx, question); err != nil {
			return NotesQuestionSetRecord{}, fmt.Errorf("storing a question of the set: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return NotesQuestionSetRecord{}, fmt.Errorf("committing the question set: %w", err)
	}
	return s.QuestionSet(ctx, set.ID)
}

// QuestionSet reads one set with its questions, in the order they were written.
func (s *NotesService) QuestionSet(ctx context.Context, id string) (NotesQuestionSetRecord, error) {
	queries := db.New(s.database.Reader())
	set, err := queries.GetNotesQuestionSetByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NotesQuestionSetRecord{}, notesNotFound("question set", id)
		}
		return NotesQuestionSetRecord{}, fmt.Errorf("reading the question set %s: %w", id, err)
	}
	rows, err := queries.ListNotesQuestionsForSet(ctx, sql.NullString{String: id, Valid: true})
	if err != nil {
		return NotesQuestionSetRecord{}, fmt.Errorf("reading the questions of the set %s: %w", id, err)
	}
	questions := make([]NotesQuestionRecord, 0, len(rows))
	for _, row := range rows {
		record := NotesQuestionRecord{Row: row}
		if row.ItemID.Valid {
			record.Source, err = s.source(ctx, row.ItemID.String)
			if err != nil {
				return NotesQuestionSetRecord{}, err
			}
		}
		questions = append(questions, record)
	}
	return NotesQuestionSetRecord{Row: set, Questions: questions, Count: len(questions)}, nil
}

/* --------------------------------------------------------------- counts */

// Counts reads every count the sidebar and the Notas tabs print, in one call
// rather than by paging three lists nobody renders.
func (s *NotesService) Counts(ctx context.Context) (NotesCounts, error) {
	queries := db.New(s.database.Reader())
	highlights, err := queries.CountNotesHighlights(ctx)
	if err != nil {
		return NotesCounts{}, fmt.Errorf("counting the highlights: %w", err)
	}
	annotations, err := queries.CountNotesAnnotations(ctx)
	if err != nil {
		return NotesCounts{}, fmt.Errorf("counting the annotations: %w", err)
	}
	questions, err := queries.CountNotesQuestions(ctx)
	if err != nil {
		return NotesCounts{}, fmt.Errorf("counting the questions: %w", err)
	}
	sets, err := queries.CountNotesQuestionSets(ctx)
	if err != nil {
		return NotesCounts{}, fmt.Errorf("counting the question sets: %w", err)
	}
	return NotesCounts{
		Highlights:  int(highlights),
		Annotations: int(annotations),
		Questions:   int(questions),
		Sets:        int(sets),
	}, nil
}

/* --------------------------------------------------------------- helpers */

// requireSource refuses a note on an id the registry does not know, so a typo
// is a 404 rather than a row whose origin can never be rendered.
func (s *NotesService) requireSource(ctx context.Context, itemID string) (NotesSourceRef, error) {
	if strings.TrimSpace(itemID) == "" {
		return NotesSourceRef{}, notesBadRequest("invalid_request", "a note needs an item", "item_id")
	}
	source, err := s.source(ctx, itemID)
	if err != nil {
		return NotesSourceRef{}, err
	}
	if !source.Found {
		return NotesSourceRef{}, notesNotFound("item", itemID)
	}
	return source, nil
}

// source reads one registry row, answering Found false when there is none.
func (s *NotesService) source(ctx context.Context, itemID string) (NotesSourceRef, error) {
	row := s.database.Reader().QueryRowContext(ctx,
		`SELECT module, type, title, COALESCE(url, '') FROM core_items WHERE id = ?`, itemID)
	source := NotesSourceRef{ID: itemID}
	if err := row.Scan(&source.Module, &source.Type, &source.Title, &source.URL); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NotesSourceRef{ID: itemID}, nil
		}
		return NotesSourceRef{}, fmt.Errorf("reading the registry row of %s: %w", itemID, err)
	}
	source.Found = true
	return source, nil
}

func notesValidQuestionKind(kind string) bool {
	for _, known := range NotesQuestionKinds {
		if kind == known {
			return true
		}
	}
	return false
}

func notesValidQuestionStatus(status string) bool {
	return status == "open" || status == "answered" || status == "dropped"
}

// notesNullableText stores an absent string as NULL, so "this question belongs
// to no set" is one value in the column rather than two.
func notesNullableText(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}

// notesRequireOneRow turns "the statement ran and matched nothing" into the 404
// the handler answers with.
func notesRequireOneRow(result sql.Result, what, id string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("reading the number of affected rows for %s %s: %w", what, id, err)
	}
	if affected == 0 {
		return notesNotFound(what, id)
	}
	return nil
}
