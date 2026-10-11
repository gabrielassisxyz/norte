package library

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/library/migrations"
)

// librarySearchFixture is one saved item the search tests put in place: a
// title, an author, the person's note and the article's text, extracted.
type librarySearchFixture struct {
	id     string
	title  string
	author string
	reason string
	text   string
	// headings is the JSON the extraction job writes into
	// library_items.content_headings, verbatim: the index must hold the
	// titles in it and nothing else from it.
	headings string
}

// seedLibrarySearchFixtures writes the fixtures with ids the test controls,
// so an assertion about the order of two equally ranked hits is about the
// ranking rather than about which uuid came out of the generator.
func seedLibrarySearchFixtures(t *testing.T, database *core.Database, fixtures []librarySearchFixture) {
	t.Helper()
	stamp := core.FormatTime(libraryFixedInstant)
	for _, fixture := range fixtures {
		if _, err := database.Writer().Exec(
			`INSERT INTO library_items
			   (id, kind, url, canonical_url, title, title_edited, author, site, reason, location,
			    unread, saved_at, source, content_text, content_headings, extract_status,
			    extract_generation, extracted_at, meta, created_at, updated_at)
			 VALUES (?, 'article', ?, ?, ?, 0, ?, 'example.test', ?, 'inbox', 1, ?, 'cli', ?, ?,
			         'done', 1, ?, '{}', ?, ?)`,
			fixture.id, "https://example.test/"+fixture.id, "https://example.test/"+fixture.id,
			fixture.title, sql.NullString{String: fixture.author, Valid: fixture.author != ""},
			sql.NullString{String: fixture.reason, Valid: fixture.reason != ""}, stamp,
			sql.NullString{String: fixture.text, Valid: fixture.text != ""},
			sql.NullString{String: fixture.headings, Valid: fixture.headings != ""},
			stamp, stamp, stamp); err != nil {
			t.Fatalf("seeding %q: %v", fixture.id, err)
		}
	}
}

// seedLibraryPreLocationFixtures is seedLibrarySearchFixtures against the
// schema as it stood before the location rename: the note in `why` and the
// shelf in `status`. The heading-migration test seeds a database stopped at an
// earlier version, which is the one place the old column names are still the
// only ones that exist.
func seedLibraryPreLocationFixtures(t *testing.T, database *core.Database, fixtures []librarySearchFixture) {
	t.Helper()
	stamp := core.FormatTime(libraryFixedInstant)
	for _, fixture := range fixtures {
		if _, err := database.Writer().Exec(
			`INSERT INTO library_items
			   (id, kind, url, canonical_url, title, title_edited, author, site, why, status,
			    unread, saved_at, source, content_text, content_headings, extract_status,
			    extract_generation, extracted_at, meta, created_at, updated_at)
			 VALUES (?, 'post', ?, ?, ?, 0, ?, 'example.test', ?, 'inbox', 1, ?, 'cli', ?, ?,
			         'done', 1, ?, '{}', ?, ?)`,
			fixture.id, "https://example.test/"+fixture.id, "https://example.test/"+fixture.id,
			fixture.title, sql.NullString{String: fixture.author, Valid: fixture.author != ""},
			sql.NullString{String: fixture.reason, Valid: fixture.reason != ""}, stamp,
			sql.NullString{String: fixture.text, Valid: fixture.text != ""},
			sql.NullString{String: fixture.headings, Valid: fixture.headings != ""},
			stamp, stamp, stamp); err != nil {
			t.Fatalf("seeding %q at the pre-location schema: %v", fixture.id, err)
		}
	}
}

func newLibrarySearchDatabase(t *testing.T, fixtures []librarySearchFixture) *core.Database {
	t.Helper()
	database, _ := newLibraryTestDB(t, clocktest.New(libraryFixedInstant))
	seedLibrarySearchFixtures(t, database, fixtures)
	return database
}

