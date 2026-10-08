package library

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

// librarySearchFixture is one saved item the search tests put in place: a
// title, an author, the person's note and the article's text, extracted.
type librarySearchFixture struct {
	id     string
	title  string
	author string
	why    string
	text   string
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
			   (id, kind, url, canonical_url, title, title_edited, author, site, why, status,
			    unread, saved_at, source, content_text, extract_status, extract_generation,
			    extracted_at, meta, created_at, updated_at)
			 VALUES (?, 'post', ?, ?, ?, 0, ?, 'example.test', ?, 'inbox', 1, ?, 'cli', ?,
			         'done', 1, ?, '{}', ?, ?)`,
			fixture.id, "https://example.test/"+fixture.id, "https://example.test/"+fixture.id,
			fixture.title, sql.NullString{String: fixture.author, Valid: fixture.author != ""},
			sql.NullString{String: fixture.why, Valid: fixture.why != ""}, stamp,
			sql.NullString{String: fixture.text, Valid: fixture.text != ""},
			stamp, stamp, stamp); err != nil {
			t.Fatalf("seeding %q: %v", fixture.id, err)
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
	if entry.Path != "/biblioteca/item-a" {
		t.Fatalf("the path is %q, want /biblioteca/item-a", entry.Path)
	}
	if entry.Module != ModuleName || entry.Type != "post" {
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
		{id: "item-why", title: "Sem relação", why: "zarabatana",
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
