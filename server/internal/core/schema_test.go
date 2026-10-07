package core_test

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// fixedInstant is the created_at every test row gets, so a failure message
// quoting a timestamp is reading the test's value and not the wall clock.
var fixedInstant = time.Date(2026, 3, 9, 17, 0, 0, 0, time.UTC)

// registerTestItem puts one row in the registry and returns its id. Everything
// in core_links and core_file_refs needs an item at the other end of a foreign
// key, so nearly every test here starts with two of these.
func registerTestItem(t *testing.T, database *core.Database, title string) string {
	t.Helper()
	id := core.NewID()
	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.RegisterItem(context.Background(), tx, core.ItemRegistration{
			ID:        id,
			Module:    "library",
			Type:      "article",
			Title:     title,
			URL:       "https://example.invalid/" + title,
			CreatedAt: fixedInstant,
		})
	})
	return id
}

// inCoreTransaction runs fn in a transaction on the writer and commits, which is
// how a module calls the core's helpers.
func inCoreTransaction(t *testing.T, database *core.Database, fn func(*sql.Tx) error) {
	t.Helper()
	tx, err := database.Writer().Begin()
	if err != nil {
		t.Fatalf("beginning a transaction: %v", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		t.Fatalf("inside the transaction: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("committing: %v", err)
	}
}

func countRows(t *testing.T, database *core.Database, query string, args ...any) int {
	t.Helper()
	var count int
	if err := database.Reader().QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("counting with %q: %v", query, err)
	}
	return count
}

func TestTheCoreMigrationCreatesEveryCoreTableAndIndex(t *testing.T) {
	database := newMigratedCoreDatabase(t)

	for _, group := range []struct {
		kind  string
		names []string
	}{
		{"table", []string{
			"core_file_refs", "core_files", "core_items", "core_jobs",
			"core_links", "core_settings", "core_subject_aliases", "core_subjects",
		}},
		{"index", []string{
			"core_jobs_dedupe", "core_jobs_runnable",
			"core_links_by_dst", "core_links_by_src", "core_links_triple",
		}},
	} {
		rows, err := database.Reader().Query(
			`SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`, group.kind)
		if err != nil {
			t.Fatalf("reading sqlite_master for %ss: %v", group.kind, err)
		}
		var present []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatalf("reading a %s name: %v", group.kind, err)
			}
			present = append(present, name)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("reading sqlite_master for %ss: %v", group.kind, err)
		}
		rows.Close()

		for _, want := range group.names {
			if !slices.Contains(present, want) {
				t.Errorf("the migration created no %s %s; it created %v", group.kind, want, present)
			}
		}
	}

	// The core's own version table, and only the core's: a module gets its own,
	// so that two modules cannot collide on the next migration number.
	if got := countRows(t, database,
		`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'goose_%'`); got != 1 {
		t.Errorf("found %d goose version tables, want exactly 1 (%s)", got, core.CoreMigrationTable)
	}
	if got := countRows(t, database,
		`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, core.CoreMigrationTable); got != 1 {
		t.Errorf("the core's version table is not called %s", core.CoreMigrationTable)
	}
}

// TestEveryEnumeratedColumnRefusesAValueOutsideItsSet is why the CHECKs are
// there: the database is the last line, and a module inserting a typo for a
// status would otherwise leave a row no query ever matches and nothing ever
// reports.
func TestEveryEnumeratedColumnRefusesAValueOutsideItsSet(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	const insertLink = `INSERT INTO core_links
		(id, src_id, dst_id, kind, source, status, confidence, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	stamp := core.FormatTime(fixedInstant)

	cases := []struct {
		name      string
		statement string
		args      []any
	}{
		{
			name:      "core_links.kind",
			statement: insertLink,
			args:      []any{core.NewID(), src, dst, "relates_to", "manual", "confirmed", nil, stamp},
		},
		{
			name:      "core_links.source",
			statement: insertLink,
			args:      []any{core.NewID(), src, dst, "about", "heuristic", "confirmed", nil, stamp},
		},
		{
			name:      "core_links.status",
			statement: insertLink,
			args:      []any{core.NewID(), src, dst, "about", "manual", "maybe", nil, stamp},
		},
		{
			name:      "core_links.confidence above one",
			statement: insertLink,
			args:      []any{core.NewID(), src, dst, "about", "llm", "suggested", 1.5, stamp},
		},
		{
			name:      "core_links.confidence below zero",
			statement: insertLink,
			args:      []any{core.NewID(), src, dst, "about", "llm", "suggested", -0.1, stamp},
		},
		{
			name: "core_jobs.status",
			statement: `INSERT INTO core_jobs (id, kind, status, available_at, created_at)
				VALUES (?, ?, ?, ?, ?)`,
			args: []any{core.NewID(), "fetch", "pending", stamp, stamp},
		},
		{
			name:      "core_file_refs.kind",
			statement: `INSERT INTO core_file_refs (hash, owner_id, kind) VALUES (?, ?, ?)`,
			args:      []any{"0" + strings.Repeat("a", 63), src, "attachment"},
		},
		{
			name: "core_subjects.focus",
			statement: `INSERT INTO core_subjects (id, name, slug, focus, created_at)
				VALUES (?, ?, ?, ?, ?)`,
			args: []any{core.NewID(), "Rust", "rust", 2, stamp},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := database.Writer().Exec(testCase.statement, testCase.args...)
			if err == nil {
				t.Fatalf("%s accepted a value outside its set", testCase.name)
			}
			if !strings.Contains(err.Error(), "CHECK constraint failed") {
				t.Errorf("%s was refused, but not by its CHECK: %v", testCase.name, err)
			}
		})
	}
}

