package library

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/pressly/goose/v3"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/migrations"
)

// libraryMigrationHarness is a database stopped at the migration before the
// location rename, so a test can write the Portuguese rows the rename has to
// carry and then step forwards and backwards over it.
type libraryMigrationHarness struct {
	t        *testing.T
	database *core.Database
	provider *goose.Provider
}

// libraryLocationVersion is the migration under test, and
// libraryPreLocationVersion the one before it -- the state every existing
// installation is in when this change arrives.
const (
	libraryPreLocationVersion = 3
	libraryLocationVersion    = 4
)

// libraryTagVersion is the tags migration, which a database holding rows from
// 00003 reaches through 00004's rename on its way up, and
// libraryRouterVersion the router's, which arrives over the tags it must not
// cascade away.
const (
	libraryTagVersion    = 5
	libraryRouterVersion = 6
)

// newLibraryMigrationHarness opens a database, migrates the core in full and
// the library only as far as the migration before this one.
func newLibraryMigrationHarness(t *testing.T) *libraryMigrationHarness {
	t.Helper()
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, database.Writer(), migrations.FS,
		goose.WithTableName("goose_"+ModuleName),
		goose.WithDisableGlobalRegistry(true),
	)
	if err != nil {
		t.Fatalf("preparing the library migrations: %v", err)
	}
	harness := &libraryMigrationHarness{t: t, database: database, provider: provider}
	harness.upTo(libraryPreLocationVersion)
	return harness
}

func (h *libraryMigrationHarness) upTo(version int64) {
	h.t.Helper()
	if _, err := h.provider.UpTo(context.Background(), version); err != nil {
		h.t.Fatalf("migrating the library up to %d: %v", version, err)
	}
}

func (h *libraryMigrationHarness) down() {
	h.t.Helper()
	if _, err := h.provider.Down(context.Background()); err != nil {
		h.t.Fatalf("rolling the library back: %v", err)
	}
}

func (h *libraryMigrationHarness) exec(statement string, args ...any) {
	h.t.Helper()
	if _, err := h.database.Writer().ExecContext(context.Background(), statement, args...); err != nil {
		h.t.Fatalf("running %q: %v", statement, err)
	}
}

// execErr is exec for the statements a test expects to be refused.
func (h *libraryMigrationHarness) execErr(statement string, args ...any) error {
	h.t.Helper()
	_, err := h.database.Writer().ExecContext(context.Background(), statement, args...)
	return err
}

func (h *libraryMigrationHarness) queryString(statement string, args ...any) string {
	h.t.Helper()
	var value string
	if err := h.database.Reader().QueryRowContext(context.Background(), statement, args...).Scan(&value); err != nil {
		h.t.Fatalf("reading %q: %v", statement, err)
	}
	return value
}

func (h *libraryMigrationHarness) queryInt(statement string, args ...any) int {
	h.t.Helper()
	var value int
	if err := h.database.Reader().QueryRowContext(context.Background(), statement, args...).Scan(&value); err != nil {
		h.t.Fatalf("reading %q: %v", statement, err)
	}
	return value
}

// writePortugueseItem writes one pre-rename row and its registry row, with the
// note in the column the rename moves, so the FTS index has something to find
// it by.
func (h *libraryMigrationHarness) writePortugueseItem(id, kind, status, why string) {
	h.t.Helper()
	stamp := core.FormatTime(libraryFixedInstant)
	h.exec(`INSERT INTO core_items (id, module, type, title, url, created_at)
	        VALUES (?, 'library', ?, ?, ?, ?)`,
		id, kind, "Título de "+id, "https://example.org/"+id, stamp)
	h.exec(`INSERT INTO library_items
	          (id, kind, url, canonical_url, title, title_edited, why, status, unread,
	           saved_at, source, extract_status, extract_generation, meta, created_at, updated_at)
	        VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?, 'app', 'pending', 1, '{}', ?, ?)`,
		id, kind, "https://example.org/"+id, "https://example.org/"+id, "Título de "+id,
		sql.NullString{String: why, Valid: why != ""}, status, stamp, stamp, stamp)
}

