package core

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// SubjectItemModule and SubjectItemType are how a subject appears in the item
// registry. The module is the core itself: a subject is the one linkable thing
// no feature module owns, and switching every module off must not make the
// vocabulary unrenderable.
const (
	SubjectItemModule = "core"
	SubjectItemType   = "subject"

	subjectDefaultListLimit = 50
	subjectMaxListLimit     = 200
)

// SubjectTypeCount is how many items of one module's one type are linked to a
// subject by a confirmed `about` link.
type SubjectTypeCount struct {
	Module string
	Type   string
	Count  int
}

// SubjectRecord is a subject as every endpoint answers with it: the row, what
// is linked to it, and how many links would go with it if it were deleted.
type SubjectRecord struct {
	Row       db.CoreSubject
	ByType    []SubjectTypeCount
	Total     int
	LinkCount int
}

// SubjectPage is one page of subjects, with the cursor for the next one or ""
// when this page is the last.
type SubjectPage struct {
	Items      []SubjectRecord
	NextCursor string
}

// SubjectListInput is what GET /api/core/subjects filters by.
type SubjectListInput struct {
	Query  string
	Cursor string
	Limit  int
}

// Subjects is the only writer of core_subjects, so the slug rule and the
// registry row that renders a link to a subject are decided in one place
// rather than at each call site.
type Subjects struct {
	database *Database
	clock    Clock
	// enabled is the modules whose items are counted, or nil to count every
	// module. The registry holds rows for modules that have since been
	// switched off, and a count that included them would promise items the
	// screen cannot list.
	enabled []string
}

// NewSubjects wires the service over the database and the clock the rest of
// the process runs on.
func NewSubjects(database *Database, clock Clock) *Subjects {
	return &Subjects{database: database, clock: clock}
}

// CountingModules limits the per-kind counts to items of the named modules.
// The core's own items always count, because the core is never switched off.
func (s *Subjects) CountingModules(modules []string) *Subjects {
	s.enabled = append([]string{SubjectItemModule}, modules...)
	return s
}

// moduleFilter is the clause and arguments restricting a count to the enabled
// modules, or nothing when every module counts.
func (s *Subjects) moduleFilter() (string, []any) {
	if s.enabled == nil {
		return "", nil
	}
	args := make([]any, 0, len(s.enabled))
	for _, module := range s.enabled {
		args = append(args, module)
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")
	return " AND core_items.module IN (" + placeholders + ")", args
}

// Create registers a subject and its registry row in one transaction. A name
// whose slug is already taken is a conflict rather than a second vocabulary
// entry for the same thing.
func (s *Subjects) Create(ctx context.Context, name string, focus bool) (SubjectRecord, error) {
	trimmed := strings.TrimSpace(name)
	slug := Slugify(trimmed)
	if slug == "" {
		return SubjectRecord{}, apiBadRequest("invalid_request",
			"the name holds no letter or digit to derive a slug from", "name")
	}
	now := s.clock.Now()
	id := NewID()
	err := s.inWriteTx(ctx, func(tx *sql.Tx) error {
		queries := db.New(tx)
		if _, err := queries.GetCoreSubjectBySlug(ctx, slug); err == nil {
			return apiConflict("slug_taken", fmt.Sprintf("the slug %q is already taken", slug), "name")
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("checking the slug %s: %w", slug, err)
		}
		if err := queries.InsertCoreSubject(ctx, db.InsertCoreSubjectParams{
			ID:        id,
			Name:      trimmed,
			Slug:      slug,
			Focus:     boolToInt(focus),
			CreatedAt: FormatTime(now),
		}); err != nil {
			return fmt.Errorf("inserting the subject %s: %w", slug, err)
		}
		return RegisterItem(ctx, tx, ItemRegistration{
			ID:        id,
			Module:    SubjectItemModule,
			Type:      SubjectItemType,
			Title:     trimmed,
			URL:       subjectURL(slug),
			CreatedAt: now,
		})
	})
	if err != nil {
		return SubjectRecord{}, err
	}
	return s.Get(ctx, id)
}

// Get reads one subject with its counts.
func (s *Subjects) Get(ctx context.Context, id string) (SubjectRecord, error) {
	row, err := db.New(s.database.Reader()).GetCoreSubject(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SubjectRecord{}, apiNotFound("subject", id)
		}
		return SubjectRecord{}, fmt.Errorf("reading the subject %s: %w", id, err)
	}
	return s.withCounts(ctx, row)
}