func TestASecondLinkWithTheSameTripleIsRefused(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	src := registerTestItem(t, database, "source")
	dst := registerTestItem(t, database, "destination")

	insert := func(status string) error {
		_, err := database.Writer().Exec(
			`INSERT INTO core_links (id, src_id, dst_id, kind, source, status, created_at)
			 VALUES (?, ?, ?, 'about', 'manual', ?, ?)`,
			core.NewID(), src, dst, status, core.FormatTime(fixedInstant))
		return err
	}
	if err := insert("confirmed"); err != nil {
		t.Fatalf("inserting the first link: %v", err)
	}
	// Same triple, different status: the index is on the triple alone, because
	// one pair of items related one way is one fact however it was decided.
	err := insert("suggested")
	if err == nil {
		t.Fatal("a second link with the same (src_id, dst_id, kind) was accepted")
	}
	if !strings.Contains(err.Error(), "UNIQUE constraint failed") {
		t.Errorf("the second link was refused, but not by the unique index: %v", err)
	}

	// A different kind between the same two items is a different fact and stays
	// allowed -- otherwise the index would be on the pair and this would fail.
	if _, err := database.Writer().Exec(
		`INSERT INTO core_links (id, src_id, dst_id, kind, source, status, created_at)
		 VALUES (?, ?, ?, 'blocks', 'manual', 'confirmed', ?)`,
		core.NewID(), src, dst, core.FormatTime(fixedInstant)); err != nil {
		t.Errorf("a second kind between the same items was refused: %v", err)
	}
}

// TestDeletingAnItemRemovesEveryLinkTouchingIt covers both directions of the
// cascade, and keeps a link between two surviving items to prove the delete is
// targeted rather than a clearing of the table.
func TestDeletingAnItemRemovesEveryLinkTouchingIt(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	doomed := registerTestItem(t, database, "doomed")
	other := registerTestItem(t, database, "other")
	third := registerTestItem(t, database, "third")

	link := func(src, dst, kind string) {
		t.Helper()
		if _, err := database.Writer().Exec(
			`INSERT INTO core_links (id, src_id, dst_id, kind, source, status, created_at)
			 VALUES (?, ?, ?, ?, 'manual', 'confirmed', ?)`,
			core.NewID(), src, dst, kind, core.FormatTime(fixedInstant)); err != nil {
			t.Fatalf("linking %s to %s: %v", src, dst, err)
		}
	}
	link(doomed, other, "about")  // the doomed item as source
	link(third, doomed, "blocks") // and as destination
	link(other, third, "about")   // untouched by the delete

	if got := countRows(t, database, `SELECT count(*) FROM core_links`); got != 3 {
		t.Fatalf("set-up left %d links, want 3", got)
	}

	if _, err := database.Writer().Exec(`DELETE FROM core_items WHERE id = ?`, doomed); err != nil {
		t.Fatalf("deleting the item: %v", err)
	}

	if got := countRows(t, database,
		`SELECT count(*) FROM core_links WHERE src_id = ? OR dst_id = ?`, doomed, doomed); got != 0 {
		t.Errorf("%d links to the deleted item survived", got)
	}
	if got := countRows(t, database, `SELECT count(*) FROM core_links`); got != 1 {
		t.Errorf("%d links remain, want the 1 between the two surviving items", got)
	}
}

// TestADedupeKeyBlocksASecondOutstandingJobButNotALaterOne is the partial index.
// A non-partial unique index would pass the first half of this and fail the
// second, which is the mistake it is here to prevent: "fetch this page" has to
// be enqueueable again once the first attempt has finished.
func TestADedupeKeyBlocksASecondOutstandingJobButNotALaterOne(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	stamp := core.FormatTime(fixedInstant)

	enqueue := func(status string) error {
		_, err := database.Writer().Exec(
			`INSERT INTO core_jobs (id, kind, dedupe_key, status, available_at, created_at)
			 VALUES (?, 'fetch', 'page:1', ?, ?, ?)`, core.NewID(), status, stamp, stamp)
		return err
	}

	if err := enqueue("queued"); err != nil {
		t.Fatalf("enqueueing the first job: %v", err)
	}
	if err := enqueue("running"); err == nil {
		t.Error("a second outstanding job with the same dedupe key was accepted")
	} else if !strings.Contains(err.Error(), "UNIQUE constraint failed") {
		t.Errorf("the second job was refused, but not by the dedupe index: %v", err)
	}

	if _, err := database.Writer().Exec(
		`UPDATE core_jobs SET status = 'done' WHERE dedupe_key = 'page:1'`); err != nil {
		t.Fatalf("finishing the first job: %v", err)
	}
	if err := enqueue("queued"); err != nil {
		t.Errorf("the same dedupe key was refused after the first job finished: %v", err)
	}
}