func librarySearchIDs(entries []core.SearchEntry) []string {
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

// TestAWordFromAnArticlesTextFindsTheItem is the criterion the palette rests
// on: the person remembers a phrase from the middle of something they saved,
// not its title.
func TestAWordFromAnArticlesTextFindsTheItem(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-a", title: "Sobre hábitos", author: "Uma autora",
			text: "O texto fala de consolidação e de repetição espaçada."},
		{id: "item-b", title: "Outra coisa", text: "Nada a ver com o assunto."},
	})

	entries, err := librarySearchEntries(context.Background(), database, "espaçada", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if got := librarySearchIDs(entries); len(got) != 1 || got[0] != "item-a" {
		t.Fatalf("the word matched %v, want only item-a", got)
	}
	entry := entries[0]
	if entry.Path != "/library/item-a" {
		t.Fatalf("the path is %q, want /library/item-a", entry.Path)
	}
	if entry.Module != ModuleName || entry.Type != "article" {
		t.Fatalf("the hit came back as %s/%s, want %s/post", entry.Module, entry.Type, ModuleName)
	}
	if entry.Title != "Sobre hábitos" || entry.Subtitle != "Uma autora" {
		t.Fatalf("the hit renders as %q / %q, want the title and the author",
			entry.Title, entry.Subtitle)
	}
}

// TestTheSiteStandsInForAMissingAuthor keeps the second line of a row from
// being blank for an article nobody signed.
func TestTheSiteStandsInForAMissingAuthor(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-a", title: "Anónimo", text: "uma palavra rara: zarabatana"},
	})

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 1 || entries[0].Subtitle != "example.test" {
		t.Fatalf("the subtitle is %v, want the site", entries)
	}
}

// TestTheBestRankedHitScoresOneAndTheWorstZero is the raw-to-score mapping
// with the raw values pinned by the fixtures: the title weighs ten and the
// article text one, so a word in the title must rank above the same word in
// the body and the mapping must put the two at the ends of the scale.
func TestTheBestRankedHitScoresOneAndTheWorstZero(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-title", title: "Zarabatana", text: "nada de especial aqui"},
		{id: "item-why", title: "Sem relação", reason: "zarabatana",
			text: "nada de especial aqui"},
		{id: "item-body", title: "Sem relação", text: "menciona zarabatana uma vez"},
	})

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	want := []string{"item-title", "item-why", "item-body"}
	if got := librarySearchIDs(entries); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("the hits came back as %v, want %v", got, want)
	}
	if entries[0].Score != 1 {
		t.Fatalf("the best hit scored %v, want 1", entries[0].Score)
	}
	if entries[len(entries)-1].Score != 0 {
		t.Fatalf("the worst hit scored %v, want 0", entries[len(entries)-1].Score)
	}
	middle := entries[1].Score
	if middle <= 0 || middle >= 1 {
		t.Fatalf("the middle hit scored %v, want it strictly between 0 and 1", middle)
	}
}

// TestASingleLibraryHitScoresOne is the case a raw bm25 value sent straight
// through would get wrong twice: the number is negative, and with one hit
// there is no spread to map it over.
func TestASingleLibraryHitScoresOne(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-a", title: "Zarabatana", text: "uma coisa"},
		{id: "item-b", title: "Outra", text: "outra coisa"},
	})

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("the query matched %d items, want 1", len(entries))
	}
	if entries[0].Score != 1 {
		t.Fatalf("the only hit scored %v, want 1", entries[0].Score)
	}
}

// TestLibraryHitsThatRankEquallyAllScoreOne is the all-equal case: three
// items carrying the word in exactly the same column of exactly the same
// length rank identically, and none of them may be pushed to 0.
func TestLibraryHitsThatRankEquallyAllScoreOne(t *testing.T) {
	fixtures := []librarySearchFixture{}
	for i := 0; i < 3; i++ {
		fixtures = append(fixtures, librarySearchFixture{
			id:    fmt.Sprintf("item-%d", i),
			title: "Zarabatana",
			text:  "exatamente o mesmo texto em todos",
		})
	}
	database := newLibrarySearchDatabase(t, fixtures)

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("the query matched %d items, want 3", len(entries))
	}
	for _, entry := range entries {
		if entry.Score != 1 {
			t.Fatalf("%s scored %v, want 1 (all of %v)", entry.ID, entry.Score, entries)
		}
	}
}

