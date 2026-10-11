package core

import (
	"context"
	"fmt"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// subjectSearchPath is the frontend route that opens a subject. The search
// answer carries the route rather than the slug, so a client follows a hit
// without knowing which module -- or which of the core's own tables -- it
// came from.
func subjectSearchPath(slug string) string { return "/subjects/" + slug }

// SubjectSearchEntries reports the subjects matching query, best first, as
// search entries the merge can order against a module's.
//
// It reuses the page query the subject list is built from, so the match rule
// is one rule: every word of the query must occur in the slug or in an alias
// slug -- both already lowercase and accent-stripped -- in any order, each
// word ranked exact before prefix before substring, and a subject matched by
// its own slug and by an alias counted once.
//
// The scores are the ranks of this query's own hits mapped onto [0, 1] with
// NormalizeSearchScores, lower rank better, like the other providers: the
// best hit scores 1, the worst 0, and everything between lands proportionally.
// The mapping is linear, so the relative order among subject hits is the rank
// order the list query produced. A single hit, or several tied for best, all
// score 1 rather than 0, so a query's only answer is never buried below
// another module's.
//
// A query that normalises to nothing -- punctuation, or a single accent --
// matches no subject rather than every subject. The list endpoint reads an
// empty needle as "no filter", which is right for a list and wrong here.
func (s *Subjects) SubjectSearchEntries(ctx context.Context, query string, limit int) ([]SearchEntry, error) {
	if s == nil {
		return nil, errNoDatabase
	}
	words := subjectNeedleWords(Slugify(query))
	if len(words) == 0 || limit <= 0 {
		return []SearchEntry{}, nil
	}
	statement, args := subjectListQuery(words, subjectCursor{}, false, limit)
	rows, err := s.database.Reader().QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, fmt.Errorf("searching the subjects: %w", err)
	}
	defer rows.Close()
	entries := []SearchEntry{}
	rawRanks := []float64{}
	for rows.Next() {
		var row db.CoreSubject
		rank := 0
		if err := rows.Scan(&row.ID, &row.Name, &row.Slug, &row.Focus, &row.CreatedAt, &rank); err != nil {
			return nil, fmt.Errorf("scanning a subject search row: %w", err)
		}
		entries = append(entries, SearchEntry{
			ID:     row.ID,
			Module: "core",
			Type:   "subject",
			Title:  row.Name,
			Path:   subjectSearchPath(row.Slug),
		})
		rawRanks = append(rawRanks, float64(rank))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("searching the subjects: %w", err)
	}
	scores := NormalizeSearchScores(rawRanks, true)
	for i := range entries {
		entries[i].Score = scores[i]
	}
	return entries, nil
}