// GetBySlug reads one subject by the slug its screen is addressed with.
func (s *Subjects) GetBySlug(ctx context.Context, slug string) (SubjectRecord, error) {
	row, err := db.New(s.database.Reader()).GetCoreSubjectBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SubjectRecord{}, apiNotFound("subject", slug)
		}
		return SubjectRecord{}, fmt.Errorf("reading the subject %s: %w", slug, err)
	}
	return s.withCounts(ctx, row)
}

// Patch renames a subject, flips its focus, or both. A rename derives a new
// slug and carries it into the registry row every link renders from, so a
// renamed subject does not keep answering at its old address with its old
// title.
func (s *Subjects) Patch(ctx context.Context, id string, name *string, focus *bool) (SubjectRecord, error) {
	if name == nil && focus == nil {
		return s.Get(ctx, id)
	}
	err := s.inWriteTx(ctx, func(tx *sql.Tx) error {
		queries := db.New(tx)
		existing, err := queries.GetCoreSubject(ctx, id)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return apiNotFound("subject", id)
			}
			return fmt.Errorf("reading the subject %s: %w", id, err)
		}
		newName, newSlug := existing.Name, existing.Slug
		if name != nil {
			newName = strings.TrimSpace(*name)
			newSlug = Slugify(newName)
			if newSlug == "" {
				return apiBadRequest("invalid_request",
					"the name holds no letter or digit to derive a slug from", "name")
			}
			if newSlug != existing.Slug {
				if _, err := queries.GetCoreSubjectBySlug(ctx, newSlug); err == nil {
					return apiConflict("slug_taken", fmt.Sprintf("the slug %q is already taken", newSlug), "name")
				} else if !errors.Is(err, sql.ErrNoRows) {
					return fmt.Errorf("checking the slug %s: %w", newSlug, err)
				}
			}
		}
		newFocus := existing.Focus
		if focus != nil {
			newFocus = boolToInt(*focus)
		}
		result, err := queries.UpdateCoreSubject(ctx, db.UpdateCoreSubjectParams{
			Name:  newName,
			Slug:  newSlug,
			Focus: newFocus,
			ID:    id,
		})
		if err != nil {
			return fmt.Errorf("updating the subject %s: %w", id, err)
		}
		if err := requireOneRow(result, "subject", id); err != nil {
			return apiNotFound("subject", id)
		}
		if newName != existing.Name {
			if err := UpdateItem(ctx, tx, id, newName, SubjectItemType); err != nil {
				return err
			}
			// The registry url is what a rendered link follows, and the
			// subject screen is addressed by slug, so a rename that left the
			// url alone would publish a link to a page that is no longer
			// there.
			if _, err := tx.ExecContext(ctx,
				`UPDATE core_items SET url = ? WHERE id = ?`, subjectURL(newSlug), id); err != nil {
				return fmt.Errorf("updating the registry url of %s: %w", id, err)
			}
		}
		return nil
	})
	if err != nil {
		return SubjectRecord{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes the subject and its registry row in one transaction. The
// registry cascade takes every link touching it, and the alias cascade takes
// its spellings; there is no undo, which is why the screen names the number of
// links first.
func (s *Subjects) Delete(ctx context.Context, id string) error {
	return s.inWriteTx(ctx, func(tx *sql.Tx) error {
		result, err := db.New(tx).DeleteCoreSubject(ctx, id)
		if err != nil {
			return fmt.Errorf("deleting the subject %s: %w", id, err)
		}
		if err := requireOneRow(result, "subject", id); err != nil {
			return apiNotFound("subject", id)
		}
		return UnregisterItem(ctx, tx, id)
	})
}

// FocusSubjects lists the subjects a person flagged, which is the explicit
// half of what the focus endpoint answers.
func (s *Subjects) FocusSubjects(ctx context.Context) ([]SubjectRecord, error) {
	rows, err := db.New(s.database.Reader()).ListFocusCoreSubjects(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing the focus subjects: %w", err)
	}
	return s.withCountsForAll(ctx, rows)
}

// FocusSubjectIDs lists the ids of the flagged subjects and nothing else.
//
// It exists next to FocusSubjects rather than being derived from it because
// the caller that ranks rows by the focus runs on every list request and wants
// the ids only: FocusSubjects counts what is linked to each subject, which is
// several queries this one does not need.
func (s *Subjects) FocusSubjectIDs(ctx context.Context) ([]string, error) {
	rows, err := db.New(s.database.Reader()).ListFocusCoreSubjects(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing the focus subject ids: %w", err)
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids, nil
}

// List reads one page of subjects.
//
// With no query the order is the slug then the id. With one, every word of
// the query must match the slug or an alias slug -- both already lowercase
// and accent-stripped, which is what makes an accent-insensitive search
// possible with no unaccent function in SQLite -- in any order. Each word is
// ranked exact before prefix before substring, and the subject's rank is the
// sum of its words' best ranks, so a subject matched by its own slug and by
// an alias comes back once, at its best rank.
func (s *Subjects) List(ctx context.Context, in SubjectListInput) (SubjectPage, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = subjectDefaultListLimit
	}
	if limit > subjectMaxListLimit {
		return SubjectPage{}, apiBadRequest("invalid_request",
			fmt.Sprintf("the page holds at most %d subjects", subjectMaxListLimit), "limit")
	}
	needle := Slugify(in.Query)
	words := subjectNeedleWords(needle)
	filterHash := subjectFilterHash(needle)
	var cursor subjectCursor
	if in.Cursor != "" {
		decoded, err := decodeSubjectCursor(in.Cursor)
		if err != nil {
			return SubjectPage{}, apiBadRequest("invalid_cursor", "the cursor does not decode", "cursor")
		}
		if decoded.FilterHash != filterHash {
			return SubjectPage{}, apiBadRequest("invalid_cursor",
				"the cursor belongs to another search", "cursor")
		}
		cursor = decoded
	}

	query, args := subjectListQuery(words, cursor, in.Cursor != "", limit+1)
	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return SubjectPage{}, fmt.Errorf("listing the subjects: %w", err)
	}
	defer rows.Close()
	found := []db.CoreSubject{}
	ranks := []int{}
	for rows.Next() {
		var row db.CoreSubject
		rank := 0
		if err := rows.Scan(&row.ID, &row.Name, &row.Slug, &row.Focus, &row.CreatedAt, &rank); err != nil {
			return SubjectPage{}, fmt.Errorf("scanning a subject row: %w", err)
		}
		found = append(found, row)
		ranks = append(ranks, rank)
	}
	if err := rows.Err(); err != nil {
		return SubjectPage{}, fmt.Errorf("listing the subjects: %w", err)
	}

	page := SubjectPage{}
	if len(found) > limit {
		last := found[limit-1]
		page.NextCursor = encodeSubjectCursor(subjectCursor{
			FilterHash: filterHash,
			Rank:       ranks[limit-1],
			Slug:       last.Slug,
			ID:         last.ID,
		})
		found = found[:limit]
	}
	items, err := s.withCountsForAll(ctx, found)
	if err != nil {
		return SubjectPage{}, err
	}
	page.Items = items
	return page, nil
}

// subjectNeedleWords splits a slugified query into its comparable words. A
// slug never starts or ends with a hyphen and never holds two in a row, so
// splitting on "-" yields the words with nothing to drop; the filter is only
// against a caller that hands in a raw string.
func subjectNeedleWords(needle string) []string {
	if needle == "" {
		return nil
	}
	parts := strings.Split(needle, "-")
	words := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			words = append(words, part)
		}
	}
	return words
}

