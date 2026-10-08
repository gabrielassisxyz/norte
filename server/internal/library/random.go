package library

import (
	"context"
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// How many items one draw call may return. More than one draw exists for the
// test that proves a seed reproduces a whole sequence rather than a single
// value; the cap is there because every draw costs a row in the answer and
// nothing on the screen asks for a hundred.
const (
	libraryMinDraws = 1
	libraryMaxDraws = 100
)

// libraryRandomSource is the randomness one draw consumes: a value in [0, 1).
//
// It is an interface so a test can hand the draw the exact values it wants and
// then assert which items came back, which is the only way to check the
// weighting itself rather than the shape of its output. *math/rand/v2.Rand
// satisfies it as it is.
type libraryRandomSource interface {
	Float64() float64
}

// libraryProcessRandom draws from the process-wide source, which is what an
// unseeded call uses.
type libraryProcessRandom struct{}

func (libraryProcessRandom) Float64() float64 { return rand.Float64() }

// DrawInput is what GET /api/library/items/random asks for.
//
// N is a pointer because an absent n draws once while n = 0 is a request to
// draw nothing, and those are different answers: the first is the button's
// call and the second is refused.
type DrawInput struct {
	AwayFromFocus bool
	N             *int
	Seed          *int64
	// Source overrides where the randomness comes from. A test sets it; the
	// HTTP handler never does, and leaves the seed to decide.
	Source libraryRandomSource
}

// DrawResult is the answer: one summary per draw, in draw order.
type DrawResult struct {
	Items []db.LibraryItem
}

// libraryDrawCandidate is one unread item a draw may land on, with the score
// its weight is computed from.
type libraryDrawCandidate struct {
	ID    string
	Score float64
}

// libraryDrawWeight is how likely one item is to be drawn, relative to the
// others.
//
// Away from the focus the weight falls as the score rises -- 1 / (1 + score),
// which halves the chance of an item with one confirmed link to something in
// focus and never reaches zero, because "unrelated to the focus" is a
// preference and not a filter. Drawing uniformly weighs every item the same,
// which is the plain lottery the flag turns the weighting off for.
func libraryDrawWeight(score float64, awayFromFocus bool) float64 {
	if !awayFromFocus {
		return 1
	}
	return 1 / (1 + score)
}

// libraryPickWeighted reports which index a draw in [0, 1) lands on, with each
// index's share of the total weight deciding how wide its band is.
//
// The last index is the fallback: the bands are summed in floating point, so a
// draw just under 1 can exceed the accumulated total by a rounding error, and
// a loop that fell through would report "no item" for a draw that has to hit
// one.
func libraryPickWeighted(weights []float64, draw float64) int {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	target := draw * total
	running := 0.0
	for index, weight := range weights {
		running += weight
		if target < running {
			return index
		}
	}
	return len(weights) - 1
}

// Draw samples unread items, weighted away from the focus unless asked for a
// uniform draw. Draws are with replacement: one call is n independent draws,
// so the same item may come back twice, which is what makes a seeded sequence
// reproducible without the earlier draws changing the later odds.
func (s *LibraryService) Draw(ctx context.Context, in DrawInput) (DrawResult, error) {
	draws, err := libraryDrawCount(in.N)
	if err != nil {
		return DrawResult{}, err
	}
	targets, err := s.libraryFocusTargets(ctx)
	if err != nil {
		return DrawResult{}, err
	}
	candidates, err := s.libraryDrawCandidates(ctx, targets)
	if err != nil {
		return DrawResult{}, err
	}
	if len(candidates) == 0 {
		return DrawResult{}, &LibraryError{
			Status:  404,
			Code:    "not_found",
			Message: "there is nothing unread to draw from",
		}
	}
	weights := make([]float64, len(candidates))
	for index, candidate := range candidates {
		weights[index] = libraryDrawWeight(candidate.Score, in.AwayFromFocus)
	}
	source := libraryDrawSource(in)
	drawn := make([]string, 0, draws)
	for range draws {
		drawn = append(drawn, candidates[libraryPickWeighted(weights, source.Float64())].ID)
	}
	items, err := s.libraryItemsByID(ctx, drawn)
	if err != nil {
		return DrawResult{}, err
	}
	return DrawResult{Items: items}, nil
}

// libraryDrawCount resolves how many draws one call makes. An absent n draws
// once; a number outside the range is refused rather than clamped, because a
// caller that asked for 500 and received 100 was answered a different question.
func libraryDrawCount(requested *int) (int, error) {
	if requested == nil {
		return 1, nil
	}
	if *requested < libraryMinDraws || *requested > libraryMaxDraws {
		return 0, libraryBadRequest("invalid_request",
			fmt.Sprintf("n draws between %d and %d items, not %d", libraryMinDraws, libraryMaxDraws, *requested), "n")
	}
	return *requested, nil
}

// libraryDrawSource picks where the randomness comes from: the source a test
// injected, then the seed the request carried, and otherwise the process's own.
//
// A seed is turned into a PCG generator rather than reseeding anything global,
// so two seeded calls in flight at once cannot read each other's position.
func libraryDrawSource(in DrawInput) libraryRandomSource {
	if in.Source != nil {
		return in.Source
	}
	if in.Seed != nil {
		return rand.New(rand.NewPCG(uint64(*in.Seed), 0))
	}
	return libraryProcessRandom{}
}

// libraryDrawCandidates reads every unread item with its focus score, ordered
// by id.
//
// The order is what makes a seed reproduce an answer: the weights are consumed
// positionally, so the same seed over the same rows in a different order would
// draw different items. Only the id and the score are read, because the rows
// the draw does not land on are never rendered.
func (s *LibraryService) libraryDrawCandidates(ctx context.Context, targets []string) ([]libraryDrawCandidate, error) {
	join, args := libraryFocusScoreJoin(targets)
	query := "SELECT library_items.id, " + libraryFocusScoreColumn + " AS score FROM library_items" +
		join + " WHERE library_items.unread = 1 ORDER BY library_items.id ASC"
	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("reading the items a draw may land on: %w", err)
	}
	defer rows.Close()
	candidates := []libraryDrawCandidate{}
	for rows.Next() {
		var candidate libraryDrawCandidate
		if err := rows.Scan(&candidate.ID, &candidate.Score); err != nil {
			return nil, fmt.Errorf("scanning an item a draw may land on: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading the items a draw may land on: %w", err)
	}
	return candidates, nil
}

// libraryItemsByID reads the rows behind the ids drawn and returns them in
// draw order, repeating a row the draw landed on twice.
//
// One query over the distinct ids, then the order restored from the draw: the
// answer has to be in the order the draws happened for a seeded sequence to be
// comparable, and SQL has no order to give it.
func (s *LibraryService) libraryItemsByID(ctx context.Context, ids []string) ([]db.LibraryItem, error) {
	distinct := make([]any, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			distinct = append(distinct, id)
		}
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(distinct)), ",")
	qualified := "library_items." + strings.Join(strings.Split(
		strings.Join(strings.Fields(libraryItemColumns), " "), ", "), ", library_items.")
	query := "SELECT " + qualified + " FROM library_items WHERE library_items.id IN (" + placeholders + ")"
	rows, err := s.database.Reader().QueryContext(ctx, query, distinct...)
	if err != nil {
		return nil, fmt.Errorf("reading the drawn items: %w", err)
	}
	defer rows.Close()
	byID := make(map[string]db.LibraryItem, len(distinct))
	for rows.Next() {
		row, _, err := libraryScanListRow(rows, false)
		if err != nil {
			return nil, err
		}
		byID[row.ID] = row
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading the drawn items: %w", err)
	}
	items := make([]db.LibraryItem, 0, len(ids))
	for _, id := range ids {
		row, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("the drawn item %s is no longer there", id)
		}
		items = append(items, row)
	}
	return items, nil
}
