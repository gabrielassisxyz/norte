package core_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

// searchProviderFake is one module's search answer, fixed by the test. It
// records the limit it was asked for, because the per-provider cap is a
// promise the endpoint makes to its caller and the only way to see it being
// made is to watch what the providers are told.
type searchProviderFake struct {
	entries    []core.SearchEntry
	err        error
	askedLimit int
	askedQuery string
}

func (f *searchProviderFake) SearchEntries(_ context.Context, q string, limit int) ([]core.SearchEntry, error) {
	f.askedQuery = q
	f.askedLimit = limit
	if f.err != nil {
		return nil, f.err
	}
	return f.entries, nil
}

func searchEntry(module, id, title string, score float64) core.SearchEntry {
	return core.SearchEntry{
		ID:     id,
		Module: module,
		Type:   "thing",
		Title:  title,
		Path:   "/" + module + "/" + id,
		Score:  score,
	}
}

func newSearchAPI(t *testing.T, providers ...core.SearchProvider) (*core.SearchAPI, *core.Subjects) {
	t.Helper()
	database := newMigratedCoreDatabase(t)
	subjects := core.NewSubjects(database, clocktest.New(fixedInstant))
	return core.NewSearchAPI(subjects, providers), subjects
}

func searchTitles(entries []core.SearchEntry) []string {
	titles := make([]string, 0, len(entries))
	for _, entry := range entries {
		titles = append(titles, entry.Title)
	}
	return titles
}

// TestTheMergeOrdersByScoreThenTitleThenID is the documented order, with both
// tie levels exercised: two entries on the same score are separated by their
// title, and two on the same score and title by their id.
func TestTheMergeOrdersByScoreThenTitleThenID(t *testing.T) {
	first := &searchProviderFake{entries: []core.SearchEntry{
		searchEntry("library", "b-id", "same title", 0.5),
		searchEntry("library", "weak", "weakest", 0.1),
	}}
	second := &searchProviderFake{entries: []core.SearchEntry{
		searchEntry("notes", "a-id", "same title", 0.5),
		searchEntry("notes", "best", "the best one", 0.9),
		searchEntry("notes", "mid", "alphabetically first", 0.5),
	}}
	api, _ := newSearchAPI(t, first, second)

	entries, err := api.Search(context.Background(), "whatever")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	want := []string{"the best one", "alphabetically first", "same title", "same title", "weakest"}
	if got := searchTitles(entries); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("the order is %v, want %v", got, want)
	}
	// The two "same title" entries are only separable by id, and a-id sorts
	// before b-id whichever provider answered first.
	if entries[2].ID != "a-id" || entries[3].ID != "b-id" {
		t.Fatalf("the title tie broke to %s then %s, want a-id then b-id",
			entries[2].ID, entries[3].ID)
	}
}

// TestTheMergeDoesNotDependOnTheRegistrationOrder is the claim the endpoint
// makes that a sort alone does not prove: a merge that appended and then
// deduplicated by first-seen would answer differently for the same two
// providers registered the other way round.
func TestTheMergeDoesNotDependOnTheRegistrationOrder(t *testing.T) {
	entriesOf := func(order string) []core.SearchEntry {
		t.Helper()
		library := &searchProviderFake{entries: []core.SearchEntry{
			// The same registry id as the notes hit below, scored lower:
			// whichever provider answers first, the better copy must win.
			searchEntry("library", "shared", "shared thing", 0.3),
			searchEntry("library", "tied", "tied title", 0.5),
		}}
		notes := &searchProviderFake{entries: []core.SearchEntry{
			searchEntry("notes", "shared", "shared thing", 0.95),
			searchEntry("notes", "also-tied", "tied title", 0.5),
		}}
		providers := []core.SearchProvider{library, notes}
		if order == "reversed" {
			providers = []core.SearchProvider{notes, library}
		}
		api, _ := newSearchAPI(t, providers...)
		entries, err := api.Search(context.Background(), "whatever")
		if err != nil {
			t.Fatalf("searching with the %s order: %v", order, err)
		}
		return entries
	}

	forward, reversed := entriesOf("forward"), entriesOf("reversed")
	if len(forward) != len(reversed) {
		t.Fatalf("the two orders answered %d and %d entries", len(forward), len(reversed))
	}
	for i := range forward {
		if forward[i].ID != reversed[i].ID || forward[i].Score != reversed[i].Score {
			t.Fatalf("entry %d is %s@%v forward and %s@%v reversed",
				i, forward[i].ID, forward[i].Score, reversed[i].ID, reversed[i].Score)
		}
	}
	if forward[0].ID != "shared" || forward[0].Score != 0.95 {
		t.Fatalf("the repeated id came back as %s@%v, want shared@0.95",
			forward[0].ID, forward[0].Score)
	}
	if forward[0].Module != "notes" {
		t.Fatalf("the kept copy of the repeated id is the %s one, want notes", forward[0].Module)
	}
}

