// Package core carries the boundary types modules speak through.
//
// A module owns its tables and its routes, and the core owns the way modules
// are discovered: the value types below and the narrow provider interfaces. The
// core never imports app, so app.Module refers to these types and never the
// reverse; that direction is what keeps the dependency acyclic.
package core

import (
	"context"
	"math"
)

// FocusTarget is one thing the person is working on now, as a module reports
// it. GET /api/core/focus merges these across the enabled modules and adds the
// subjects a person flagged.
type FocusTarget struct {
	ID    string
	Type  string
	Title string
}

// SearchEntry is one hit a module reports for a query. Score is a finite
// float in [0, 1], so entries from different modules can be ordered together.
type SearchEntry struct {
	ID       string
	Module   string
	Type     string
	Title    string
	Subtitle string
	Path     string
	Score    float64
}

// ValidSearchScore reports whether score is a finite float in [0, 1].
func ValidSearchScore(score float64) bool {
	return !math.IsNaN(score) && !math.IsInf(score, 0) && score >= 0 && score <= 1
}

// TextProvider returns the readable text of an item the module owns. The
// second result is false when the id belongs to nobody this provider knows.
type TextProvider interface {
	Text(ctx context.Context, id string) (string, bool, error)
}

// FocusProvider lists what the person is working on now.
type FocusProvider interface {
	FocusTargets(ctx context.Context) ([]FocusTarget, error)
}

// SearchProvider reports hits for a query, at most limit of them.
type SearchProvider interface {
	SearchEntries(ctx context.Context, q string, limit int) ([]SearchEntry, error)
}