// TestEveryWordOfTheQueryMustMatch is the AND the list endpoint already uses,
// asserted here because the provider builds its own statement: an OR would
// answer every item carrying either word, which for two common words is the
// whole library.
func TestEveryWordOfTheQueryMustMatch(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-both", title: "Ambos", text: "zarabatana e tamborim"},
		{id: "item-one", title: "Um só", text: "apenas zarabatana"},
	})

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana tamborim", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if got := librarySearchIDs(entries); len(got) != 1 || got[0] != "item-both" {
		t.Fatalf("the two words matched %v, want only item-both", got)
	}
}

// TestTheProviderNeverAnswersMoreThanItsLimit is the per-provider cap seen
// from inside the provider, which is where the LIMIT has to be: a provider
// that read everything and let the caller truncate would scan the whole
// index on every keystroke.
func TestTheProviderNeverAnswersMoreThanItsLimit(t *testing.T) {
	fixtures := []librarySearchFixture{}
	for i := 0; i < 15; i++ {
		fixtures = append(fixtures, librarySearchFixture{
			id:    fmt.Sprintf("item-%02d", i),
			title: fmt.Sprintf("Zarabatana %02d", i),
			text:  "um texto qualquer",
		})
	}
	database := newLibrarySearchDatabase(t, fixtures)

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 10 {
		t.Fatalf("the provider answered %d hits for a limit of 10", len(entries))
	}
}

// TestAQueryWithNoSearchableWordMatchesNothing is the one case the provider
// must not turn into an error: the list endpoint refuses such a query because
// there the query is the whole request, while here one module refusing would
// turn every other module's hits into a failed search.
func TestAQueryWithNoSearchableWordMatchesNothing(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-a", title: "Qualquer", text: "um texto"},
	})

	entries, err := librarySearchEntries(context.Background(), database, "-- ...", 10)
	if err != nil {
		t.Fatalf("punctuation failed the provider: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("punctuation matched %v, want nothing", librarySearchIDs(entries))
	}
}

// TestEveryLibraryScoreIsInTheContractsRange is the invariant the merge
// enforces and refuses: a provider answering 1.0000000002 would fail the
// whole search, so the mapping has to land inside the range itself.
func TestEveryLibraryScoreIsInTheContractsRange(t *testing.T) {
	fixtures := []librarySearchFixture{}
	for i := 0; i < 12; i++ {
		fixtures = append(fixtures, librarySearchFixture{
			id:    fmt.Sprintf("item-%02d", i),
			title: strings.Repeat("zarabatana ", i+1),
			text:  strings.Repeat("palavra ", 50-i) + "zarabatana",
		})
	}
	database := newLibrarySearchDatabase(t, fixtures)

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("the fixtures matched nothing")
	}
	for _, entry := range entries {
		if !core.ValidSearchScore(entry.Score) {
			t.Fatalf("%s scored %v, outside [0, 1]", entry.ID, entry.Score)
		}
	}
}

// libraryHeadingFixtureJSON is the shape the extraction job writes: one
// object per heading, with the keys level, text and anchor. The anchors carry
// a fragment ("xjjzglossario") that appears in no heading title, so a test
// can tell "the anchor was indexed" apart from "the title was indexed".
const libraryHeadingFixtureJSON = `[{"level":1,"text":"Repetição espaçada","anchor":"xjjzglossario"},` +
	`{"level":2,"text":"Curva do esquecimento","anchor":"xjjzcurva"}`

// libraryHeadingSearchFixture is the item every heading test searches over:
// a title, a note and an article text that between them contain none of the
// words the JSON keys and the anchors would contribute.
func libraryHeadingSearchFixture() librarySearchFixture {
	return librarySearchFixture{
		id:       "item-headings",
		title:    "Sobre memória",
		reason:   "para reler em janeiro",
		text:     "Um parágrafo qualquer sobre memória e sobre hábitos.",
		headings: libraryHeadingFixtureJSON + `]`,
	}
}

// TestAHeadingsStorageFormatIsNotSearchable is the defect itself: the index
// held the JSON of content_headings, so "anchor", "level" and "text" -- the
// object keys -- and every slug fragment of every anchor matched any item
// that had a heading at all.
func TestAHeadingsStorageFormatIsNotSearchable(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{libraryHeadingSearchFixture()})

	for _, query := range []string{"anchor", "level", "text", "xjjzglossario", "xjjzcurva"} {
		entries, err := librarySearchEntries(context.Background(), database, query, 10)
		if err != nil {
			t.Fatalf("searching %q: %v", query, err)
		}
		if got := librarySearchIDs(entries); len(got) != 0 {
			t.Errorf("%q matched %v; it appears in no title, note or text", query, got)
		}
	}
}