// writeEnglishItem writes one post-rename row, for the locations that only
// exist after the up step.
func (h *libraryMigrationHarness) writeEnglishItem(id, kind, location, reason string) error {
	h.t.Helper()
	stamp := core.FormatTime(libraryFixedInstant)
	h.exec(`INSERT INTO core_items (id, module, type, title, url, created_at)
	        VALUES (?, 'library', ?, ?, ?, ?)`,
		id, kind, "Title of "+id, "/library/"+id, stamp)
	return h.execErr(`INSERT INTO library_items
	          (id, kind, url, canonical_url, title, title_edited, reason, location, unread,
	           saved_at, source, extract_status, extract_generation, meta, created_at, updated_at)
	        VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?, 'app', 'pending', 1, '{}', ?, ?)`,
		id, kind, "https://example.org/"+id, "https://example.org/"+id, "Title of "+id,
		sql.NullString{String: reason, Valid: reason != ""}, location, stamp, stamp, stamp)
}

// libraryPreLocationRows are the three stored locations and the three renamed
// kinds, one row each, plus the two kinds the rename leaves alone.
var libraryPreLocationRows = []struct {
	id         string
	kind       string
	status     string
	why        string
	wantKind   string
	wantPlace  string
	wantModule string
}{
	{id: "row-inbox", kind: "post", status: "inbox", why: "zarabatana",
		wantKind: "article", wantPlace: "inbox"},
	{id: "row-depois", kind: "livro", status: "depois", why: "para reler",
		wantKind: "book", wantPlace: "later"},
	{id: "row-arquivo", kind: "curso", status: "arquivo", why: "terminado",
		wantKind: "course", wantPlace: "archive"},
	{id: "row-paper", kind: "paper", status: "inbox", why: "",
		wantKind: "paper", wantPlace: "inbox"},
	{id: "row-video", kind: "video", status: "depois", why: "",
		wantKind: "video", wantPlace: "later"},
}

// TestTheLocationMigrationCarriesEveryStoredValue is the up step: every row
// lands on the mapped location and the mapped kind in library_items and in
// core_items both, the note is findable through the renamed FTS column, and
// the new table accepts the two locations that arrive empty while refusing a
// sixth.
func TestTheLocationMigrationCarriesEveryStoredValue(t *testing.T) {
	harness := newLibraryMigrationHarness(t)
	for _, row := range libraryPreLocationRows {
		harness.writePortugueseItem(row.id, row.kind, row.status, row.why)
	}

	harness.upTo(libraryLocationVersion)

	for _, row := range libraryPreLocationRows {
		if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, row.id); got != row.wantPlace {
			t.Errorf("%s is in %q, want %q", row.id, got, row.wantPlace)
		}
		if got := harness.queryString(`SELECT kind FROM library_items WHERE id = ?`, row.id); got != row.wantKind {
			t.Errorf("%s is a %q, want %q", row.id, got, row.wantKind)
		}
		if got := harness.queryString(`SELECT type FROM core_items WHERE id = ?`, row.id); got != row.wantKind {
			t.Errorf("the registry row of %s is a %q, want %q", row.id, got, row.wantKind)
		}
	}

	// The note moved column and the index was rebuilt from the copied rows,
	// so the word that was only ever in `why` is now found through `reason`.
	if got := harness.queryInt(
		`SELECT COUNT(*) FROM library_fts WHERE library_fts MATCH 'reason:zarabatana'`); got != 1 {
		t.Errorf("searching the reason column found %d rows, want 1", got)
	}

	if err := harness.writeEnglishItem("row-up-next", "article", "up_next", "triage"); err != nil {
		t.Errorf("inserting an up_next row: %v", err)
	}
	if err := harness.writeEnglishItem("row-stash", "article", "stash", "kept"); err != nil {
		t.Errorf("inserting a stash row: %v", err)
	}
	if err := harness.writeEnglishItem("row-sixth", "article", "depois", "refused"); err == nil {
		t.Error("inserting a sixth location was accepted, want the CHECK to refuse it")
	}

	// Nothing outside the five locations or the seven kinds is left anywhere.
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_items
	    WHERE location NOT IN ('inbox', 'up_next', 'later', 'archive', 'stash')`); got != 0 {
		t.Errorf("%d rows hold a location outside the five", got)
	}
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_items
	    WHERE kind NOT IN ('article', 'book', 'paper', 'video', 'podcast', 'newsletter', 'course')`); got != 0 {
		t.Errorf("%d rows hold a kind outside the seven", got)
	}
	if got := harness.queryInt(`SELECT COUNT(*) FROM core_items
	    WHERE module = 'library' AND type NOT IN
	      ('article', 'book', 'paper', 'video', 'podcast', 'newsletter', 'course')`); got != 0 {
		t.Errorf("%d registry rows hold a kind outside the seven", got)
	}
}

