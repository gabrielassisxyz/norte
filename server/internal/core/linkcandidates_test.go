package core_test

import (
	"context"
	"errors"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

// fixedFocusProvider is one module's focus, as a test owns it.
type fixedFocusProvider struct {
	targets []core.FocusTarget
	err     error
}

func (f fixedFocusProvider) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return f.targets, f.err
}

func candidateIDs(candidates []core.LinkCandidate) []string {
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	return ids
}

// TestLinkCandidatesListsEverySubjectAndEveryModulesTargets is the set the
// classifier chooses from: the whole vocabulary, not the focused part of it,
// plus what each module reports.
func TestLinkCandidatesListsEverySubjectAndEveryModulesTargets(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	subjects := core.NewSubjects(database, clocktest.New(fixedInstant))
	// Created out of alphabetical order, because the set is ordered by name.
	zeta, err := subjects.Create(context.Background(), "Zeta", false)
	if err != nil {
		t.Fatalf("creating a subject: %v", err)
	}
	alfa, err := subjects.Create(context.Background(), "Alfa", true)
	if err != nil {
		t.Fatalf("creating a subject: %v", err)
	}
	target := registerTestItem(t, database, "um-curso")

	set := core.NewLinkCandidates(database, []core.FocusProvider{
		fixedFocusProvider{targets: []core.FocusTarget{
			{ID: target, Type: "course", Title: "Um curso"},
		}},
	})
	candidates, err := set.LinkCandidates(context.Background())
	if err != nil {
		t.Fatalf("reading the candidates: %v", err)
	}

	want := []string{alfa.Row.ID, zeta.Row.ID, target}
	if got := candidateIDs(candidates); len(got) != 3 ||
		got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Errorf("candidates = %v, want the subjects by name then the targets %v", got, want)
	}
	if candidates[0].Title != "Alfa" {
		t.Errorf("the first candidate is titled %q, want the subject's name", candidates[0].Title)
	}
}

// TestLinkCandidatesNamesAnIdOnceAndTheSubjectWins is the deduplication rule.
// A module reporting a subject as its own focus target is the collision this
// is for, and the subject record is the one that must survive it, because the
// subject's name is the stable one.
func TestLinkCandidatesNamesAnIdOnceAndTheSubjectWins(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	subject, err := core.NewSubjects(database, clocktest.New(fixedInstant)).
		Create(context.Background(), "Em foco", true)
	if err != nil {
		t.Fatalf("creating the subject: %v", err)
	}

	set := core.NewLinkCandidates(database, []core.FocusProvider{
		fixedFocusProvider{targets: []core.FocusTarget{
			{ID: subject.Row.ID, Type: "subject", Title: "A different title entirely"},
		}},
	})
	candidates, err := set.LinkCandidates(context.Background())
	if err != nil {
		t.Fatalf("reading the candidates: %v", err)
	}
	if len(candidates) != 1 {
		t.Fatalf("candidates = %v, want the one id once", candidateIDs(candidates))
	}
	if candidates[0].Title != "Em foco" {
		t.Errorf("the surviving title is %q, want the subject's own", candidates[0].Title)
	}
}

// TestLinkCandidatesDropsATargetWithNoTitle: an untitled candidate reaches the
// model as an id with nothing to judge it by, so the model would be guessing.
func TestLinkCandidatesDropsATargetWithNoTitle(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	untitled := registerTestItem(t, database, "sem-titulo")

	set := core.NewLinkCandidates(database, []core.FocusProvider{
		fixedFocusProvider{targets: []core.FocusTarget{{ID: untitled, Type: "course", Title: ""}}},
	})
	candidates, err := set.LinkCandidates(context.Background())
	if err != nil {
		t.Fatalf("reading the candidates: %v", err)
	}
	if len(candidates) != 0 {
		t.Errorf("candidates = %v, want none", candidateIDs(candidates))
	}
}

// TestLinkCandidatesFailsWhenAModuleCannotReportItsFocus: a set served short
// reads to the model as "the person is working on nothing there", which is the
// one answer it must not be allowed to invent.
func TestLinkCandidatesFailsWhenAModuleCannotReportItsFocus(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	broken := errors.New("this module cannot say")
	set := core.NewLinkCandidates(database, []core.FocusProvider{
		fixedFocusProvider{err: broken},
	})
	if _, err := set.LinkCandidates(context.Background()); !errors.Is(err, broken) {
		t.Errorf("the candidates answered %v, want the module's own failure", err)
	}
}