// subjectRankExpression ranks one word's match: 0 exact, 1 prefix, 2
// substring. The minimum over the subject's own slug and its aliases is what
// makes a subject matched twice come back once, at its best rank for that
// word.
const subjectRankExpression = `(
    SELECT MIN(CASE WHEN candidate = ? THEN 0 WHEN candidate LIKE ? || '%' THEN 1 ELSE 2 END)
    FROM (
        SELECT core_subjects.slug AS candidate
        UNION ALL
        SELECT core_subject_aliases.alias_slug FROM core_subject_aliases
        WHERE core_subject_aliases.subject_id = core_subjects.id
    )
    WHERE candidate LIKE '%' || ? || '%'
)`

// subjectRankSumExpression adds one per-word rank per query word. The sum is
// NULL when any word has no match, which is what makes every word required:
// the outer filter keeps only rows whose rank is not NULL. A single word
// renders as the word's own expression, so a one-word query ranks exactly as
// before.
func subjectRankSumExpression(wordCount int) string {
	if wordCount <= 1 {
		return subjectRankExpression
	}
	parts := make([]string, 0, wordCount)
	for i := 0; i < wordCount; i++ {
		parts = append(parts, subjectRankExpression)
	}
	return "(" + strings.Join(parts, " + ") + ")"
}

