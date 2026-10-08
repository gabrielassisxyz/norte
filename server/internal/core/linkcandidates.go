package core

import (
	"context"
	"fmt"
)

// LinkCandidate is one destination a classifier may propose: the registry id a
// link would point at, and the title the prompt names it by.
type LinkCandidate struct {
	ID    string
	Title string
}

// LinkCandidateSource is everything a classifier may propose linking to. A
// module takes this interface rather than the service below, so a test hands
// it a fixed list and never a database.
type LinkCandidateSource interface {
	LinkCandidates(ctx context.Context) ([]LinkCandidate, error)
}

// LinkCandidates answers the candidate set: the whole subject vocabulary, plus
// what every enabled module reports as in progress.
//
// It lives in the core because the rule that builds the set is the core's: a
// module asking "what could this item be about" must not have to know that
// subjects and focus targets are two tables and a provider interface, nor that
// an id can arrive from both.
type LinkCandidates struct {
	database  *Database
	providers []FocusProvider
}

// NewLinkCandidates wires the set over the subject table and the providers the
// registry injected, the same ones GET /api/core/focus merges.
func NewLinkCandidates(database *Database, providers []FocusProvider) *LinkCandidates {
	return &LinkCandidates{database: database, providers: providers}
}

// LinkCandidates lists every destination, subjects first and deduplicated by
// id.
//
// Subjects come first because they win the deduplication: a subject is the
// stable vocabulary and a focus target is a passing state of one module's
// work, so when the same id arrives twice the subject record is the one the
// prompt should name it by. The order is otherwise fixed -- subjects by name
// then id, then each provider in the configured order -- because the prompt
// built from this set is compared against a golden file, and a set that
// reordered itself between runs would make that comparison meaningless.
//
// A candidate with no title is dropped: it would reach the model as an id with
// nothing to judge it by, and the model would be guessing.
func (c *LinkCandidates) LinkCandidates(ctx context.Context) ([]LinkCandidate, error) {
	rows, err := c.database.Reader().QueryContext(ctx,
		`SELECT id, name FROM core_subjects ORDER BY name, id`)
	if err != nil {
		return nil, fmt.Errorf("listing the subjects a classifier may propose: %w", err)
	}
	defer rows.Close()
	candidates := []LinkCandidate{}
	seen := map[string]bool{}
	for rows.Next() {
		var candidate LinkCandidate
		if err := rows.Scan(&candidate.ID, &candidate.Title); err != nil {
			return nil, fmt.Errorf("scanning a candidate subject: %w", err)
		}
		if candidate.Title == "" || seen[candidate.ID] {
			continue
		}
		seen[candidate.ID] = true
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("listing the subjects a classifier may propose: %w", err)
	}

	for _, provider := range c.providers {
		targets, err := provider.FocusTargets(ctx)
		if err != nil {
			// The whole set fails rather than being served short: a prompt
			// missing one module's work reads to the model as "the person is
			// working on nothing there", which is the one answer it must not
			// be allowed to invent.
			return nil, fmt.Errorf("reading a module's focus targets: %w", err)
		}
		for _, target := range targets {
			if target.Title == "" || seen[target.ID] {
				continue
			}
			seen[target.ID] = true
			candidates = append(candidates, LinkCandidate{ID: target.ID, Title: target.Title})
		}
	}
	return candidates, nil
}