// TestTheLocationMigrationRollsBack is the down step: the three-value column,
// the note's old column name and the three Portuguese kinds come back in both
// tables, the two locations the restored CHECK cannot hold are collapsed to a
// value it accepts, and the search index works for a row written after the
// rollback -- which is what a down step that forgot the triggers fails.
func TestTheLocationMigrationRollsBack(t *testing.T) {
	harness := newLibraryMigrationHarness(t)
	for _, row := range libraryPreLocationRows {
		harness.writePortugueseItem(row.id, row.kind, row.status, row.why)
	}
	harness.upTo(libraryLocationVersion)
	if err := harness.writeEnglishItem("row-up-next", "article", "up_next", "triage"); err != nil {
		t.Fatalf("inserting an up_next row: %v", err)
	}
	if err := harness.writeEnglishItem("row-stash", "book", "stash", "kept"); err != nil {
		t.Fatalf("inserting a stash row: %v", err)
	}

	harness.down()

	for _, row := range libraryPreLocationRows {
		if got := harness.queryString(`SELECT status FROM library_items WHERE id = ?`, row.id); got != row.status {
			t.Errorf("%s is on shelf %q, want %q", row.id, got, row.status)
		}
		if got := harness.queryString(`SELECT kind FROM library_items WHERE id = ?`, row.id); got != row.kind {
			t.Errorf("%s is a %q, want %q", row.id, got, row.kind)
		}
		if got := harness.queryString(`SELECT type FROM core_items WHERE id = ?`, row.id); got != row.kind {
			t.Errorf("the registry row of %s is a %q, want %q", row.id, got, row.kind)
		}
	}
	// Asserted on the stored value, which is also what proves the collapse
	// satisfies the restored CHECK: a value the CHECK refused would have
	// failed the migration rather than read back wrong.
	if got := harness.queryString(`SELECT status FROM library_items WHERE id = ?`, "row-up-next"); got != "inbox" {
		t.Errorf("the up_next row came back on %q, want inbox", got)
	}
	if got := harness.queryString(`SELECT status FROM library_items WHERE id = ?`, "row-stash"); got != "arquivo" {
		t.Errorf("the stash row came back on %q, want arquivo", got)
	}
	if got := harness.queryString(`SELECT kind FROM library_items WHERE id = ?`, "row-stash"); got != "livro" {
		t.Errorf("the stash row came back as a %q, want livro", got)
	}
	if got := harness.queryString(`SELECT why FROM library_items WHERE id = ?`, "row-inbox"); got != "zarabatana" {
		t.Errorf("the note came back as %q, want zarabatana", got)
	}

	// A row written after the rollback has to be indexed by the restored
	// triggers. A down step that only repopulated the index would still
	// answer for the rows that were already there, so the assertion is on a
	// new row and not on an old one.
	stamp := core.FormatTime(libraryFixedInstant)
	harness.exec(`INSERT INTO library_items
	          (id, kind, url, canonical_url, title, title_edited, why, status, unread,
	           saved_at, source, extract_status, extract_generation, meta, created_at, updated_at)
	        VALUES ('row-after-down', 'post', ?, ?, 'Depois do rollback', 0, 'esponjoso', 'inbox', 1,
	                ?, 'app', 'pending', 1, '{}', ?, ?)`,
		"https://example.org/after-down", "https://example.org/after-down", stamp, stamp, stamp)
	if got := harness.queryInt(
		`SELECT COUNT(*) FROM library_fts WHERE library_fts MATCH 'why:esponjoso'`); got != 1 {
		t.Errorf("a row written after the rollback is indexed %d times, want 1", got)
	}
}

