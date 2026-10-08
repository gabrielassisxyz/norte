package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// libraryItemColumns is the whole row, in sqlc's order, so the hand-built
// list query scans into the same shape the generated queries return.
const libraryItemColumns = `id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, why, selection, status, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at`

// libraryFTSRank orders full-text hits. bm25 takes one weight per FTS column in
// table order, the UNINDEXED id included, so the first weight is id's (0) and
// the rest follow title, author, why, content_headings, content_text: title
// above headings above the note above the author above the text.
const libraryFTSRank = `bm25(library_fts, 0.0, 10.0, 2.0, 5.0, 7.0, 1.0)`

// Library list sorts, and the rank pseudo-sort a text query orders by.
const (
	LibrarySortSavedDesc      = "saved_desc"
	LibrarySortSavedAsc       = "saved_asc"
	LibrarySortTitle          = "title"
	LibrarySortLastOpenedDesc = "last_opened_desc"
	librarySortRank           = "rank"
	libraryDefaultListLimit   = 50
	libraryMaxListLimit       = 200
)

// ListInput is what GET /api/library/items filters by. SortExplicit tells a
// text query from a defaulted sort: an explicit sort together with q is
// refused, while the default simply gives way to the rank.
type ListInput struct {
	View         string
	Kind         string
	Unread       *bool
	Sort         string
	SortExplicit bool
	Query        string
	Cursor       string
	Limit        int
}

// ListResult is one page: the summaries and the cursor for the next one, or
// "" when this page is the last.
type ListResult struct {
	Items      []db.LibraryItem
	NextCursor string
}

// libraryCursor is the opaque page token: the sort position and a hash of the
// filters, so a cursor presented with different filters or sort is refused
// rather than silently continuing another query's pagination.
type libraryCursor struct {
	V          int     `json:"v"`
	Sort       string  `json:"sort"`
	FilterHash string  `json:"fh"`
	Primary    string  `json:"p,omitempty"`
	Rank       float64 `json:"r,omitempty"`
	HasRank    bool    `json:"hr,omitempty"`
	ID         string  `json:"id"`
}

const libraryCursorVersion = 1

func libraryEncodeCursor(cursor libraryCursor) string {
	cursor.V = libraryCursorVersion
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func libraryDecodeCursor(raw string) (libraryCursor, error) {
	var cursor libraryCursor
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return libraryCursor{}, err
	}
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return libraryCursor{}, err
	}
	if cursor.V != libraryCursorVersion || cursor.ID == "" {
		return libraryCursor{}, fmt.Errorf("unknown cursor version")
	}
	return cursor, nil
}

// libraryFilterHash binds a cursor to the query that produced it.
func libraryFilterHash(view, kind string, unread *bool, query string) string {
	unreadKey := "nil"
	if unread != nil {
		if *unread {
			unreadKey = "true"
		} else {
			unreadKey = "false"
		}
	}
	sum := sha256.Sum256([]byte(view + "\x00" + kind + "\x00" + unreadKey + "\x00" + query))
	return fmt.Sprintf("%x", sum)
}