// TestEachProviderIsCappedAtTenAndTheTotalAtThirty is the pair of caps the
// contract promises. Four providers each answering thirty is both: none of
// them may contribute more than ten, and the merge may not return more than
// thirty of the forty that survive.
//
// The numbers are written out rather than read from the constants. Comparing
// the answer against SearchTotalLimit asserts that the code agrees with
// itself, which it does whatever either value is changed to; these two are
// the contract's own numbers, and changing one has to be a decision that
// breaks a test rather than a constant edit that breaks nothing.
func TestEachProviderIsCappedAtTenAndTheTotalAtThirty(t *testing.T) {
	providers := []core.SearchProvider{}
	fakes := []*searchProviderFake{}
	for p := 0; p < 4; p++ {
		fake := &searchProviderFake{}
		for i := 0; i < 30; i++ {
			fake.entries = append(fake.entries, searchEntry(
				fmt.Sprintf("module%d", p), fmt.Sprintf("m%d-i%02d", p, i),
				fmt.Sprintf("hit %d %02d", p, i), 1-float64(i)/100))
		}
		fakes = append(fakes, fake)
		providers = append(providers, fake)
	}
	api, _ := newSearchAPI(t, providers...)

	entries, err := api.Search(context.Background(), "whatever")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 30 {
		t.Fatalf("the merge answered %d entries, want the cap of 30", len(entries))
	}
	for _, fake := range fakes {
		if fake.askedLimit != 10 {
			t.Fatalf("a provider was asked for %d hits, want 10", fake.askedLimit)
		}
	}
	// Ten per provider is enforced on the answer too, not only asked for: a
	// provider that ignored its limit must not spend another module's share.
	perModule := map[string]int{}
	for _, entry := range entries {
		perModule[entry.Module]++
	}
	for module, count := range perModule {
		if count > 10 {
			t.Fatalf("module %s contributed %d entries, want at most 10", module, count)
		}
	}
}

// TestAProviderThatIgnoresItsLimitStillContributesExactlyTen gives one
// provider thirty hits that outscore every other module's. With the total cap
// alone that provider would fill the whole answer; only the per-provider cut
// keeps it to ten. The fakes in the test above share one score ladder, so no
// module there ever exceeds its share and the cut cannot be seen failing.
func TestAProviderThatIgnoresItsLimitStillContributesExactlyTen(t *testing.T) {
	loud := &searchProviderFake{}
	for i := 0; i < 30; i++ {
		loud.entries = append(loud.entries, searchEntry("loud",
			fmt.Sprintf("loud-%02d", i), fmt.Sprintf("loud %02d", i), 0.9-float64(i)/1000))
	}
	providers := []core.SearchProvider{loud}
	for p := 0; p < 3; p++ {
		quiet := &searchProviderFake{}
		for i := 0; i < 10; i++ {
			quiet.entries = append(quiet.entries, searchEntry(fmt.Sprintf("quiet%d", p),
				fmt.Sprintf("q%d-%02d", p, i), fmt.Sprintf("quiet %d %02d", p, i),
				0.5-float64(i)/1000))
		}
		providers = append(providers, quiet)
	}
	api, _ := newSearchAPI(t, providers...)

	entries, err := api.Search(context.Background(), "whatever")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 30 {
		t.Fatalf("the merge answered %d entries, want 30", len(entries))
	}
	loudCount := 0
	for _, entry := range entries {
		if entry.Module == "loud" {
			loudCount++
		}
	}
	if loudCount != 10 {
		t.Fatalf("the loud provider contributed %d entries, want exactly 10", loudCount)
	}
}

// TestAQueryOverTwoHundredCharactersIsRefused pins the contract's maxLength
// by its edge: 200 characters is searched, 201 is a 400 on q. Accented runes
// are used so a byte count instead of a character count fails too.
func TestAQueryOverTwoHundredCharactersIsRefused(t *testing.T) {
	api, _ := newSearchAPI(t, &searchProviderFake{})

	if _, err := api.Search(context.Background(), strings.Repeat("é", 200)); err != nil {
		t.Fatalf("a 200-character query was refused: %v", err)
	}
	_, err := api.Search(context.Background(), strings.Repeat("é", 201))
	var refusal *core.APIError
	if !errors.As(err, &refusal) || refusal.Status != http.StatusBadRequest || refusal.Field != "q" {
		t.Fatalf("a 201-character query gave %v, want a 400 on q", err)
	}
}

