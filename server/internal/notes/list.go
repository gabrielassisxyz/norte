package notes

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
	"modernc.org/sqlite"

	"github.com/gabrielassisxyz/norte/server/internal/notes/db"
)

const (
	notesDefaultListLimit = 50
	notesMaxListLimit     = 200
)

// NotesListInput is what every notes list filters by. Not every list reads
// every field -- a question set has no item -- and the filter hash is built
// from the ones its own list used, so a cursor cannot cross from one list to
// another or from one filter to another.
type NotesListInput struct {
	ItemID string
	SetID  string
	Status string
	Query  string
	Cursor string
	Limit  int
}

// notesCursor is the opaque page token: the position in the total order and a
// hash of the filters that produced it.
//
// The filters are hashed in rather than re-sent, because a cursor handed back
// with other filters continues a different query: the rows after this position
// in *that* order are not the rows the caller is paging. It is refused instead.
type notesCursor struct {
	V          int    `json:"v"`
	List       string `json:"l"`
	FilterHash string `json:"fh"`
	CreatedAt  string `json:"c"`
	ID         string `json:"id"`
}

const notesCursorVersion = 1

func notesEncodeCursor(cursor notesCursor) string {
	cursor.V = notesCursorVersion
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func notesDecodeCursor(raw string) (notesCursor, error) {
	var cursor notesCursor
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return notesCursor{}, err
	}
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return notesCursor{}, err
	}
	if cursor.V != notesCursorVersion || cursor.ID == "" {
		return notesCursor{}, fmt.Errorf("unknown cursor version")
	}
	return cursor, nil
}

func notesFilterHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return fmt.Sprintf("%x", sum)
}

// notesPageQuery is one list's WHERE clause, its arguments and the page token
// the caller presented, already checked against this list and these filters.
type notesPageQuery struct {
	where  []string
	args   []any
	limit  int
	cursor notesCursor
	hash   string
	list   string
}

// notesPreparePage validates the paging inputs and renders the shared part of
// every list: the limit, the filter hash the cursor is bound to, and the
// "strictly after this position" predicate that continues a page.
func notesPreparePage(list string, in NotesListInput, hashParts []string, table string) (notesPageQuery, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = notesDefaultListLimit
	}
	if limit > notesMaxListLimit {
		return notesPageQuery{}, notesBadRequest("invalid_request",
			fmt.Sprintf("the page holds at most %d rows", notesMaxListLimit), "limit")
	}
	page := notesPageQuery{limit: limit, hash: notesFilterHash(hashParts...), list: list}
	if in.Cursor == "" {
		return page, nil
	}
	decoded, err := notesDecodeCursor(in.Cursor)
	if err != nil {
		return notesPageQuery{}, notesBadRequest("invalid_cursor", "the cursor does not decode", "cursor")
	}
	if decoded.List != list || decoded.FilterHash != page.hash {
		return notesPageQuery{}, notesBadRequest("invalid_cursor",
			"the cursor belongs to another list or filter", "cursor")
	}
	page.cursor = decoded
	// Newest first with the id breaking ties, so "after this row" is a row
	// strictly lower in that one total order and no page boundary can repeat
	// or skip a row.
	page.where = append(page.where,
		fmt.Sprintf("(%s.created_at < ? OR (%s.created_at = ? AND %s.id < ?))", table, table, table))
	page.args = append(page.args, decoded.CreatedAt, decoded.CreatedAt, decoded.ID)
	return page, nil
}

// notesFoldFunction is the SQL name of the folding the q filter compares
// through. It is prefixed with the module's name because the registration is
// global to the driver: every connection the process opens sees it, including
// the ones another module's statements run on.
const notesFoldFunction = "notes_fold"

