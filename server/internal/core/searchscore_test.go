package core_test

import (
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// TestTheBestRawValueScoresOneAndTheWorstScoresZero pins the two ends of the
// mapping, in both directions, because "lower is better" and "higher is
// better" share one function and a swapped comparison would turn every
// provider's ranking upside down while still answering numbers in [0, 1].
func TestTheBestRawValueScoresOneAndTheWorstScoresZero(t *testing.T) {
	// bm25 values: more negative is a closer match.
	got := core.NormalizeSearchScores([]float64{-9, -5, -1}, true)
	want := []float64{1, 0.5, 0}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("bm25 scores are %v, want %v", got, want)
		}
	}

	// Match counts: more is a closer match.
	got = core.NormalizeSearchScores([]float64{1, 3, 5}, false)
	want = []float64{0, 0.5, 1}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("count scores are %v, want %v", got, want)
		}
	}
}

// TestASingleHitScoresOne is the case a naive normalisation gets wrong: with
// one value the best and the worst are the same number, and dividing by that
// spread would answer NaN or bury a query's only answer at 0.
func TestASingleHitScoresOne(t *testing.T) {
	for _, lowerIsBetter := range []bool{true, false} {
		got := core.NormalizeSearchScores([]float64{-4.25}, lowerIsBetter)
		if len(got) != 1 || got[0] != 1 {
			t.Fatalf("a single hit with lowerIsBetter=%v scored %v, want [1]", lowerIsBetter, got)
		}
	}
}

// TestAllEqualHitsAllScoreOne is the same trap with more rows: three hits
// that match equally well are all the best of their query, so none of them
// may be ranked below another module's weaker hit.
func TestAllEqualHitsAllScoreOne(t *testing.T) {
	got := core.NormalizeSearchScores([]float64{-2, -2, -2}, true)
	for i, score := range got {
		if score != 1 {
			t.Fatalf("equal hit %d scored %v, want 1 (all of %v)", i, score, got)
		}
	}
}

// TestEverySearchScoreIsInRange is what the contract promises, and the
// clamping is the only thing standing between a float division and a score
// the API would have to reject.
func TestEverySearchScoreIsInRange(t *testing.T) {
	raws := [][]float64{
		{},
		{0},
		{-18.3315, -18.3314, -0.0001},
		{1e-12, 1, 1e12},
	}
	for _, raw := range raws {
		for _, lowerIsBetter := range []bool{true, false} {
			for _, score := range core.NormalizeSearchScores(raw, lowerIsBetter) {
				if !core.ValidSearchScore(score) {
					t.Fatalf("%v with lowerIsBetter=%v produced %v, outside [0, 1]",
						raw, lowerIsBetter, score)
				}
			}
		}
	}
}
