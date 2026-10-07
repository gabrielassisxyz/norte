package core

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// Link kinds, sources and statuses. These are the values the CHECK constraints
// on core_links accept, named here so a caller does not spell one wrongly and
// learn about it from a constraint violation at runtime.
const (
	LinkKindAbout       = "about"
	LinkKindMaterialOf  = "material_of"
	LinkKindDerivedFrom = "derived_from"
	LinkKindBlocks      = "blocks"

	LinkSourceManual = "manual"
	LinkSourceLLM    = "llm"

	LinkStatusConfirmed = "confirmed"
	LinkStatusSuggested = "suggested"
	LinkStatusRejected  = "rejected"
)

// Links writes core_links. Together with the endpoint that decides a suggestion
// these are the only writers of that table, so the rules about what a (src, dst,
// kind) triple may become live in one place instead of being re-derived at every
// call site.
var Links linkWriter

type linkWriter struct{}

// Confirm asserts that a link holds, whatever was there before.
//
// A triple with no row gets a manual, confirmed one. A suggested or rejected row
// of that triple flips to confirmed, with source set to manual and decided_at
// recorded -- a person overriding the model, or changing their mind, is the same
// operation. An already confirmed row is left exactly as it is, including its
// decided_at: confirming twice must not move the date a person decided
// something.
func (linkWriter) Confirm(ctx context.Context, tx *sql.Tx, now time.Time, srcID, dstID, kind string) error {
	stamp := FormatTime(now)
	err := db.New(tx).ConfirmCoreLink(ctx, db.ConfirmCoreLinkParams{
		ID:        NewID(),
		SrcID:     srcID,
		DstID:     dstID,
		Kind:      kind,
		CreatedAt: stamp,
		DecidedAt: sql.NullString{String: stamp, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("confirming the %s link from %s to %s: %w", kind, srcID, dstID, err)
	}
	return nil
}

// Suggest records what the model thinks, and never overrides what a person
// decided.
//
// A triple with no row gets an llm, suggested one. An existing suggested row has
// its confidence updated, because a later pass over the same pair is a better
// estimate of the same suggestion rather than a second one. A confirmed or
// rejected row is left untouched: both are decisions, and re-suggesting a
// rejected link would put it back in the review queue the person just emptied.
func (linkWriter) Suggest(ctx context.Context, tx *sql.Tx, now time.Time, srcID, dstID, kind string, confidence float64) error {
	err := db.New(tx).SuggestCoreLink(ctx, db.SuggestCoreLinkParams{
		ID:         NewID(),
		SrcID:      srcID,
		DstID:      dstID,
		Kind:       kind,
		Confidence: sql.NullFloat64{Float64: confidence, Valid: true},
		CreatedAt:  FormatTime(now),
	})
	if err != nil {
		return fmt.Errorf("suggesting the %s link from %s to %s: %w", kind, srcID, dstID, err)
	}
	return nil
}