// init registers the folding as a SQLite function, so a list can fold the
// column it filters on without a second, stored copy of every text.
//
// The driver makes a registered function available to the connections opened
// after the call, and package initialisation runs before anything opens a
// database, so every connection this process makes has it. It is declared
// deterministic because it is: the same text folds to the same text, which is
// what lets SQLite use it in a WHERE clause without re-evaluating per row.
func init() {
	sqlite.MustRegisterDeterministicScalarFunction(notesFoldFunction, 1,
		func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			text, ok := args[0].(string)
			if !ok {
				// A NULL, a number or a blob folds to itself: the caller
				// decides what a non-text column means, and the lists already
				// COALESCE the nullable ones to an empty string.
				return args[0], nil
			}
			return notesFoldText(text), nil
		})
}

// notesFoldText is the comparable form of a text for the q filter: lowercase
// and with the accents stripped, so MEMÓRIA, memoria and Memória are one word.
//
// It is the core's slug rule without the part that drops punctuation and
// collapses separators, because this filter matches a fragment of a sentence
// rather than a name: a space, a comma and a hyphen the person typed have to
// survive the folding or the fragment stops matching the sentence it came from.
func notesFoldText(value string) string {
	lowered := strings.ToLower(value)
	// NFD splits an accented rune into its letter and its combining mark, so
	// dropping the marks leaves the letter behind rather than the whole rune.
	folded, _, err := transform.String(
		transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), lowered)
	if err != nil {
		return lowered
	}
	return folded
}

// notesTextFilter narrows a list to the rows whose own text, or whose source
// item's title, contains the filter.
//
// It is LIKE rather than a full-text query because this is the screen's
// narrowing box: the person types a fragment of a sentence they remember, and a
// word-boundary search would answer nothing for half of what they type.
//
// Both sides are folded, because SQLite's LIKE folds the case of ASCII letters
// and nothing else: the contract promises a case-insensitive match, and a
// person typing MEMÓRIA is asking the same question as one typing memória. The
// folding is a registered function rather than a stored column, so no text is
// kept twice and no migration rewrites rows that are already there.
func notesTextFilter(query string, columns ...string) (string, []any) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return "", nil
	}
	// Folded before it is escaped: folding introduces no wildcard, and
	// escaping first would leave the backslashes to be folded.
	pattern := "%" + notesEscapeLike(notesFoldText(trimmed)) + "%"
	clauses := make([]string, 0, len(columns))
	args := make([]any, 0, len(columns))
	for _, column := range columns {
		clauses = append(clauses, notesFoldFunction+"("+column+") LIKE ? ESCAPE '\\'")
		args = append(args, pattern)
	}
	return "(" + strings.Join(clauses, " OR ") + ")", args
}