// TestTheLocationMigrationPreservesTriageAcrossARollback is the whole reason
// the preservation table exists: up, triage into the two new locations, down,
// up again -- and the triage is still there. A down step that collapsed
// up_next and stash without writing them down would lose it, and the
// pre-cutover backup cannot give it back because it predates those writes.
func TestTheLocationMigrationPreservesTriageAcrossARollback(t *testing.T) {
	harness := newLibraryMigrationHarness(t)
	harness.writePortugueseItem("row-inbox", "post", "inbox", "zarabatana")
	harness.upTo(libraryLocationVersion)
	if err := harness.writeEnglishItem("row-up-next", "article", "up_next", "triage"); err != nil {
		t.Fatalf("inserting an up_next row: %v", err)
	}
	if err := harness.writeEnglishItem("row-stash", "article", "stash", "kept"); err != nil {
		t.Fatalf("inserting a stash row: %v", err)
	}

	harness.down()
	harness.upTo(libraryLocationVersion)

	for id, want := range map[string]string{"row-up-next": "up_next", "row-stash": "stash"} {
		if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, id); got != want {
			t.Errorf("after down and up again %s is in %q, want %q", id, got, want)
		}
	}
	if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, "row-inbox"); got != "inbox" {
		t.Errorf("after down and up again row-inbox is in %q, want inbox", got)
	}
	if got := harness.queryInt(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`,
		"library_location_preserved"); got != 0 {
		t.Errorf("library_location_preserved survived the up step (%d rows in sqlite_master)", got)
	}
}

// TestTheLibraryListReadsEveryLocation covers the service side of the five
// values: each one is a view of its own, all is every location, and an unknown
// view is refused rather than answered with everything.
func TestTheLibraryListReadsEveryLocation(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	placed := map[string]string{}
	for _, location := range []string{"inbox", "up_next", "later", "archive", "stash"} {
		outcome := librarySaveOne(t, service, "https://example.org/list-"+location, "")
		place := location
		if _, err := service.Patch(context.Background(), outcome.ID, PatchInput{Location: &place}); err != nil {
			t.Fatalf("placing an item in %s: %v", location, err)
		}
		placed[location] = outcome.ID
	}

	for _, location := range []string{"inbox", "up_next", "later", "archive", "stash"} {
		result, err := service.List(context.Background(), ListInput{View: location, Limit: 50})
		if err != nil {
			t.Fatalf("listing view=%s: %v", location, err)
		}
		if len(result.Items) != 1 || result.Items[0].ID != placed[location] {
			t.Errorf("view=%s listed %d items, want only the one placed there", location, len(result.Items))
		}
	}

	all, err := service.List(context.Background(), ListInput{View: "all", Limit: 50})
	if err != nil {
		t.Fatalf("listing view=all: %v", err)
	}
	if len(all.Items) != len(placed) {
		t.Errorf("view=all listed %d items, want %d", len(all.Items), len(placed))
	}

	if _, err := service.List(context.Background(), ListInput{View: "depois"}); err == nil {
		t.Error("view=depois was accepted, want an unknown view refused")
	}
}

// TestTheLibraryCountsAnswerEveryLocation is the counts endpoint's side of the
// same change: five locations and all, each counted on its own.
func TestTheLibraryCountsAnswerEveryLocation(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	for _, location := range []string{"up_next", "later", "archive", "stash"} {
		outcome := librarySaveOne(t, service, "https://example.org/count-"+location, "")
		place := location
		if _, err := service.Patch(context.Background(), outcome.ID, PatchInput{Location: &place}); err != nil {
			t.Fatalf("placing an item in %s: %v", location, err)
		}
	}
	librarySaveOne(t, service, "https://example.org/count-inbox", "")

	counts, err := service.Counts(context.Background(), "")
	if err != nil {
		t.Fatalf("counting the library: %v", err)
	}
	got := map[string]int{
		"inbox":   counts.Views.Inbox,
		"up_next": counts.Views.UpNext,
		"later":   counts.Views.Later,
		"archive": counts.Views.Archive,
		"stash":   counts.Views.Stash,
	}
	for location, count := range got {
		if count != 1 {
			t.Errorf("counts.views.%s = %d, want 1 (%v)", location, count, got)
		}
	}
	if counts.Views.All != 5 {
		t.Errorf("counts.views.all = %d, want 5", counts.Views.All)
	}
	if fmt.Sprint(counts.Kinds.Article) != "5" {
		t.Errorf("counts.kinds.article = %d, want 5", counts.Kinds.Article)
	}
}

// TestTheTagMigrationHoldsTheTagShapeOnExistingItems is the up step arriving
// over the migration before it: a database holding rows written at 00003 is
// carried through the location rename and then given the three tag tables,
// with every stored item intact. The shape each table pins is the shape the
// tagger and the endpoints read -- one unique normalized name, one row per
// item and tag closed to two origins, and the per-item removal record.
func TestTheTagMigrationHoldsTheTagShapeOnExistingItems(t *testing.T) {
	harness := newLibraryMigrationHarness(t)
	harness.writePortugueseItem("row-inbox", "post", "inbox", "zarabatana")
	harness.writePortugueseItem("row-depois", "livro", "depois", "para reler")

	harness.upTo(libraryTagVersion)

	if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, "row-inbox"); got != "inbox" {
		t.Fatalf("the pre-rename item landed in %q, want inbox", got)
	}
	if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, "row-depois"); got != "later" {
		t.Fatalf("the pre-rename item landed in %q, want later", got)
	}

	stamp := core.FormatTime(libraryFixedInstant)
	harness.exec(`INSERT INTO library_tags (name, created_at) VALUES ('llm', ?)`, stamp)
	harness.exec(`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
	              VALUES ('row-inbox', 'llm', 'auto', ?)`, stamp)

	// One row per item and tag: a UNIQUE index on the normalized name.
	if err := harness.execErr(`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
	           VALUES ('row-inbox', 'llm', 'manual', ?)`, stamp); err == nil {
		t.Error("a second row for one item and tag was accepted")
	}
	if err := harness.execErr(`INSERT INTO library_tags (name, created_at) VALUES ('llm', ?)`, stamp); err == nil {
		t.Error("a second vocabulary row for one normalized name was accepted")
	}
	if err := harness.execErr(`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
	           VALUES ('row-inbox', 'origin-check', 'llm', ?)`, stamp); err == nil {
		t.Error("an origin outside the two values was accepted")
	}
	// The tags point at items: a name the item table does not hold is refused.
	if err := harness.execErr(`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
	           VALUES ('row-gone', 'llm', 'auto', ?)`, stamp); err == nil {
		t.Error("an item tag for an item that does not exist was accepted")
	}

	harness.exec(`INSERT INTO library_item_removed_tags (item_id, tag_name, created_at)
	              VALUES ('row-depois', 'llm', ?)`, stamp)
	if err := harness.execErr(`INSERT INTO library_item_removed_tags (item_id, tag_name, created_at)
	           VALUES ('row-gone', 'llm', ?)`, stamp); err == nil {
		t.Error("a removal record for an item that does not exist was accepted")
	}

	// A third item exists only to be deleted: what the ON DELETE CASCADE
	// guarantees is that nothing is left pointing at it afterwards, so the
	// rows above -- which point at items that stay -- are the control.
	if err := harness.writeEnglishItem("row-cascade", "article", "archive", "kept"); err != nil {
		t.Fatalf("writing the cascade item: %v", err)
	}
	harness.exec(`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
	              VALUES ('row-cascade', 'llm', 'auto', ?)`, stamp)
	harness.exec(`INSERT INTO library_item_removed_tags (item_id, tag_name, created_at)
	              VALUES ('row-cascade', 'llm', ?)`, stamp)
	harness.exec(`DELETE FROM library_items WHERE id = 'row-cascade'`)
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_item_tags`); got != 1 {
		t.Errorf("%d item tag rows remain, want only the one on the item that stayed", got)
	}
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_item_removed_tags`); got != 1 {
		t.Errorf("%d removal records remain, want only the one on the item that stayed", got)
	}

	// The down step retires the three tables and touches nothing else.
	harness.down()
	for _, table := range []string{"library_tags", "library_item_tags", "library_item_removed_tags"} {
		if got := harness.queryInt(
			`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table); got != 0 {
			t.Errorf("%s survived the down step", table)
		}
	}
	if got := harness.queryString(`SELECT location FROM library_items WHERE id = 'row-inbox'`); got != "inbox" {
		t.Errorf("the item came back in %q after the down step, want inbox", got)
	}
}