// subjectListQuery renders the page query and its arguments.
//
// The rank is computed in an inner select and filtered in the outer one, so
// each word's expression appears once and its three parameters are bound
// once: a rank repeated in the WHERE clause would have to be bound again, and
// the order of those bindings is what a positional placeholder gets wrong
// first.
//
// The order is total -- rank, slug, id -- so no page boundary can split it and
// no row can appear on two pages.
func subjectListQuery(words []string, cursor subjectCursor, hasCursor bool, limit int) (string, []any) {
	args := []any{}
	rank := "0"
	if len(words) > 0 {
		rank = subjectRankSumExpression(len(words))
		for _, word := range words {
			args = append(args, word, word, word)
		}
	}
	inner := "SELECT core_subjects.id AS id, core_subjects.name AS name, core_subjects.slug AS slug," +
		" core_subjects.focus AS focus, core_subjects.created_at AS created_at, " + rank + " AS rank" +
		" FROM core_subjects"
	where := []string{}
	if len(words) > 0 {
		where = append(where, "rank IS NOT NULL")
	}
	if hasCursor {
		where = append(where,
			"(rank > ? OR (rank = ? AND slug > ?) OR (rank = ? AND slug = ? AND id > ?))")
		args = append(args, cursor.Rank, cursor.Rank, cursor.Slug, cursor.Rank, cursor.Slug, cursor.ID)
	}
	query := "SELECT id, name, slug, focus, created_at, rank FROM (" + inner + ")"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY rank, slug, id"
	query += fmt.Sprintf(" LIMIT %d", limit)
	return query, args
}

// subjectCursor is the opaque page token: the position in the total order and
// a hash of the search it was issued under, so a cursor presented with another
// search is refused rather than silently continuing a different query.
type subjectCursor struct {
	V          int    `json:"v"`
	FilterHash string `json:"fh"`
	Rank       int    `json:"r"`
	Slug       string `json:"s"`
	ID         string `json:"id"`
}

const subjectCursorVersion = 1

func encodeSubjectCursor(cursor subjectCursor) string {
	cursor.V = subjectCursorVersion
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeSubjectCursor(raw string) (subjectCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return subjectCursor{}, err
	}
	var cursor subjectCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return subjectCursor{}, err
	}
	if cursor.V != subjectCursorVersion || cursor.ID == "" {
		return subjectCursor{}, fmt.Errorf("unknown cursor version")
	}
	return cursor, nil
}