// librarySearchTerms splits a query into quoted FTS5 terms joined by AND: every
// word must appear somewhere in the searched columns. A query with no word in
// it is refused rather than answered with everything.
func librarySearchTerms(query string) (string, error) {
	words := strings.FieldsFunc(query, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	if len(words) == 0 {
		return "", libraryBadRequest("invalid_request", "the query holds no searchable word", "q")
	}
	quoted := make([]string, len(words))
	for i, word := range words {
		quoted[i] = `"` + strings.ReplaceAll(word, `"`, `""`) + `"`
	}
	return strings.Join(quoted, " AND "), nil
}

// List reads one page of summaries. Every sort is a total order with the id
// breaking ties, backed by an index for the stored columns; a text query
// orders by rank, then id.
func (s *LibraryService) List(ctx context.Context, in ListInput) (ListResult, error) {
	view := in.View
	if view == "" {
		view = "inbox"
	}
	switch view {
	case "inbox", "depois", "arquivo", "tudo", LibraryViewNow:
	default:
		return ListResult{}, libraryBadRequest("invalid_request", fmt.Sprintf("unknown view %q", view), "view")
	}
	sort := in.Sort
	if sort == "" {
		sort = LibrarySortSavedDesc
	}
	switch sort {
	case LibrarySortSavedDesc, LibrarySortSavedAsc, LibrarySortTitle, LibrarySortLastOpenedDesc:
	default:
		return ListResult{}, libraryBadRequest("invalid_request", fmt.Sprintf("unknown sort %q", sort), "sort")
	}
	if in.Kind != "" && !libraryValidKinds[in.Kind] {
		return ListResult{}, libraryBadRequest("invalid_request", fmt.Sprintf("unknown kind %q", in.Kind), "tipo")
	}
	if in.Query != "" && in.SortExplicit {
		return ListResult{}, libraryBadRequest("invalid_request", "sort and q cannot be combined: a text query orders by rank", "sort")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = libraryDefaultListLimit
	}
	if limit > libraryMaxListLimit {
		return ListResult{}, libraryBadRequest("invalid_request", "the page holds at most 200 items", "limit")
	}
	effectiveSort := sort
	// The now view is not a shelf and not a sort the caller may choose: it
	// reads every status, keeps only what is unread, and orders by the focus
	// score. Normalising unread here rather than only in the WHERE is what
	// makes a cursor issued with no unread parameter continue a list asked
	// for with unread=true -- the same page, so the same filter hash.
	var focusTargets []string
	if view == LibraryViewNow {
		if err := libraryRefuseNowConflicts(in); err != nil {
			return ListResult{}, err
		}
		unread := true
		in.Unread = &unread
		effectiveSort = librarySortNow
		targets, err := s.libraryFocusTargets(ctx)
		if err != nil {
			return ListResult{}, err
		}
		focusTargets = targets
	}
	var match string
	if in.Query != "" {
		effectiveSort = librarySortRank
		var err error
		match, err = librarySearchTerms(in.Query)
		if err != nil {
			return ListResult{}, err
		}
	}
	filterHash := libraryFilterHash(view, in.Kind, in.Unread, in.Query)
	var cursor libraryCursor
	if in.Cursor != "" {
		decoded, err := libraryDecodeCursor(in.Cursor)
		if err != nil {
			return ListResult{}, libraryBadRequest("invalid_cursor", "the cursor does not decode", "cursor")
		}
		if decoded.Sort != effectiveSort || decoded.FilterHash != filterHash {
			return ListResult{}, libraryBadRequest("invalid_cursor",
				"the cursor belongs to another view, filter or sort", "cursor")
		}
		cursor = decoded
	}

	qualified := "library_items." + strings.Join(strings.Split(
		strings.Join(strings.Fields(libraryItemColumns), " "), ", "), ", library_items.")
	selectCols := qualified
	from := "library_items"
	where := []string{}
	args := []any{}
	if in.Query != "" {
		selectCols += ", " + libraryFTSRank + " AS rank"
		from = "library_items JOIN library_fts ON library_fts.id = library_items.id"
		where = append(where, "library_fts MATCH ?")
		args = append(args, match)
	}
	if effectiveSort == librarySortNow {
		// The join's placeholders sit in FROM, ahead of every WHERE
		// placeholder, so its arguments have to be bound first.
		join, joinArgs := libraryFocusScoreJoin(focusTargets)
		selectCols += ", " + libraryFocusScoreRounded + " AS score"
		from += join
		args = append(args, joinArgs...)
	}
	if view != "tudo" && view != LibraryViewNow {
		where = append(where, "library_items.status = ?")
		args = append(args, view)
	}
	if in.Kind != "" {
		where = append(where, "library_items.kind = ?")
		args = append(args, in.Kind)
	}
	if in.Unread != nil {
		where = append(where, "library_items.unread = ?")
		if *in.Unread {
			args = append(args, 1)
		} else {
			args = append(args, 0)
		}
	}
	if effectiveSort == LibrarySortLastOpenedDesc {
		where = append(where, "library_items.last_opened_at IS NOT NULL")
	}
	if in.Cursor != "" {
		predicate, predicateArgs := libraryCursorPredicate(effectiveSort, cursor)
		where = append(where, predicate)
		args = append(args, predicateArgs...)
	}
	query := "SELECT " + selectCols + " FROM " + from
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY " + libraryOrderBy(effectiveSort)
	query += fmt.Sprintf(" LIMIT %d", limit+1)

	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return ListResult{}, fmt.Errorf("listing the library: %w", err)
	}
	defer rows.Close()
	items := []db.LibraryItem{}
	ranks := []float64{}
	for rows.Next() {
		row, rank, err := libraryScanListRow(rows, in.Query != "" || effectiveSort == librarySortNow)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, row)
		ranks = append(ranks, rank)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("listing the library: %w", err)
	}
	result := ListResult{}
	if len(items) > limit {
		last := items[limit-1]
		lastRank := ranks[limit-1]
		result.NextCursor = libraryEncodeCursor(libraryCursorFor(effectiveSort, filterHash, last, lastRank))
		items = items[:limit]
	}
	result.Items = items
	if result.Items == nil {
		result.Items = []db.LibraryItem{}
	}
	return result, nil
}

