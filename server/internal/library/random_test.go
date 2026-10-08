package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// libraryFixedDraws is a random source handing out the values a test chose, in
// order, and failing the test rather than wrapping around when a draw asks for
// one more than it was given -- a silent wrap would make an assertion about
// the twentieth draw an assertion about the first.
type libraryFixedDraws struct {
	t      *testing.T
	values []float64
	next   int
}

func (d *libraryFixedDraws) Float64() float64 {
	d.t.Helper()
	if d.next >= len(d.values) {
		d.t.Fatalf("the draw asked for value %d of %d", d.next+1, len(d.values))
	}
	value := d.values[d.next]
	d.next++
	return value
}

// libraryDrawIDs sends one draw request and returns the ids in draw order.
func libraryDrawIDs(t *testing.T, handler http.Handler, query string) []string {
	t.Helper()
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/random"+query, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("GET random%s = %d, want 200 (%q)", query, response.Code, response.Body.String())
	}
	var body struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("the draw answer is not JSON: %v (%q)", err, response.Body.String())
	}
	ids := make([]string, 0, len(body.Items))
	for _, item := range body.Items {
		ids = append(ids, item.ID)
	}
	return ids
}

// libraryExpectedDrawBands is the spelling of the bead's weighting, written out
// here independently of the code under test: the candidates in the order the
// draw consumes them -- id ascending -- each with the weight its focus score
// earns it, turned into the half-open band of [0, 1) that lands on it.
//
// The test derives the draw values from these bands rather than from the
// implementation, which is what makes a changed weight formula show up as a
// different item coming back.
func libraryExpectedDrawBands(scoresByID map[string]float64, awayFromFocus bool) ([]string, []float64) {
	ids := make([]string, 0, len(scoresByID))
	for id := range scoresByID {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	weights := make([]float64, len(ids))
	total := 0.0
	for index, id := range ids {
		weight := 1.0
		if awayFromFocus {
			weight = 1 / (1 + scoresByID[id])
		}
		weights[index] = weight
		total += weight
	}
	bounds := make([]float64, len(ids))
	running := 0.0
	for index, weight := range weights {
		running += weight
		bounds[index] = running / total
	}
	return ids, bounds
}

// libraryBandProbes turns the expected upper bounds into draw values that sit
// on both sides of every boundary, with the item each one must land on.
//
// Probing the boundaries and not the middles is what makes the weights
// themselves checkable. A midpoint lands on the right item under any formula
// that ranks the items the same way, so a test built from midpoints proves the
// order of the weights and says nothing about their size; a value a hair above
// a boundary moves to the next item only if that boundary is where the
// weighting actually puts it.
func libraryBandProbes(ids []string, bounds []float64) ([]float64, []string) {
	const hair = 1e-9
	draws := []float64{}
	wants := []string{}
	for index, upper := range bounds {
		draws = append(draws, upper-hair)
		wants = append(wants, ids[index])
		if index+1 < len(ids) {
			draws = append(draws, upper+hair)
			wants = append(wants, ids[index+1])
		}
	}
	return draws, wants
}

// libraryFocusScores is the fixture's hand-computed score per item: 1.0 for
// the confirmed link, the recorded 0.8 for the suggestion, 0.5 for the
// suggestion with no confidence, 0 for the rejected link and 0 for no link.
func (f libraryFocusFixture) libraryFocusScores() map[string]float64 {
	return map[string]float64{
		f.ids["x"]: 1.0,
		f.ids["y"]: 0.8,
		f.ids["z"]: 0.5,
		f.ids["w"]: 0.0,
		f.ids["v"]: 0.0,
	}
}

// TestLibraryDrawFollowsTheWeightsFromAnInjectedSource is the second half of
// the bead's fourth criterion: with the randomness fixed, the draw lands on
// exactly the item the hand-computed weights put under each value, on both
// sides of every boundary between them.
func TestLibraryDrawFollowsTheWeightsFromAnInjectedSource(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)
	scores := fixture.libraryFocusScores()

	for _, away := range []bool{true, false} {
		ids, bounds := libraryExpectedDrawBands(scores, away)
		draws, want := libraryBandProbes(ids, bounds)
		count := len(draws)
		result, err := fixture.service.Draw(context.Background(), DrawInput{
			AwayFromFocus: away,
			N:             &count,
			Source:        &libraryFixedDraws{t: t, values: draws},
		})
		if err != nil {
			t.Fatalf("drawing with away_from_focus=%v: %v", away, err)
		}
		drawn := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			drawn = append(drawn, item.ID)
		}
		if fmt.Sprint(fixture.letters(drawn)) != fmt.Sprint(fixture.letters(want)) {
			t.Fatalf("away_from_focus=%v drew %v, want %v",
				away, fixture.letters(drawn), fixture.letters(want))
		}
	}
}