func subjectFilterHash(needle string) string {
	sum := sha256.Sum256([]byte("subjects\x00" + needle))
	return fmt.Sprintf("%x", sum)
}

// withCounts fills one row's counts.
func (s *Subjects) withCounts(ctx context.Context, row db.CoreSubject) (SubjectRecord, error) {
	records, err := s.withCountsForAll(ctx, []db.CoreSubject{row})
	if err != nil {
		return SubjectRecord{}, err
	}
	return records[0], nil
}

// withCountsForAll fills the counts of a whole page in two queries rather than
// two per row: the sidebar and the Estudo home both render every subject they
// hold, and a per-row read would be one round trip per line on screen.
func (s *Subjects) withCountsForAll(ctx context.Context, rows []db.CoreSubject) ([]SubjectRecord, error) {
	records := make([]SubjectRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, SubjectRecord{Row: row})
	}
	if len(rows) == 0 {
		return records, nil
	}
	ids := make([]any, 0, len(rows))
	index := make(map[string]int, len(rows))
	for i, row := range rows {
		ids = append(ids, row.ID)
		index[row.ID] = i
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")

	moduleClause, moduleArgs := s.moduleFilter()
	byType, err := s.database.Reader().QueryContext(ctx,
		`SELECT core_links.dst_id, core_items.module, core_items.type, COUNT(*)
         FROM core_links
         JOIN core_items ON core_items.id = core_links.src_id
         WHERE core_links.dst_id IN (`+placeholders+`)
           AND core_links.kind = 'about' AND core_links.status = 'confirmed'`+moduleClause+`
         GROUP BY core_links.dst_id, core_items.module, core_items.type
         ORDER BY core_items.module, core_items.type`, append(append([]any{}, ids...), moduleArgs...)...)
	if err != nil {
		return nil, fmt.Errorf("counting what is linked to the subjects: %w", err)
	}
	defer byType.Close()
	for byType.Next() {
		var dstID, module, itemType string
		var count int
		if err := byType.Scan(&dstID, &module, &itemType, &count); err != nil {
			return nil, fmt.Errorf("scanning a subject count: %w", err)
		}
		at, ok := index[dstID]
		if !ok {
			continue
		}
		records[at].ByType = append(records[at].ByType,
			SubjectTypeCount{Module: module, Type: itemType, Count: count})
		records[at].Total += count
	}
	if err := byType.Err(); err != nil {
		return nil, fmt.Errorf("counting what is linked to the subjects: %w", err)
	}

	touching, err := s.database.Reader().QueryContext(ctx,
		`SELECT id, (SELECT COUNT(*) FROM core_links
                     WHERE core_links.src_id = core_items.id OR core_links.dst_id = core_items.id)
         FROM core_items WHERE id IN (`+placeholders+`)`, ids...)
	if err != nil {
		return nil, fmt.Errorf("counting the links of the subjects: %w", err)
	}
	defer touching.Close()
	for touching.Next() {
		var id string
		var count int
		if err := touching.Scan(&id, &count); err != nil {
			return nil, fmt.Errorf("scanning a subject link count: %w", err)
		}
		if at, ok := index[id]; ok {
			records[at].LinkCount = count
		}
	}
	if err := touching.Err(); err != nil {
		return nil, fmt.Errorf("counting the links of the subjects: %w", err)
	}
	return records, nil
}

// inWriteTx runs fn in one writer transaction, rolling back whatever it left
// behind when it failed.
func (s *Subjects) inWriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the subject transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the subject transaction: %w", err)
	}
	return nil
}

// subjectURL is the address the subject's screen answers at, stored in the
// registry so a rendered link needs nothing from this package to follow.
func subjectURL(slug string) string {
	return "/assuntos/" + slug
}

func boolToInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

// SubjectFocus reports whether the stored flag means "a current focus".
func SubjectFocus(row db.CoreSubject) bool { return row.Focus == 1 }
