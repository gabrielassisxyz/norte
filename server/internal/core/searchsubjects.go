package core

import (
	"context"
	"fmt"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// The subject scores, one per rank the match expression reports. A subject is
// not ranked by a text measure like a module's rows are: a name either is what
// was typed, or starts with it, or merely contains it, and those three cases
// are the whole scale.
//
// They are fixed rather than normalised over the query's own hits, because
// the three cases mean the same thing in every query: "the subject you named"
// must outrank "a subject whose name happens to contain that word" even when
// both are the only two hits, and a per-query normalisation would flatten
// exactly that difference.
const (
	subjectSearchExactScore     = 1.0
	subjectSearchPrefixScore    = 0.8
	subjectSearchSubstringScore = 0.6
)

// subjectSearchPath is the frontend route that opens a subject. The search
// answer carries the route rather than the slug, so a client follows a hit
// without knowing which module -- or which of the core's own tables -- it
// came from.
func subjectSearchPath(slug string) string { return "/assuntos/" + slug }

// SubjectSearchEntries reports the subjects matching query, best first, as
// search entries the merge can order against a module's.
//
// It reuses the page query the subject list is built from, so the match rule
// is one rule: the slug and the alias slugs, both already lowercase and
// accent-stripped, ranked exact before prefix before substring, and a subject
// matched by its own slug and by an alias counted once.
//
// A query that normalises to nothing -- punctuation, or a single accent --
// matches no subject rather than every subject. The list endpoint reads an
// empty needle as "no filter", which is right for a list and wrong here.
func (s *Subjects) SubjectSearchEntries(ctx context.Context, query string, limit int) ([]SearchEntry, error) {
	if s == nil {
		return nil, errNoDatabase
	}
	needle := Slugify(query)
	if needle == "" || limit <= 0 {
		return []SearchEntry{}, nil
	}
	statement, args := subjectListQuery(needle, subjectCursor{}, false, limit)
	rows, err := s.database.Reader().QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, fmt.Errorf("searching the subjects: %w", err)
	}
	defer rows.Close()
	entries := []SearchEntry{}
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
			Score:  subjectSearchScore(rank),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("searching the subjects: %w", err)
	}
	return entries, nil
}

// subjectSearchScore maps the match expression's rank onto the score scale.
// An unknown rank scores as a substring match, which is the weakest of the
// three: a rank this function does not know is a rank it must not promote.
func subjectSearchScore(rank int) float64 {
	switch rank {
	case 0:
		return subjectSearchExactScore
	case 1:
		return subjectSearchPrefixScore
	default:
		return subjectSearchSubstringScore
	}
}