// notesEscapeLike neutralises the two wildcards and the escape character, so a
// filter containing "%" matches a literal per cent rather than everything.
func notesEscapeLike(value string) string {
	replaced := strings.ReplaceAll(value, `\`, `\\`)
	replaced = strings.ReplaceAll(replaced, "%", `\%`)
	return strings.ReplaceAll(replaced, "_", `\_`)
}

// notesRenderQuery assembles the statement one list runs.
func notesRenderQuery(selectClause, from string, page notesPageQuery, order string) (string, []any) {
	query := "SELECT " + selectClause + " FROM " + from
	if len(page.where) > 0 {
		query += " WHERE " + strings.Join(page.where, " AND ")
	}
	query += " ORDER BY " + order + fmt.Sprintf(" LIMIT %d", page.limit+1)
	return query, page.args
}

/* ------------------------------------------------------------- highlights */

// NotesHighlightPage is one page of highlights and the token for the next.
type NotesHighlightPage struct {
	Items      []NotesHighlightRecord
	NextCursor string
}

// ListHighlights reads one page of highlights, newest first.
//
// The source item's title is read in the same statement, from core_items rather
// than from the owning module: that is what makes a highlight render its origin
// with the library switched off, and it is why Notas needs no library call.
func (s *NotesService) ListHighlights(ctx context.Context, in NotesListInput) (NotesHighlightPage, error) {
	page, err := notesPreparePage("highlights", in, []string{in.ItemID, in.Query}, "notes_highlights")
	if err != nil {
		return NotesHighlightPage{}, err
	}
	if in.ItemID != "" {
		page.where = append(page.where, "notes_highlights.item_id = ?")
		page.args = append(page.args, in.ItemID)
	}
	if clause, args := notesTextFilter(in.Query,
		"notes_highlights.exact", "COALESCE(core_items.title, '')"); clause != "" {
		page.where = append(page.where, clause)
		page.args = append(page.args, args...)
	}
	query, args := notesRenderQuery(
		`notes_highlights.id, notes_highlights.item_id, notes_highlights.section_ref,
		 notes_highlights.location_label, notes_highlights.exact, notes_highlights.prefix,
		 notes_highlights.suffix, notes_highlights.position_hint, notes_highlights.status,
		 notes_highlights.created_at, core_items.module, core_items.type, core_items.title, core_items.url`,
		"notes_highlights LEFT JOIN core_items ON core_items.id = notes_highlights.item_id",
		page, "notes_highlights.created_at DESC, notes_highlights.id DESC")

	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return NotesHighlightPage{}, fmt.Errorf("listing the highlights: %w", err)
	}
	defer rows.Close()
	items := []NotesHighlightRecord{}
	for rows.Next() {
		var row db.NotesHighlight
		var module, itemType, title, url sql.NullString
		if err := rows.Scan(&row.ID, &row.ItemID, &row.SectionRef, &row.LocationLabel,
			&row.Exact, &row.Prefix, &row.Suffix, &row.PositionHint, &row.Status,
			&row.CreatedAt, &module, &itemType, &title, &url); err != nil {
			return NotesHighlightPage{}, fmt.Errorf("scanning a highlight: %w", err)
		}
		items = append(items, NotesHighlightRecord{
			Row:    row,
			Source: notesSourceFrom(row.ItemID, module, itemType, title, url),
		})
	}
	if err := rows.Err(); err != nil {
		return NotesHighlightPage{}, fmt.Errorf("listing the highlights: %w", err)
	}
	result := NotesHighlightPage{}
	if len(items) > page.limit {
		last := items[page.limit-1].Row
		result.NextCursor = notesEncodeCursor(notesCursor{
			List: page.list, FilterHash: page.hash, CreatedAt: last.CreatedAt, ID: last.ID,
		})
		items = items[:page.limit]
	}
	result.Items = items
	return result, nil
}

/* ------------------------------------------------------------ annotations */

// NotesAnnotationPage is one page of annotations and the token for the next.
type NotesAnnotationPage struct {
	Items      []NotesAnnotationRecord
	NextCursor string
}

// ListAnnotations reads one page of margin notes, newest first, each with the
// passage it hangs on when it hangs on one.
func (s *NotesService) ListAnnotations(ctx context.Context, in NotesListInput) (NotesAnnotationPage, error) {
	page, err := notesPreparePage("annotations", in, []string{in.ItemID, in.Query}, "notes_annotations")
	if err != nil {
		return NotesAnnotationPage{}, err
	}
	if in.ItemID != "" {
		page.where = append(page.where, "notes_annotations.item_id = ?")
		page.args = append(page.args, in.ItemID)
	}
	if clause, args := notesTextFilter(in.Query,
		"notes_annotations.text", "COALESCE(core_items.title, '')"); clause != "" {
		page.where = append(page.where, clause)
		page.args = append(page.args, args...)
	}
	query, args := notesRenderQuery(
		`notes_annotations.id, notes_annotations.item_id, notes_annotations.highlight_id,
		 notes_annotations.text, notes_annotations.created_at, notes_annotations.updated_at,
		 COALESCE(notes_highlights.exact, ''),
		 core_items.module, core_items.type, core_items.title, core_items.url`,
		`notes_annotations
		 LEFT JOIN notes_highlights ON notes_highlights.id = notes_annotations.highlight_id
		 LEFT JOIN core_items ON core_items.id = notes_annotations.item_id`,
		page, "notes_annotations.created_at DESC, notes_annotations.id DESC")

	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return NotesAnnotationPage{}, fmt.Errorf("listing the annotations: %w", err)
	}
	defer rows.Close()
	items := []NotesAnnotationRecord{}
	for rows.Next() {
		var row db.NotesAnnotation
		var quote string
		var module, itemType, title, url sql.NullString
		if err := rows.Scan(&row.ID, &row.ItemID, &row.HighlightID, &row.Text,
			&row.CreatedAt, &row.UpdatedAt, &quote,
			&module, &itemType, &title, &url); err != nil {
			return NotesAnnotationPage{}, fmt.Errorf("scanning an annotation: %w", err)
		}
		items = append(items, NotesAnnotationRecord{
			Row:    row,
			Quote:  quote,
			Source: notesSourceFrom(row.ItemID, module, itemType, title, url),
		})
	}
	if err := rows.Err(); err != nil {
		return NotesAnnotationPage{}, fmt.Errorf("listing the annotations: %w", err)
	}
	result := NotesAnnotationPage{}
	if len(items) > page.limit {
		last := items[page.limit-1].Row
		result.NextCursor = notesEncodeCursor(notesCursor{
			List: page.list, FilterHash: page.hash, CreatedAt: last.CreatedAt, ID: last.ID,
		})
		items = items[:page.limit]
	}
	result.Items = items
	return result, nil
}

/* -------------------------------------------------------------- questions */

// NotesQuestionPage is one page of questions and the token for the next.
type NotesQuestionPage struct {
	Items      []NotesQuestionRecord
	NextCursor string
}

// ListQuestions reads one page of questions, newest first.
func (s *NotesService) ListQuestions(ctx context.Context, in NotesListInput) (NotesQuestionPage, error) {
	if in.Status != "" && !notesValidQuestionStatus(in.Status) {
		return NotesQuestionPage{}, notesBadRequest("invalid_request",
			fmt.Sprintf("unknown question status %q", in.Status), "status")
	}
	page, err := notesPreparePage("questions", in,
		[]string{in.ItemID, in.SetID, in.Status, in.Query}, "notes_questions")
	if err != nil {
		return NotesQuestionPage{}, err
	}
	if in.ItemID != "" {
		page.where = append(page.where, "notes_questions.item_id = ?")
		page.args = append(page.args, in.ItemID)
	}
	if in.SetID != "" {
		page.where = append(page.where, "notes_questions.set_id = ?")
		page.args = append(page.args, in.SetID)
	}
	if in.Status != "" {
		page.where = append(page.where, "notes_questions.status = ?")
		page.args = append(page.args, in.Status)
	}
	if clause, args := notesTextFilter(in.Query, "notes_questions.text",
		"COALESCE(notes_questions.answer, '')", "COALESCE(core_items.title, '')"); clause != "" {
		page.where = append(page.where, clause)
		page.args = append(page.args, args...)
	}
	query, args := notesRenderQuery(
		`notes_questions.id, notes_questions.item_id, notes_questions.annotation_id,
		 notes_questions.set_id, notes_questions.kind, notes_questions.text,
		 notes_questions.answer, notes_questions.status, notes_questions.created_at,
		 notes_questions.updated_at, core_items.module, core_items.type,
		 core_items.title, core_items.url`,
		"notes_questions LEFT JOIN core_items ON core_items.id = notes_questions.item_id",
		page, "notes_questions.created_at DESC, notes_questions.id DESC")

	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return NotesQuestionPage{}, fmt.Errorf("listing the questions: %w", err)
	}
	defer rows.Close()
	items := []NotesQuestionRecord{}
	for rows.Next() {
		var row db.NotesQuestion
		var module, itemType, title, url sql.NullString
		if err := rows.Scan(&row.ID, &row.ItemID, &row.AnnotationID, &row.SetID, &row.Kind,
			&row.Text, &row.Answer, &row.Status, &row.CreatedAt, &row.UpdatedAt,
			&module, &itemType, &title, &url); err != nil {
			return NotesQuestionPage{}, fmt.Errorf("scanning a question: %w", err)
		}
		source := NotesSourceRef{}
		if row.ItemID.Valid {
			source = notesSourceFrom(row.ItemID.String, module, itemType, title, url)
		}
		items = append(items, NotesQuestionRecord{Row: row, Source: source})
	}
	if err := rows.Err(); err != nil {
		return NotesQuestionPage{}, fmt.Errorf("listing the questions: %w", err)
	}
	result := NotesQuestionPage{}
	if len(items) > page.limit {
		last := items[page.limit-1].Row
		result.NextCursor = notesEncodeCursor(notesCursor{
			List: page.list, FilterHash: page.hash, CreatedAt: last.CreatedAt, ID: last.ID,
		})
		items = items[:page.limit]
	}
	result.Items = items
	return result, nil
}

/* ---------------------------------------------------------- question sets */

// NotesQuestionSetPage is one page of sets and the token for the next.
type NotesQuestionSetPage struct {
	Items      []NotesQuestionSetRecord
	NextCursor string
}

// ListQuestionSets reads one page of sets, newest first, each with the number
// of questions under it rather than the questions themselves: the list is a
// list of topics, and the set's own screen is where its questions are read.
func (s *NotesService) ListQuestionSets(ctx context.Context, in NotesListInput) (NotesQuestionSetPage, error) {
	page, err := notesPreparePage("question_sets", in, []string{in.Query}, "notes_question_sets")
	if err != nil {
		return NotesQuestionSetPage{}, err
	}
	if clause, args := notesTextFilter(in.Query, "notes_question_sets.topic"); clause != "" {
		page.where = append(page.where, clause)
		page.args = append(page.args, args...)
	}
	query, args := notesRenderQuery(
		`notes_question_sets.id, notes_question_sets.topic, notes_question_sets.created_at,
		 (SELECT COUNT(*) FROM notes_questions WHERE notes_questions.set_id = notes_question_sets.id)`,
		"notes_question_sets", page,
		"notes_question_sets.created_at DESC, notes_question_sets.id DESC")

	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return NotesQuestionSetPage{}, fmt.Errorf("listing the question sets: %w", err)
	}
	defer rows.Close()
	items := []NotesQuestionSetRecord{}
	for rows.Next() {
		var row db.NotesQuestionSet
		var count int
		if err := rows.Scan(&row.ID, &row.Topic, &row.CreatedAt, &count); err != nil {
			return NotesQuestionSetPage{}, fmt.Errorf("scanning a question set: %w", err)
		}
		items = append(items, NotesQuestionSetRecord{Row: row, Count: count})
	}
	if err := rows.Err(); err != nil {
		return NotesQuestionSetPage{}, fmt.Errorf("listing the question sets: %w", err)
	}
	result := NotesQuestionSetPage{}
	if len(items) > page.limit {
		last := items[page.limit-1].Row
		result.NextCursor = notesEncodeCursor(notesCursor{
			List: page.list, FilterHash: page.hash, CreatedAt: last.CreatedAt, ID: last.ID,
		})
		items = items[:page.limit]
	}
	result.Items = items
	return result, nil
}

// notesSourceFrom renders the registry columns a list joined in. A row with no
// registry match comes back Found false, which is what the screen reads to say
// the source is unknown rather than printing an empty title.
func notesSourceFrom(itemID string, module, itemType, title, url sql.NullString) NotesSourceRef {
	if !title.Valid {
		return NotesSourceRef{ID: itemID}
	}
	return NotesSourceRef{
		ID:     itemID,
		Module: module.String,
		Type:   itemType.String,
		Title:  title.String,
		URL:    url.String,
		Found:  true,
	}
}
