package library

import (
	"context"
	"strings"
)

// LibraryViewSuggestions is the view that is not a location: it reads every
// location and orders by how closely each item relates to what the person is
// focused on, listing unread before read within one score.
//
// It sits in the same parameter as the locations because a list is read one way
// at a time, and a separate parameter would have to answer what
// inbox + suggestions means.
const LibraryViewSuggestions = "suggestions"

// librarySortSuggestions is the pseudo-sort that view ordered by, named like
// the FTS rank so the cursor's sort field tells one list's pagination from
// another's.
const librarySortSuggestions = "suggestions"

// libraryFocusTargetsSentinel stands in for the empty focus.
//
// SQLite has no syntax for an empty IN list, and the alternative -- dropping
// the join when nothing is in focus -- would make the score expression depend
// on the data, so the cursor predicate and the ORDER BY would have to be built
// differently for a focus that emptied between two pages. An id no row can
// carry keeps one shape for both cases: with nothing in focus every score is
// 0, and the Suggestions view degrades to the unread-then-saved order rather
// than to a second query.
const libraryFocusTargetsSentinel = ""

// libraryFocusScoreColumn is an item's focus score as the query computes it.
//
// It is an expression rather than a stored column because the focus moves: a
// score written down when the item was saved would rank today's list by last
// month's attention. The alias is spelled out at every use instead of being
// referenced as an output name, because SQLite resolves an output alias in
// ORDER BY and not in WHERE, and the cursor predicate needs it in WHERE.
const libraryFocusScoreColumn = "COALESCE(library_focus_score.score, 0.0)"

// libraryFocusScoreRounded is the score the list compares and orders by. A
// score is a sum of floats, and a cursor carries it through JSON, so equality
// on the raw value could miss by a last bit and re-serve or skip a row at a
// page boundary; nine places is far below any weight difference and makes
// the select, the ORDER BY and the cursor agree exactly.
const libraryFocusScoreRounded = "ROUND(" + libraryFocusScoreColumn + ", 9)"

// libraryUnreadColumn is the unread flag as the order and the cursor read it.
// It is stored as 0 or 1, so "unread first" is a DESC on an integer and the
// cursor compares that integer rather than a boolean.
const libraryUnreadColumn = "library_items.unread"

// librarySuggestionsOrderBy orders the Suggestions view: the score first, then
// what is still unread among equal scores, then the saved order, then the id.
// Items nothing in focus points at score 0 and so follow the scored ones,
// unread first and then in saved order.
//
// Unread sits below the score rather than above it because the view ranks by
// relevance to the focus: a closely related item the person has read is still
// a better suggestion than an unrelated unread one.
const librarySuggestionsOrderBy = libraryFocusScoreRounded +
	" DESC, " + libraryUnreadColumn + " DESC, library_items.saved_at DESC, library_items.id DESC"

// libraryFocusLinkWeight is what one link contributes to the score, as SQL.
//
// A confirmed link is a person's own statement that the item is about the
// target, so it weighs a whole point. A suggestion weighs what the model said
// it was worth, and a suggestion with no confidence recorded weighs half a
// point -- the middle of the range, which is the least the absence of a number
// can be read as. A rejected link is a decision too, and it contributes
// nothing: the person said this item is not about that.
const libraryFocusLinkWeight = `CASE core_links.status
        WHEN 'confirmed' THEN 1.0
        WHEN 'suggested' THEN COALESCE(core_links.confidence, 0.5)
        ELSE 0.0
    END`

// libraryFocusScoreJoin renders the join carrying every item's focus score,
// and the arguments its IN list takes.
//
// The sum is grouped in a subquery rather than aggregated over the outer
// query, because the outer query is a page of items: aggregating there would
// make every filter and the LIMIT collapse rows the sum had already folded.
func libraryFocusScoreJoin(targets []string) (string, []any) {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", max(len(targets), 1)), ",")
	join := ` LEFT JOIN (
    SELECT core_links.src_id AS src_id, SUM(` + libraryFocusLinkWeight + `) AS score
    FROM core_links
    WHERE core_links.dst_id IN (` + placeholders + `)
    GROUP BY core_links.src_id
) AS library_focus_score ON library_focus_score.src_id = library_items.id`
	args := make([]any, 0, max(len(targets), 1))
	if len(targets) == 0 {
		return join, append(args, libraryFocusTargetsSentinel)
	}
	for _, target := range targets {
		args = append(args, target)
	}
	return join, args
}

// libraryFocusReader is the slice of the core's focus service this module
// needs: the registry ids a link has to point at for the item holding it to
// count as related to what the person is focused on.
//
// The module declares the interface rather than taking *core.FocusAPI so that
// a test drives the ranking from a fixed set of ids without standing up the
// subjects service and a provider list behind it.
type libraryFocusReader interface {
	TargetIDs(ctx context.Context) ([]string, error)
}

// errLibraryNoFocus is what the focus-ranked view and the weighted draw answer
// in a process assembled without the focus service.
//
// It is a 503 and not a 500 because the request was fine and the server is
// running; what is missing is a dependency serve always wires. Answering an
// unranked list instead would be worse than refusing: a Suggestions view that
// silently scored everything 0 is the saved order wearing the focus view's
// name.
var errLibraryNoFocus = &LibraryError{
	Status:  503,
	Code:    "no_focus",
	Message: "this server was started without the focus service",
}

// libraryFocusTargets reads the ids in focus, or refuses when this process has
// no focus service.
func (s *LibraryService) libraryFocusTargets(ctx context.Context) ([]string, error) {
	if s.focus == nil {
		return nil, errLibraryNoFocus
	}
	targets, err := s.focus.TargetIDs(ctx)
	if err != nil {
		return nil, err
	}
	return targets, nil
}

// libraryRefuseSuggestionsConflicts rejects the parameters that would ask the
// Suggestions view for two orders at once.
//
// Neither is ignored instead, which is the same rule the list already follows
// for an explicit sort together with q: a filter the caller sent and the
// server dropped is a list that answers a question nobody asked.
//
// unread is not among them. The view reads every location and orders unread
// first, so unread is an ordinary filter over it like it is over any other
// view, and unread=false asks for the read items in focus order.
func libraryRefuseSuggestionsConflicts(in ListInput) error {
	if in.Query != "" {
		return libraryBadRequest("invalid_request",
			"q and view=suggestions cannot be combined: the suggestions view orders by the focus score", "q")
	}
	if in.SortExplicit {
		return libraryBadRequest("invalid_request",
			"sort and view=suggestions cannot be combined: the suggestions view carries its own order", "sort")
	}
	return nil
}
