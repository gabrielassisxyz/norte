package core

import (
	"context"
	"fmt"
)

// FocusResult is what GET /api/core/focus answers: the subjects a person
// flagged, and what every enabled module reports as in progress.
type FocusResult struct {
	Subjects []SubjectRecord
	Targets  []FocusTarget
}

// FocusAPI merges the one explicit part of the focus -- the subject flag --
// with what each module derives.
//
// The providers are handed in rather than discovered, because the core knows
// nothing about the module registry and must not: the registry injects the
// enabled modules here, and the dependency stays pointing one way.
type FocusAPI struct {
	subjects  *Subjects
	providers []FocusProvider
}

// NewFocusAPI wires the service over the subjects it reads and the providers
// the registry injected.
func NewFocusAPI(subjects *Subjects, providers []FocusProvider) *FocusAPI {
	return &FocusAPI{subjects: subjects, providers: providers}
}

// Current answers the focus.
//
// A provider that fails fails the whole call rather than being skipped: a
// focus that silently dropped one module's work would read as "nothing in
// progress there", which is the one answer the screen must not invent.
func (s *FocusAPI) Current(ctx context.Context) (FocusResult, error) {
	subjects, err := s.subjects.FocusSubjects(ctx)
	if err != nil {
		return FocusResult{}, err
	}
	result := FocusResult{Subjects: subjects, Targets: []FocusTarget{}}
	for _, provider := range s.providers {
		targets, err := provider.FocusTargets(ctx)
		if err != nil {
			return FocusResult{}, fmt.Errorf("reading a module's focus targets: %w", err)
		}
		result.Targets = append(result.Targets, targets...)
	}
	return result, nil
}

// TargetIDs lists the registry ids of everything in focus, flagged subjects
// first and then each provider's in-progress items, with a duplicate dropped.
//
// It answers the one question a module ranking its own rows by the focus has:
// which core_items ids a link has to point at to count. The records behind
// those ids are deliberately not returned -- a ranking joins on the id, and
// handing it the titles would invite a second copy of what the focus endpoint
// already renders.
//
// A provider that fails fails the whole call, for the same reason Current
// does: a ranking computed from a focus that silently lost one module's work
// would quietly bury exactly the items that module is working through.
func (s *FocusAPI) TargetIDs(ctx context.Context) ([]string, error) {
	ids, err := s.subjects.FocusSubjectIDs(ctx)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, provider := range s.providers {
		targets, err := provider.FocusTargets(ctx)
		if err != nil {
			return nil, fmt.Errorf("reading a module's focus targets: %w", err)
		}
		for _, target := range targets {
			if !seen[target.ID] {
				seen[target.ID] = true
				out = append(out, target.ID)
			}
		}
	}
	return out, nil
}