// TestLibraryDrawIsWeightedAwayFromTheFocus proves the weighting has a
// direction, and that the flag is read at all: one value lands on the most
// focused item when every item is equally likely, and on a less focused one
// when the draw is weighted away.
//
// Without this, a weight formula that returned a constant would still satisfy
// the band test above -- the expectation and the code would agree on the same
// wrong thing, because both compute the bands from the same formula.
func TestLibraryDrawIsWeightedAwayFromTheFocus(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)
	scores := fixture.libraryFocusScores()

	// The fixture's last candidate by id is the one with the highest score,
	// so the start of its band is where the weighting takes the most room
	// away: a value between the two starts belongs to it uniformly and to a
	// less focused item when weighted.
	_, weighted := libraryExpectedDrawBands(scores, true)
	_, uniform := libraryExpectedDrawBands(scores, false)
	last := len(uniform) - 2
	if uniform[last] >= weighted[last] {
		t.Fatalf("the most focused item's band starts at %.4f uniformly and %.4f weighted;"+
			" the weighting takes it no room away", uniform[last], weighted[last])
	}
	probe := (uniform[last] + weighted[last]) / 2
	one := 1
	drawn := func(away bool) string {
		t.Helper()
		result, err := fixture.service.Draw(context.Background(), DrawInput{
			AwayFromFocus: away, N: &one, Source: &libraryFixedDraws{t: t, values: []float64{probe}},
		})
		if err != nil {
			t.Fatalf("drawing with away_from_focus=%v: %v", away, err)
		}
		return result.Items[0].ID
	}
	weightedPick, uniformPick := drawn(true), drawn(false)
	if scores[weightedPick] >= scores[uniformPick] {
		t.Fatalf("at %.4f the weighted draw took %s (score %.2f) and the uniform one %s (score %.2f);"+
			" the flag changes nothing or leans the wrong way",
			probe, fixture.letters([]string{weightedPick})[0], scores[weightedPick],
			fixture.letters([]string{uniformPick})[0], scores[uniformPick])
	}
}

// TestLibrarySeededDrawsRepeat is the first half of the fourth criterion: the
// same seed over the same data draws the same twenty ids, in the same order.
func TestLibrarySeededDrawsRepeat(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	first := libraryDrawIDs(t, fixture.handler, "?seed=42&n=20")
	second := libraryDrawIDs(t, fixture.handler, "?seed=42&n=20")
	if len(first) != 20 {
		t.Fatalf("seed=42&n=20 drew %d items, want 20", len(first))
	}
	if fmt.Sprint(first) != fmt.Sprint(second) {
		t.Fatalf("two calls with seed=42 drew %v and %v", fixture.letters(first), fixture.letters(second))
	}
	other := libraryDrawIDs(t, fixture.handler, "?seed=43&n=20")
	if fmt.Sprint(first) == fmt.Sprint(other) {
		t.Errorf("seed=43 drew the same sequence as seed=42, so the seed is not read")
	}
}

// TestLibraryDrawNeverLandsOnAReadItem is the draw half of the second
// criterion: a hundred draws never return the item that was marked read.
func TestLibraryDrawNeverLandsOnAReadItem(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	read := false
	if _, err := fixture.service.Patch(context.Background(), fixture.ids["v"],
		PatchInput{Unread: &read}); err != nil {
		t.Fatalf("marking v read: %v", err)
	}
	for _, id := range libraryDrawIDs(t, fixture.handler, "?seed=7&n=100") {
		if id == fixture.ids["v"] {
			t.Fatal("a draw landed on the item that was marked read")
		}
	}
}

