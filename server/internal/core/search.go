package core

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

// How much one search answers.
const (
	// SearchProviderLimit is how many hits each source may contribute: every
	// enabled module, and the subjects. One source must not be able to fill
	// the whole answer, which is what a per-source cap buys that a total cap
	// alone does not.
	SearchProviderLimit = 10
	// SearchTotalLimit is how many hits the merge returns. The palette shows
	// the best answers to a word someone is still typing; a second page of
	// them is a different question, asked on a module's own screen.
	SearchTotalLimit = 30
	// SearchQueryMaxLength is the longest q the contract accepts, in
	// characters. A palette query is a word or two; a pasted paragraph would
	// be handed to every module's full-text index.
	SearchQueryMaxLength = 200
)

// SearchAPI answers GET /api/core/search: every enabled module's hits plus the
// subjects, merged into one ordered list.
//
// The providers are handed in rather than discovered, for the same reason
// FocusAPI's are: the core knows nothing about the module registry and must
// not, so the registry injects the enabled modules here and the dependency
// stays pointing one way.
type SearchAPI struct {
	subjects  *Subjects
	providers []SearchProvider
}

// NewSearchAPI wires the service over the subjects it reads and the providers
// the registry injected.
func NewSearchAPI(subjects *Subjects, providers []SearchProvider) *SearchAPI {
	return &SearchAPI{subjects: subjects, providers: providers}
}

// Search answers one query.
//
// The order is the documented one -- score descending, then title, then id --
// and it does not depend on the order the providers were registered in: the
// entries are sorted before they are deduplicated, so the best-scoring copy
// of a repeated id is the one kept whichever module answered first.
//
// A provider that fails fails the whole call rather than being skipped, the
// same way the focus does: a palette that silently dropped one module's hits
// would read as "that word is nowhere", which is the one answer it must not
// invent.
func (s *SearchAPI) Search(ctx context.Context, query string) ([]SearchEntry, error) {
	if s == nil || s.subjects == nil {
		return nil, errNoDatabase
	}
	if strings.TrimSpace(query) == "" {
		return nil, apiBadRequest("invalid_request", "the query holds no searchable word", "q")
	}
	if utf8.RuneCountInString(query) > SearchQueryMaxLength {
		return nil, apiBadRequest("invalid_request",
			fmt.Sprintf("the query is longer than %d characters", SearchQueryMaxLength), "q")
	}
	merged := []SearchEntry{}
	subjects, err := s.subjects.SubjectSearchEntries(ctx, query, SearchProviderLimit)
	if err != nil {
		return nil, err
	}
	merged = append(merged, subjects...)
	for _, provider := range s.providers {
		entries, err := provider.SearchEntries(ctx, query, SearchProviderLimit)
		if err != nil {
			return nil, fmt.Errorf("reading a module's search hits: %w", err)
		}
		// Truncated here rather than trusted: the limit is this endpoint's
		// promise to its caller, and a provider that answered with more of
		// its own rows would spend another module's share of the answer.
		if len(entries) > SearchProviderLimit {
			entries = entries[:SearchProviderLimit]
		}
		for _, entry := range entries {
			if !ValidSearchScore(entry.Score) {
				return nil, fmt.Errorf("module %q scored %q at %v, which is outside [0, 1]",
					entry.Module, entry.ID, entry.Score)
			}
			merged = append(merged, entry)
		}
	}
	sortSearchEntries(merged)
	merged = dedupeSearchEntries(merged)
	if len(merged) > SearchTotalLimit {
		merged = merged[:SearchTotalLimit]
	}
	return merged, nil
}

// sortSearchEntries puts the entries in the documented total order: the score
// descending, then the title, then the id. The id is what makes it total, so
// two hits that match equally well and are named the same still come back in
// one fixed order rather than whatever the scan happened to produce.
func sortSearchEntries(entries []SearchEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		left, right := entries[i], entries[j]
		if left.Score != right.Score {
			return left.Score > right.Score
		}
		if left.Title != right.Title {
			return left.Title < right.Title
		}
		return left.ID < right.ID
	})
}

// dedupeSearchEntries keeps the first entry of each id in an already sorted
// list, which is the best-scoring one. Two modules can report the same
// registry id -- a saved link and a note anchored to it -- and the palette
// shows one row per thing.
func dedupeSearchEntries(entries []SearchEntry) []SearchEntry {
	seen := make(map[string]bool, len(entries))
	out := make([]SearchEntry, 0, len(entries))
	for _, entry := range entries {
		if seen[entry.ID] {
			continue
		}
		seen[entry.ID] = true
		out = append(out, entry)
	}
	return out
}