// libraryOrderBy renders the ORDER BY for a sort. Every one ends on the id,
// which is what makes each a total order no page boundary can split.
func libraryOrderBy(sort string) string {
	switch sort {
	case LibrarySortSavedAsc:
		return "library_items.saved_at ASC, library_items.id ASC"
	case LibrarySortTitle:
		return "library_items.title ASC, library_items.id ASC"
	case LibrarySortLastOpenedDesc:
		return "library_items.last_opened_at DESC, library_items.id DESC"
	case librarySortRank:
		return "rank ASC, library_items.id ASC"
	case librarySortNow:
		return libraryNowOrderBy
	default:
		return "library_items.saved_at DESC, library_items.id DESC"
	}
}

// libraryCursorPredicate renders the WHERE clause continuing a page: rows
// strictly after the cursor's position in the sort's total order.
func libraryCursorPredicate(sort string, cursor libraryCursor) (string, []any) {
	switch sort {
	case LibrarySortSavedAsc:
		return "(library_items.saved_at > ? OR (library_items.saved_at = ? AND library_items.id > ?))",
			[]any{cursor.Primary, cursor.Primary, cursor.ID}
	case LibrarySortTitle:
		return "(library_items.title > ? OR (library_items.title = ? AND library_items.id > ?))",
			[]any{cursor.Primary, cursor.Primary, cursor.ID}
	case LibrarySortLastOpenedDesc:
		return "(library_items.last_opened_at < ? OR (library_items.last_opened_at = ? AND library_items.id < ?))",
			[]any{cursor.Primary, cursor.Primary, cursor.ID}
	case librarySortRank:
		rank := "(" + libraryFTSRank + ")"
		return "(" + rank + " > ? OR (" + rank + " = ? AND library_items.id > ?))",
			[]any{cursor.Rank, cursor.Rank, cursor.ID}
	case librarySortNow:
		// Three levels deep because the now order is three columns, and a
		// page boundary inside a run of equal scores has to continue by the
		// saved date rather than restarting the run.
		score := libraryFocusScoreRounded
		return "(" + score + " < ROUND(?, 9) OR (" + score + " = ROUND(?, 9) AND (library_items.saved_at < ?" +
				" OR (library_items.saved_at = ? AND library_items.id < ?))))",
			[]any{cursor.Rank, cursor.Rank, cursor.Primary, cursor.Primary, cursor.ID}
	default:
		return "(library_items.saved_at < ? OR (library_items.saved_at = ? AND library_items.id < ?))",
			[]any{cursor.Primary, cursor.Primary, cursor.ID}
	}
}

// libraryCursorFor builds the cursor continuing after row.
func libraryCursorFor(sort, filterHash string, row db.LibraryItem, rank float64) libraryCursor {
	cursor := libraryCursor{Sort: sort, FilterHash: filterHash, ID: row.ID}
	switch sort {
	case LibrarySortSavedAsc, LibrarySortSavedDesc:
		cursor.Primary = row.SavedAt
	case LibrarySortTitle:
		cursor.Primary = row.Title
	case LibrarySortLastOpenedDesc:
		cursor.Primary = row.LastOpenedAt.String
	case librarySortRank:
		cursor.Rank = rank
		cursor.HasRank = true
	case librarySortNow:
		cursor.Primary = row.SavedAt
		cursor.Rank = rank
		cursor.HasRank = true
	}
	return cursor
}

// libraryScanListRow scans one list row in libraryItemColumns order, plus the
// one float column a query may add: the full-text rank when the query
// searched, or the focus score under view=now. Only one of the two is ever
// selected, because the list refuses q together with that view.
func libraryScanListRow(rows *sql.Rows, withRank bool) (db.LibraryItem, float64, error) {
	var row db.LibraryItem
	var rank float64
	targets := []any{
		&row.ID, &row.Kind, &row.Url, &row.CanonicalUrl, &row.Title, &row.TitleEdited,
		&row.Author, &row.Site, &row.PublishedAt, &row.LeadImage, &row.Why, &row.Selection,
		&row.Status, &row.Unread, &row.SavedAt, &row.ReadAt, &row.LastOpenedAt,
		&row.ReadPosition, &row.Source, &row.HtmlHash, &row.ContentHtml, &row.ContentText,
		&row.ContentHeadings, &row.ExtractStatus, &row.ExtractGeneration, &row.ExtractedAt,
		&row.ExtractError, &row.Minutes, &row.Meta, &row.CreatedAt, &row.UpdatedAt,
	}
	if withRank {
		targets = append(targets, &rank)
	}
	if err := rows.Scan(targets...); err != nil {
		return db.LibraryItem{}, 0, fmt.Errorf("scanning a library row: %w", err)
	}
	return row, rank, nil
}