// TestAWordOnlyInAHeadingStillFindsTheItem is the other half of the fix: the
// headings column still has to be searchable, otherwise the cheapest way to
// stop indexing the JSON would be to stop indexing the headings at all.
func TestAWordOnlyInAHeadingStillFindsTheItem(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		libraryHeadingSearchFixture(),
		{id: "item-plain", title: "Outra coisa", text: "Nada a ver com o assunto."},
	})

	for _, query := range []string{"espaçada", "esquecimento"} {
		entries, err := librarySearchEntries(context.Background(), database, query, 10)
		if err != nil {
			t.Fatalf("searching %q: %v", query, err)
		}
		got := librarySearchIDs(entries)
		if len(got) != 1 || got[0] != "item-headings" {
			t.Errorf("%q matched %v, want only item-headings", query, got)
		}
	}
}

// TestHeadingsThatAreNotJSONLeaveTheItemSavable guards the trigger's own
// failure mode: json_each raises on input it cannot parse, and a raising
// trigger would make an INSERT into library_items fail outright. NULL and
// garbage both have to index as nothing.
func TestHeadingsThatAreNotJSONLeaveTheItemSavable(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-null", title: "Sem cabeçalhos", text: "zarabatana"},
		{id: "item-garbage", title: "Cabeçalhos quebrados", text: "zarabatana",
			headings: libraryHeadingFixtureJSON},
	})

	entries, err := librarySearchEntries(context.Background(), database, "zarabatana", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if got := librarySearchIDs(entries); len(got) != 2 {
		t.Fatalf("the word matched %v, want both items", got)
	}
	for _, query := range []string{"anchor", "xjjzglossario"} {
		entries, err := librarySearchEntries(context.Background(), database, query, 10)
		if err != nil {
			t.Fatalf("searching %q: %v", query, err)
		}
		if got := librarySearchIDs(entries); len(got) != 0 {
			t.Errorf("%q matched %v, want nothing from unparseable headings", query, got)
		}
	}
}

// TestAnUpdatedItemReindexesItsHeadingTitles covers the update trigger,
// which carries the same expression as the insert one and would otherwise be
// proved by nothing: an extraction that reruns writes the headings through an
// UPDATE, never an INSERT.
func TestAnUpdatedItemReindexesItsHeadingTitles(t *testing.T) {
	database := newLibrarySearchDatabase(t, []librarySearchFixture{
		{id: "item-headings", title: "Sobre memória", text: "Um parágrafo qualquer."},
	})
	if _, err := database.Writer().Exec(
		`UPDATE library_items SET content_headings = ? WHERE id = 'item-headings'`,
		libraryHeadingFixtureJSON+`]`); err != nil {
		t.Fatalf("writing the headings: %v", err)
	}

	entries, err := librarySearchEntries(context.Background(), database, "esquecimento", 10)
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if got := librarySearchIDs(entries); len(got) != 1 || got[0] != "item-headings" {
		t.Fatalf("the heading word matched %v, want only item-headings", got)
	}
	for _, query := range []string{"anchor", "level", "xjjzglossario"} {
		entries, err := librarySearchEntries(context.Background(), database, query, 10)
		if err != nil {
			t.Fatalf("searching %q: %v", query, err)
		}
		if got := librarySearchIDs(entries); len(got) != 0 {
			t.Errorf("%q matched %v after an update, want nothing", query, got)
		}
	}
}

// libraryHeadingMigrationProvider builds a goose provider over the library's
// own migrations, which is what lets a test stop at a version instead of
// going all the way up the way newLibraryTestDB does.
func libraryHeadingMigrationProvider(t *testing.T, writer *sql.DB) *goose.Provider {
	t.Helper()
	provider, err := goose.NewProvider(goose.DialectSQLite3, writer, migrations.FS,
		goose.WithTableName("goose_"+ModuleName),
		goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatalf("preparing the library migrations: %v", err)
	}
	return provider
}