// TestASubjectIsFoundByNameAndRankedAboveAPartialMatch pins the subject
// scale: the name that was typed outranks a name that merely starts with it,
// which outranks a name that merely contains it.
func TestASubjectIsFoundByNameAndRankedAboveAPartialMatch(t *testing.T) {
	api, subjects := newSearchAPI(t)
	for _, name := range []string{"Memória", "Memória de trabalho", "Teoria da memória"} {
		if _, err := subjects.Create(context.Background(), name, false); err != nil {
			t.Fatalf("creating the subject %q: %v", name, err)
		}
	}

	entries, err := api.Search(context.Background(), "memoria")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	want := []string{"Memória", "Memória de trabalho", "Teoria da memória"}
	if got := searchTitles(entries); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("the subjects came back as %v, want %v", got, want)
	}
	wantScores := []float64{1, 0.8, 0.6}
	for i, entry := range entries {
		if entry.Score != wantScores[i] {
			t.Fatalf("%q scored %v, want %v", entry.Title, entry.Score, wantScores[i])
		}
		if entry.Module != "core" || entry.Type != "subject" {
			t.Fatalf("%q came back as %s/%s, want core/subject", entry.Title, entry.Module, entry.Type)
		}
	}
	if entries[0].Path != "/assuntos/memoria" {
		t.Fatalf("the subject path is %q, want /assuntos/memoria", entries[0].Path)
	}
}

// TestSubjectsAreCappedLikeAProvider stops the core's own rows from filling
// an answer every module also has a share of.
func TestSubjectsAreCappedLikeAProvider(t *testing.T) {
	api, subjects := newSearchAPI(t)
	for i := 0; i < 15; i++ {
		name := fmt.Sprintf("Memoria %02d", i)
		if _, err := subjects.Create(context.Background(), name, false); err != nil {
			t.Fatalf("creating %q: %v", name, err)
		}
	}

	entries, err := api.Search(context.Background(), "memoria")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}
	if len(entries) != 10 {
		t.Fatalf("the subjects contributed %d entries, want at most 10", len(entries))
	}
}

// TestAQueryWithNoSearchableWordIsRefused keeps the endpoint from answering
// everything to a query that is only punctuation, which is what an empty
// needle means to the subject list's own filter.
func TestAQueryWithNoSearchableWordIsRefused(t *testing.T) {
	api, subjects := newSearchAPI(t)
	if _, err := subjects.Create(context.Background(), "Memória", false); err != nil {
		t.Fatalf("creating the subject: %v", err)
	}

	if _, err := api.Search(context.Background(), "   "); err == nil {
		t.Fatal("a blank query was answered, want a refusal")
	}
	entries, err := api.Search(context.Background(), "...")
	if err != nil {
		t.Fatalf("searching for punctuation: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("punctuation matched %d entries, want none", len(entries))
	}
}

// TestAFailingProviderFailsTheWholeSearch is the deliberate choice: a palette
// that dropped one module's hits would read as "that word is nowhere".
func TestAFailingProviderFailsTheWholeSearch(t *testing.T) {
	working := &searchProviderFake{entries: []core.SearchEntry{
		searchEntry("library", "fine", "a real hit", 1),
	}}
	broken := &searchProviderFake{err: fmt.Errorf("the index is gone")}
	api, _ := newSearchAPI(t, working, broken)

	if _, err := api.Search(context.Background(), "whatever"); err == nil {
		t.Fatal("the search succeeded with a broken provider, want the failure")
	}
}

// TestAProviderScoringOutsideTheRangeFailsTheSearch is the contract's range
// being enforced where it can still be seen: a score of 7 serialised into the
// response would make every other module's hit unreachable, and the client
// has no way to tell that from a very good match.
func TestAProviderScoringOutsideTheRangeFailsTheSearch(t *testing.T) {
	rogue := &searchProviderFake{entries: []core.SearchEntry{
		searchEntry("library", "rogue", "a hit scored 7", 7),
	}}
	api, _ := newSearchAPI(t, rogue)

	_, err := api.Search(context.Background(), "whatever")
	if err == nil {
		t.Fatal("a score of 7 was accepted, want the failure")
	}
	if !strings.Contains(err.Error(), "rogue") {
		t.Fatalf("the failure is %q, want the offending id named", err)
	}
}

// TestTheQueryReachesEveryProviderUnchanged is what a merge that pre-parsed
// the query would break: each module's matching rule is its own, so the words
// the person typed have to arrive as typed.
func TestTheQueryReachesEveryProviderUnchanged(t *testing.T) {
	first := &searchProviderFake{}
	second := &searchProviderFake{}
	api, _ := newSearchAPI(t, first, second)

	if _, err := api.Search(context.Background(), "memória de trabalho"); err != nil {
		t.Fatalf("searching: %v", err)
	}
	for _, fake := range []*searchProviderFake{first, second} {
		if fake.askedQuery != "memória de trabalho" {
			t.Fatalf("a provider was asked %q, want the query as typed", fake.askedQuery)
		}
	}
}
