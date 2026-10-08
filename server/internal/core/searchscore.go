package core

// NormalizeSearchScores maps one provider's raw relevance values onto the
// [0, 1] range SearchEntry.Score promises, so hits from modules that rank by
// completely different measures can be ordered on one list.
//
// The mapping is linear over the values of this one query: the best raw value
// scores 1, the worst scores 0, and everything between lands proportionally.
// It is deliberately per-query and not absolute, because no provider's raw
// value has a stable range -- an FTS5 bm25 value depends on the corpus and on
// the number of terms, so "0.4" would mean a different thing in every query.
// What the caller can rely on is the ordering and that the best hit is 1.
//
// lowerIsBetter says which end of the raw scale is the good one: true for a
// bm25 value, where a more negative number is a closer match, and false for a
// count of matches, where more is better.
//
// A single value, or several that are all equal, all score 1 rather than 0:
// with nothing to spread them over, "the worst of these" is also "the best of
// these", and answering 0 would bury a query's only hit below every other
// module's.
func NormalizeSearchScores(raw []float64, lowerIsBetter bool) []float64 {
	scores := make([]float64, len(raw))
	if len(raw) == 0 {
		return scores
	}
	best, worst := raw[0], raw[0]
	for _, value := range raw[1:] {
		if value < best {
			best = value
		}
		if value > worst {
			worst = value
		}
	}
	if !lowerIsBetter {
		best, worst = worst, best
	}
	spread := best - worst
	if spread == 0 {
		for i := range scores {
			scores[i] = 1
		}
		return scores
	}
	for i, value := range raw {
		score := (value - worst) / spread
		// Clamped rather than trusted: the arithmetic is exact at both ends
		// for the values that produced best and worst, but a float division
		// in between must not be able to hand the contract a 1.0000000000002.
		if score < 0 {
			score = 0
		}
		if score > 1 {
			score = 1
		}
		scores[i] = score
	}
	return scores
}