// libraryHeadingIndexedValue reads what the FTS table holds for one item in
// the headings column. A standard FTS5 table stores the column, so it can be
// selected back and compared, which is stronger than asking MATCH whether a
// word is absent.
func libraryHeadingIndexedValue(t *testing.T, database *core.Database, id string) string {
	t.Helper()
	var indexed sql.NullString
	if err := database.Reader().QueryRow(
		`SELECT content_headings FROM library_fts WHERE id = ?`, id).Scan(&indexed); err != nil {
		t.Fatalf("reading the indexed headings of %s: %v", id, err)
	}
	return indexed.String
}

// TestTheMigrationCorrectsItemsSavedBeforeIt is the upgrade path: a database
// at the previous version already has rows whose indexed headings are the
// JSON, and the Go code never rewrites them, so the only thing that can fix
// them is the migration's own rebuild.
func TestTheMigrationCorrectsItemsSavedBeforeIt(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(ctx, dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(ctx); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})
	if _, err := core.MigrateCore(ctx, database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}

	provider := libraryHeadingMigrationProvider(t, database.Writer())
	if _, err := provider.UpTo(ctx, 2); err != nil {
		t.Fatalf("migrating the library to version 2: %v", err)
	}
	seedLibraryPreLocationFixtures(t, database, []librarySearchFixture{libraryHeadingSearchFixture()})

	// The defect, asserted rather than assumed: at version 2 the JSON is
	// what got indexed, so this test fails loudly if the previous version
	// ever stops being the version this migration has to repair.
	if before := libraryHeadingIndexedValue(t, database, "item-headings"); !strings.Contains(before, "anchor") {
		t.Fatalf("at version 2 the indexed headings are %q, want the raw JSON containing \"anchor\"", before)
	}

	// Up to 3 and no further: this test is about what migration 3 repairs,
	// and the migrations after it rewrite the same table for other reasons.
	ran, err := provider.UpTo(ctx, 3)
	if err != nil {
		t.Fatalf("migrating the library up: %v", err)
	}
	if len(ran) != 1 {
		t.Fatalf("%d migrations ran from version 2 to 3, want 1", len(ran))
	}

	const want = "Repetição espaçada Curva do esquecimento"
	if got := libraryHeadingIndexedValue(t, database, "item-headings"); got != want {
		t.Fatalf("after the migration the indexed headings are %q, want %q", got, want)
	}
	var matches int
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM library_fts WHERE library_fts MATCH 'anchor'`).Scan(&matches); err != nil {
		t.Fatalf("matching anchor: %v", err)
	}
	if matches != 0 {
		t.Errorf("anchor still matches %d rows after the migration, want 0", matches)
	}

	// `norte migrate` on a database already at this version reports nothing
	// to do, which here is the provider running no migration at all -- and
	// incidentally proves the rebuild is not re-run on every start.
	again, err := provider.UpTo(ctx, 3)
	if err != nil {
		t.Fatalf("migrating an already-current database: %v", err)
	}
	if len(again) != 0 {
		t.Errorf("%d migrations ran on an already-current database, want 0", len(again))
	}
}

// TestTheMigrationsDownStepRestoresTheOldIndex is the recovery path: down
// puts the previous triggers back and rebuilds, so the index returns to the
// content it had before, JSON and all.
func TestTheMigrationsDownStepRestoresTheOldIndex(t *testing.T) {
	ctx := context.Background()
	database, _ := newLibraryTestDB(t, clocktest.New(libraryFixedInstant))
	seedLibrarySearchFixtures(t, database, []librarySearchFixture{libraryHeadingSearchFixture()})

	// Two steps back, because the version this test is about is no longer the
	// last one: the location rename sits above it and rebuilds the same table,
	// so rolling back one version would assert nothing about migration 3.
	provider := libraryHeadingMigrationProvider(t, database.Writer())
	if _, err := provider.DownTo(ctx, 2); err != nil {
		t.Fatalf("rolling the library back to version 2: %v", err)
	}

	indexed := libraryHeadingIndexedValue(t, database, "item-headings")
	if indexed != libraryHeadingFixtureJSON+`]` {
		t.Fatalf("after down the indexed headings are %q, want the raw JSON back", indexed)
	}
}
