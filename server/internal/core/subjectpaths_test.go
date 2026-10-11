package core

import (
	"context"
	"testing"

	"github.com/pressly/goose/v3"

	"github.com/gabrielassisxyz/norte/server/internal/core/migrations"
)

// subjectPathsPreVersion is the migration under test, and subjectPathsVersion
// the migration before it -- the state every database a pre-rename build
// leaves behind is in.
const (
	subjectPathsVersion    = 3
	subjectPathsPreVersion = 2
)

// subjectPathsHarness is a database stopped at the migration before the
// subject path rename, so a test can write the registry rows the rename has
// to carry and then step the core forwards and backwards over it.
type subjectPathsHarness struct {
	t        *testing.T
	database *Database
	provider *goose.Provider
}

func newSubjectPathsHarness(t *testing.T) *subjectPathsHarness {
	t.Helper()
	database, err := OpenDatabase(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("opening a database: %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})
	provider, err := goose.NewProvider(goose.DialectSQLite3, database.Writer(), migrations.FS,
		goose.WithTableName(CoreMigrationTable),
		// migrate.go explains the registry; without it this provider would
		// find the other packages' migrations on top of the core's.
		goose.WithDisableGlobalRegistry(true),
	)
	if err != nil {
		t.Fatalf("preparing the core migrations: %v", err)
	}
	harness := &subjectPathsHarness{t: t, database: database, provider: provider}
	harness.step(subjectPathsPreVersion)
	return harness
}

func (h *subjectPathsHarness) step(version int64) {
	h.t.Helper()
	if _, err := h.provider.UpTo(context.Background(), version); err != nil {
		h.t.Fatalf("migrating the core to %d: %v", version, err)
	}
}

func (h *subjectPathsHarness) down() {
	h.t.Helper()
	if _, err := h.provider.Down(context.Background()); err != nil {
		h.t.Fatalf("rolling the core back: %v", err)
	}
}

// url reads one registry row's url. A row this harness never wrote means the
// seed did not land, so the test fails rather than reporting a rewrite of
// nothing.
func (h *subjectPathsHarness) url(id string) string {
	h.t.Helper()
	var value string
	if err := h.database.Reader().QueryRow(
		`SELECT url FROM core_items WHERE id = ?`, id).Scan(&value); err != nil {
		h.t.Fatalf("reading the registry url of %s: %v", id, err)
	}
	return value
}

// seed writes a subject the way Create does -- the subject row and the
// registry row that registers it -- plus two registry rows the rewrite must
// leave alone: one whose module is not the core's, one whose url is not a
// subject path at all.
func (h *subjectPathsHarness) seed() {
	h.t.Helper()
	statements := []struct {
		statement string
		args      []any
	}{
		{
			`INSERT INTO core_subjects (id, name, slug, focus, created_at)
			   VALUES ('subject-memoria', 'Memória', 'memoria', 0, '2026-01-01T00:00:00Z')`,
			nil,
		},
		{
			`INSERT INTO core_items (id, module, type, title, url, created_at)
			   VALUES ('subject-memoria', 'core', 'subject', 'Memória', '/assuntos/memoria', '2026-01-01T00:00:00Z')`,
			nil,
		},
		{
			`INSERT INTO core_items (id, module, type, title, url, created_at)
			   VALUES ('item-estranha', 'library', 'article', 'Um artigo emprestado', '/assuntos/artigo-emprestado', '2026-01-01T00:00:00Z')`,
			nil,
		},
		{
			`INSERT INTO core_items (id, module, type, title, url, created_at)
			   VALUES ('subject-outro', 'core', 'subject', 'Um livro na estante', '/library/um-livro', '2026-01-01T00:00:00Z')`,
			nil,
		},
	}
	for _, statement := range statements {
		if _, err := h.database.Writer().Exec(statement.statement, statement.args...); err != nil {
			h.t.Fatalf("seeding %s: %v", statement.statement, err)
		}
	}
}

// TestTheSubjectPathMigrationCarriesTheRegistry walks the rename forwards
// over the rows an older build left: the subject's registry url moves to the
// address the new build serves, and a row that is not the core's own
// subject-shaped url keeps exactly what it had.
func TestTheSubjectPathMigrationCarriesTheRegistry(t *testing.T) {
	harness := newSubjectPathsHarness(t)
	harness.seed()

	harness.step(subjectPathsVersion)

	if got := harness.url("subject-memoria"); got != "/subjects/memoria" {
		t.Errorf("the subject's registry url = %q, want /subjects/memoria", got)
	}
	if got := harness.url("item-estranha"); got != "/assuntos/artigo-emprestado" {
		t.Errorf("another module's registry url = %q, want it untouched", got)
	}
	if got := harness.url("subject-outro"); got != "/library/um-livro" {
		t.Errorf("a core row whose url is not a subject path = %q, want it untouched", got)
	}
}

// TestTheSubjectPathMigrationRollsBack is the down step: the registry url
// goes back to what the pre-rename build wrote, and the rows the up step left
// alone stay untouched through the return trip too.
func TestTheSubjectPathMigrationRollsBack(t *testing.T) {
	harness := newSubjectPathsHarness(t)
	harness.seed()
	harness.step(subjectPathsVersion)

	harness.down()

	if got := harness.url("subject-memoria"); got != "/assuntos/memoria" {
		t.Errorf("the subject's registry url = %q, want /assuntos/memoria", got)
	}
	if got := harness.url("item-estranha"); got != "/assuntos/artigo-emprestado" {
		t.Errorf("another module's registry url = %q, want it untouched", got)
	}
	if got := harness.url("subject-outro"); got != "/library/um-livro" {
		t.Errorf("a core row whose url is not a subject path = %q, want it untouched", got)
	}
}