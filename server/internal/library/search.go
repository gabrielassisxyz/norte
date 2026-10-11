package library

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// libraryItemPath is the frontend route that opens a saved item in the
// reader. The search answer carries the route rather than the id alone, so a
// client follows a hit without having to know how this module's screens are
// addressed.
func libraryItemPath(id string) string { return "/library/" + id }

// librarySearchEntries is the module's answer for GET /api/core/search: the
// same full-text query the list endpoint runs, with the bm25 ranking mapped
// onto the [0, 1] score the merge orders by.
//
// A raw bm25 value cannot be sent as a score: it is negative, unbounded, and
// its scale moves with the corpus and with the number of terms, so a merge
// comparing it against another module's number would be comparing nothing.
// What survives the mapping is the ordering of this query's own hits.
//
// A query with no searchable word in it reports no hits rather than an error.
// The list endpoint refuses such a query, which is right when the query is
// the whole request; here it is one source among several, and one module
// refusing would turn the other modules' hits into a failure.
func librarySearchEntries(ctx context.Context, database *core.Database, query string, limit int) ([]core.SearchEntry, error) {
	if database == nil || limit <= 0 {
		return []core.SearchEntry{}, nil
	}
	match, err := librarySearchTerms(query)
	if err != nil {
		return []core.SearchEntry{}, nil
	}
	statement := "SELECT library_items.id, library_items.title, library_items.kind," +
		" library_items.author, library_items.site, " + libraryFTSRank + " AS rank" +
		" FROM library_items JOIN library_fts ON library_fts.id = library_items.id" +
		" WHERE library_fts MATCH ?" +
		" ORDER BY rank ASC, library_items.id ASC" +
		fmt.Sprintf(" LIMIT %d", limit)
	rows, err := database.Reader().QueryContext(ctx, statement, match)
	if err != nil {
		return nil, fmt.Errorf("searching the library: %w", err)
	}
	defer rows.Close()
	entries := []core.SearchEntry{}
	ranks := []float64{}
	for rows.Next() {
		var (
			id, title, kind string
			author, site    sql.NullString
			rank            float64
		)
		if err := rows.Scan(&id, &title, &kind, &author, &site, &rank); err != nil {
			return nil, fmt.Errorf("scanning a library search row: %w", err)
		}
		entries = append(entries, core.SearchEntry{
			ID:       id,
			Module:   ModuleName,
			Type:     kind,
			Title:    title,
			Subtitle: librarySearchSubtitle(author, site),
			Path:     libraryItemPath(id),
		})
		ranks = append(ranks, rank)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("searching the library: %w", err)
	}
	scores := core.NormalizeSearchScores(ranks, true)
	for i := range entries {
		entries[i].Score = scores[i]
	}
	return entries, nil
}

// librarySearchSubtitle is the one line of context a hit carries: who wrote
// it, or failing that where it came from. An item with neither gets none,
// because a row that says only "" is a row with a blank second line.
func librarySearchSubtitle(author, site sql.NullString) string {
	if author.Valid && author.String != "" {
		return author.String
	}
	if site.Valid && site.String != "" {
		return site.String
	}
	return ""
}