// TestTheRouterMigrationKeepsTheTagsItArrivesOver is the up step over a
// database that already holds items and their tags: the rules table and the
// location_source column arrive, every stored location stands, and nothing
// cascades away.
//
// The tags are the point. library_item_tags and library_item_removed_tags
// reference library_items (id) ON DELETE CASCADE and the store runs with
// foreign keys on, so the create-copy-drop-rename 00004 used would empty both
// on the way past -- which is why this column arrives with ALTER TABLE, and
// why the proof is a tag written before the step and read after it.
func TestTheRouterMigrationKeepsTheTagsItArrivesOver(t *testing.T) {
	harness := newLibraryMigrationHarness(t)
	harness.writePortugueseItem("row-inbox", "post", "inbox", "zarabatana")
	harness.upTo(libraryTagVersion)
	if err := harness.writeEnglishItem("row-stash", "article", "stash", "kept"); err != nil {
		t.Fatalf("inserting a stash row: %v", err)
	}

	stamp := core.FormatTime(libraryFixedInstant)
	harness.exec(`INSERT INTO library_tags (name, created_at) VALUES ('llm', ?)`, stamp)
	harness.exec(`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
	              VALUES ('row-inbox', 'llm', 'auto', ?)`, stamp)
	harness.exec(`INSERT INTO library_item_removed_tags (item_id, tag_name, created_at)
	              VALUES ('row-stash', 'llm', ?)`, stamp)

	harness.upTo(libraryRouterVersion)

	if got := harness.queryInt(`SELECT COUNT(*) FROM library_item_tags`); got != 1 {
		t.Errorf("%d item tag rows survived the step, want 1", got)
	}
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_item_removed_tags`); got != 1 {
		t.Errorf("%d removal records survived the step, want 1", got)
	}
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_tags`); got != 1 {
		t.Errorf("%d vocabulary rows survived the step, want 1", got)
	}
	for id, want := range map[string]string{"row-inbox": "inbox", "row-stash": "stash"} {
		if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, id); got != want {
			t.Errorf("%s is in %q after the step, want %q", id, got, want)
		}
	}

	// Every row that predates the column reads as placed by nobody, which is
	// what makes the decider's guard true of an existing library: its items
	// are the ones the person has been triaging by hand, and the default is
	// the only value the router may act on.
	if got := harness.queryInt(
		`SELECT COUNT(*) FROM library_items WHERE location_source = 'default'`); got != 2 {
		t.Errorf("%d existing rows read as placed by default, want 2", got)
	}
	// The column is closed to the five values the router writes.
	if err := harness.execErr(
		`UPDATE library_items SET location_source = 'guess' WHERE id = 'row-inbox'`); err == nil {
		t.Error("a location_source outside the five values was accepted")
	}
	for _, source := range []string{"rule", "decider", "default", "user", "import"} {
		if err := harness.execErr(
			`UPDATE library_items SET location_source = ? WHERE id = 'row-inbox'`, source); err != nil {
			t.Errorf("the location_source %q was refused: %v", source, err)
		}
	}

	// The rules table: one answer per domain, and only the two locations the
	// router chooses between.
	harness.exec(`INSERT INTO library_domain_rules (domain, location, created_at)
	              VALUES ('pinterest.com', 'stash', ?)`, stamp)
	if err := harness.execErr(`INSERT INTO library_domain_rules (domain, location, created_at)
	           VALUES ('pinterest.com', 'inbox', ?)`, stamp); err == nil {
		t.Error("a second rule for one domain was accepted")
	}
	if err := harness.execErr(`INSERT INTO library_domain_rules (domain, location, created_at)
	           VALUES ('example.org', 'up_next', ?)`, stamp); err == nil {
		t.Error("a rule naming a location the router cannot choose was accepted")
	}

	// The down step retires both and moves nothing: an item stashed by a rule
	// stays stashed, because where it sits is the person's library and only
	// the record of who put it there belongs to this migration.
	harness.down()
	if got := harness.queryInt(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'library_domain_rules'`); got != 0 {
		t.Error("library_domain_rules survived the down step")
	}
	if got := harness.queryInt(
		`SELECT COUNT(*) FROM pragma_table_info('library_items') WHERE name = 'location_source'`); got != 0 {
		t.Error("location_source survived the down step")
	}
	for id, want := range map[string]string{"row-inbox": "inbox", "row-stash": "stash"} {
		if got := harness.queryString(`SELECT location FROM library_items WHERE id = ?`, id); got != want {
			t.Errorf("%s is in %q after the down step, want %q", id, got, want)
		}
	}
	if got := harness.queryInt(`SELECT COUNT(*) FROM library_item_tags`); got != 1 {
		t.Errorf("%d item tag rows survived the down step, want 1", got)
	}
}
