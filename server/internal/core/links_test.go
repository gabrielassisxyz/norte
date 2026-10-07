package core_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// linkRow is core_links as the tests read it back.
type linkRow struct {
	ID         string
	Source     string
	Status     string
	Confidence sql.NullFloat64
	CreatedAt  string
	DecidedAt  sql.NullString
}

func readTheOnlyLink(t *testing.T, database *core.Database, srcID, dstID, kind string) linkRow {
	t.Helper()
	if got := countRows(t, database,
		`SELECT count(*) FROM core_links WHERE src_id = ? AND dst_id = ? AND kind = ?`,
		srcID, dstID, kind); got != 1 {
		t.Fatalf("the triple has %d rows, want exactly 1", got)
	}
	var row linkRow
	err := database.Reader().QueryRow(
		`SELECT id, source, status, confidence, created_at, decided_at FROM core_links
		 WHERE src_id = ? AND dst_id = ? AND kind = ?`, srcID, dstID, kind).
		Scan(&row.ID, &row.Source, &row.Status, &row.Confidence, &row.CreatedAt, &row.DecidedAt)
	if err != nil {
		t.Fatalf("reading the link: %v", err)
	}
	return row
}

// TestConfirmTurnsARejectedTripleIntoOneManualDecision is the case a plain
// INSERT would fail on and a plain "insert or ignore" would silently leave
// rejected: a person changing their mind about a link they dismissed.
func TestConfirmTurnsARejectedTripleIntoOneManualDecision(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	if _, err := database.Writer().Exec(
		`INSERT INTO core_links (id, src_id, dst_id, kind, source, status, confidence, created_at, decided_at)
		 VALUES (?, ?, ?, 'about', 'llm', 'rejected', 0.4, ?, ?)`,
		core.NewID(), src, dst, core.FormatTime(fixedInstant), core.FormatTime(fixedInstant)); err != nil {
		t.Fatalf("seeding the rejected link: %v", err)
	}

	decidedAt := fixedInstant.Add(time.Hour)
	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Confirm(context.Background(), tx, decidedAt, src, dst, core.LinkKindAbout)
	})

	row := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)
	if row.Status != core.LinkStatusConfirmed {
		t.Errorf("status = %q, want %q", row.Status, core.LinkStatusConfirmed)
	}
	if row.Source != core.LinkSourceManual {
		t.Errorf("source = %q, want %q: a person overriding the model owns the row", row.Source, core.LinkSourceManual)
	}
	if want := core.FormatTime(decidedAt); row.DecidedAt.String != want {
		t.Errorf("decided_at = %q, want %q", row.DecidedAt.String, want)
	}
}

func TestConfirmInsertsAManualLinkWhenTheTripleIsNew(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Confirm(context.Background(), tx, fixedInstant, src, dst, core.LinkKindMaterialOf)
	})

	row := readTheOnlyLink(t, database, src, dst, core.LinkKindMaterialOf)
	if row.Status != core.LinkStatusConfirmed || row.Source != core.LinkSourceManual {
		t.Errorf("a new confirmation is %s/%s, want confirmed/manual", row.Status, row.Source)
	}
	if row.Confidence.Valid {
		t.Errorf("confidence = %v on a manual link, want NULL: a person's decision has no score",
			row.Confidence.Float64)
	}
	if want := core.FormatTime(fixedInstant); row.DecidedAt.String != want {
		t.Errorf("decided_at = %q, want %q", row.DecidedAt.String, want)
	}
}

// TestConfirmLeavesAnAlreadyConfirmedTripleUntouched matters because
// decided_at is a date shown to a person. A re-confirmation that moved it would
// report that they decided today something they decided last month.
func TestConfirmLeavesAnAlreadyConfirmedTripleUntouched(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Confirm(context.Background(), tx, fixedInstant, src, dst, core.LinkKindAbout)
	})
	first := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Confirm(context.Background(), tx, fixedInstant.Add(30*24*time.Hour), src, dst, core.LinkKindAbout)
	})
	second := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)

	if second != first {
		t.Errorf("confirming twice changed the row:\nbefore %+v\nafter  %+v", first, second)
	}
}

func TestSuggestRecordsTheModelsGuess(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Suggest(context.Background(), tx, fixedInstant, src, dst, core.LinkKindAbout, 0.62)
	})

	row := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)
	if row.Status != core.LinkStatusSuggested || row.Source != core.LinkSourceLLM {
		t.Errorf("a new suggestion is %s/%s, want suggested/llm", row.Status, row.Source)
	}
	if !row.Confidence.Valid || row.Confidence.Float64 != 0.62 {
		t.Errorf("confidence = %v, want 0.62", row.Confidence)
	}
	if row.DecidedAt.Valid {
		t.Errorf("decided_at = %q on a suggestion, want NULL: nobody has decided it yet", row.DecidedAt.String)
	}
}

// TestSuggestUpdatesTheConfidenceOfAnOutstandingSuggestion keeps a second pass
// over the same pair from becoming a second suggestion -- it is a better
// estimate of the same one.
func TestSuggestUpdatesTheConfidenceOfAnOutstandingSuggestion(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Suggest(context.Background(), tx, fixedInstant, src, dst, core.LinkKindAbout, 0.4)
	})
	first := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.Links.Suggest(context.Background(), tx, fixedInstant.Add(time.Hour), src, dst, core.LinkKindAbout, 0.9)
	})
	second := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)

	if second.Confidence.Float64 != 0.9 {
		t.Errorf("confidence = %v after the second pass, want 0.9", second.Confidence)
	}
	if second.ID != first.ID {
		t.Errorf("the second suggestion replaced the row (%s became %s) instead of updating it", first.ID, second.ID)
	}
}

// TestSuggestChangesNothingAboutADecidedTriple covers both decisions. Confirmed
// is the obvious one; rejected is the one that matters in use, because
// re-suggesting a rejected link puts it back in the queue the person just
// emptied, every time the model runs.
func TestSuggestChangesNothingAboutADecidedTriple(t *testing.T) {
	for _, decision := range []string{core.LinkStatusConfirmed, core.LinkStatusRejected} {
		t.Run(decision, func(t *testing.T) {
			database := newMigratedCoreDatabase(t)
			src := registerTestItem(t, database, "source")
			dst := registerTestItem(t, database, "destination")

			if _, err := database.Writer().Exec(
				`INSERT INTO core_links (id, src_id, dst_id, kind, source, status, confidence, created_at, decided_at)
				 VALUES (?, ?, ?, 'about', 'manual', ?, NULL, ?, ?)`,
				core.NewID(), src, dst, decision,
				core.FormatTime(fixedInstant), core.FormatTime(fixedInstant)); err != nil {
				t.Fatalf("seeding the %s link: %v", decision, err)
			}
			before := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)

			inCoreTransaction(t, database, func(tx *sql.Tx) error {
				return core.Links.Suggest(context.Background(), tx, fixedInstant.Add(time.Hour),
					src, dst, core.LinkKindAbout, 0.99)
			})
			after := readTheOnlyLink(t, database, src, dst, core.LinkKindAbout)

			if after != before {
				t.Errorf("suggesting over a %s link changed it:\nbefore %+v\nafter  %+v", decision, before, after)
			}
		})
	}
}
