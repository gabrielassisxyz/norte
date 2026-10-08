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