// TestLibraryDrawCountIsBounded is the sixth criterion: the three values
// outside 1..100 are refused in the standard envelope, and an omitted n draws
// exactly once.
func TestLibraryDrawCountIsBounded(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	for _, query := range []string{"?n=0", "?n=-1", "?n=101"} {
		response := doLibraryRequest(t, fixture.handler, http.MethodGet, "/api/library/items/random"+query, nil)
		if response.Code != http.StatusBadRequest {
			t.Errorf("GET random%s = %d, want 400 (%q)", query, response.Code, response.Body.String())
			continue
		}
		libraryRequireErrorEnvelope(t, response, "invalid_request")
	}
	if drawn := libraryDrawIDs(t, fixture.handler, ""); len(drawn) != 1 {
		t.Errorf("a draw with no n returned %d items, want exactly 1", len(drawn))
	}
	if drawn := libraryDrawIDs(t, fixture.handler, "?n=100&seed=1"); len(drawn) != 100 {
		t.Errorf("n=100 returned %d items, want 100", len(drawn))
	}
}

// TestLibraryDrawWithNothingUnreadIs404 is the seventh criterion's server
// half: an empty pool is a 404 in the standard envelope, not an empty list the
// button would present as an item.
func TestLibraryDrawWithNothingUnreadIs404(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	empty := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/random", nil)
	if empty.Code != http.StatusNotFound {
		t.Fatalf("a draw over an empty library = %d, want 404 (%q)", empty.Code, empty.Body.String())
	}
	libraryRequireErrorEnvelope(t, empty, "not_found")

	saved := librarySaveOne(t, service, "https://example.org/the-only-one", "")
	read := false
	if _, err := service.Patch(context.Background(), saved.ID, PatchInput{Unread: &read}); err != nil {
		t.Fatalf("marking the only item read: %v", err)
	}
	allRead := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/random", nil)
	if allRead.Code != http.StatusNotFound {
		t.Fatalf("a draw with everything read = %d, want 404 (%q)", allRead.Code, allRead.Body.String())
	}
	libraryRequireErrorEnvelope(t, allRead, "not_found")
}

// TestLibraryDrawWithoutTheFocusServiceRefuses proves the weighted draw
// refuses rather than drawing uniformly behind the weighted flag.
func TestLibraryDrawWithoutTheFocusServiceRefuses(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := NewLibraryService(database,
		core.NewFiles(dataDir, database.Writer(), clock),
		core.NewJobs(database.Writer(), clock, nil),
		clock)
	librarySaveOne(t, service, "https://example.org/unranked", "")

	_, err := service.Draw(context.Background(), DrawInput{AwayFromFocus: true})
	var domain *LibraryError
	if !errors.As(err, &domain) {
		t.Fatalf("drawing with no focus service gave %v, want a domain error", err)
	}
	if domain.Status != http.StatusServiceUnavailable || domain.Code != "no_focus" {
		t.Fatalf("the refusal is %d/%s, want 503/no_focus", domain.Status, domain.Code)
	}
}

// TestLibraryDrawWeight checks the weight each score earns, which is the one
// number the whole serendipity behaviour rests on.
func TestLibraryDrawWeight(t *testing.T) {
	cases := []struct {
		score float64
		away  bool
		want  float64
	}{
		{score: 0, away: true, want: 1},
		{score: 1, away: true, want: 0.5},
		{score: 0.5, away: true, want: 1.0 / 1.5},
		{score: 4, away: true, want: 0.2},
		{score: 0, away: false, want: 1},
		{score: 4, away: false, want: 1},
	}
	for _, this := range cases {
		got := libraryDrawWeight(this.score, this.away)
		if math.Abs(got-this.want) > 1e-12 {
			t.Errorf("libraryDrawWeight(%v, %v) = %v, want %v", this.score, this.away, got, this.want)
		}
	}
}

// TestLibraryPickWeightedBands checks which index a draw lands on, including
// the two edges a weighted pick gets wrong: the lower bound of a band belongs
// to that band, and an item with no weight at all is never picked.
func TestLibraryPickWeightedBands(t *testing.T) {
	// Bands over a total of 4: [0, 0.25), [0.25, 0.75), [0.75, 0.75), [0.75, 1).
	weights := []float64{1, 2, 0, 1}
	cases := []struct {
		draw float64
		want int
	}{
		{draw: 0, want: 0},
		{draw: 0.2499, want: 0},
		{draw: 0.25, want: 1},
		{draw: 0.7499, want: 1},
		{draw: 0.75, want: 3},
		{draw: 0.9999, want: 3},
	}
	for _, this := range cases {
		if got := libraryPickWeighted(weights, this.draw); got != this.want {
			t.Errorf("libraryPickWeighted(%v, %v) = %d, want %d", weights, this.draw, got, this.want)
		}
	}
	if got := libraryPickWeighted([]float64{1}, 0.5); got != 0 {
		t.Errorf("a single candidate is index %d, want 0", got)
	}
}
