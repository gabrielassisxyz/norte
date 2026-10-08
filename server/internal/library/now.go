package library

import (
	"context"
	"strings"
)

// LibraryViewNow is the view that is not a shelf: every status, unread only,
// ordered by how closely each item relates to what the person is focused on.
//
// It sits in the same parameter as the shelves because a list is read one way
// at a time, and a separate parameter would have to answer what inbox + now
// means.
const LibraryViewNow = "now"

// librarySortNow is the pseudo-sort that view ordered by, named like the FTS
// rank so the cursor's sort field tells one list's pagination from another's.
const librarySortNow = "now"

// libraryFocusTargetsSentinel stands in for the empty focus.
//
// SQLite has no syntax for an empty IN list, and the alternative -- dropping
// the join when nothing is in focus -- would make the score expression depend
// on the data, so the cursor predicate and the ORDER BY would have to be built
// differently for a focus that emptied between two pages. An id no row can
// carry keeps one shape for both cases: with nothing in focus every score is
// 0, and the now view degrades to the saved order rather than to a second
// query.
const libraryFocusTargetsSentinel = ""

// libraryFocusScoreColumn is an item's focus score as the query computes it.
//
// It is an expression rather than a stored column because the focus moves: a
// score written down when the item was saved would rank today's list by last
// month's attention. The alias is spelled out at every use instead of being
// referenced as an output name, because SQLite resolves an output alias in
// ORDER BY and not in WHERE, and the cursor predicate needs it in WHERE.
const libraryFocusScoreColumn = "COALESCE(library_focus_score.score, 0.0)"

// libraryNowOrderBy orders the now view: the score first, then the saved order
// among equal scores, then the id. Items nothing in focus points at score 0
// and so follow the scored ones, in saved order, which is the default list
// they would have been in anyway.
const libraryNowOrderBy = libraryFocusScoreColumn +
	" DESC, library_items.saved_at DESC, library_items.id DESC"

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
// unranked list instead would be worse than refusing: a now view that silently
// scored everything 0 is the saved order wearing the focus view's name.
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

// libraryRefuseNowConflicts rejects the parameters that would ask the now view
// for two orders at once, or for an item it exists to leave out.
//
// None of the three is ignored instead, which is the same rule the list
// already follows for an explicit sort together with q: a filter the caller
// sent and the server dropped is a list that answers a question nobody asked.
func libraryRefuseNowConflicts(in ListInput) error {
	if in.Query != "" {
		return libraryBadRequest("invalid_request",
			"q and view=now cannot be combined: the now view orders by the focus score", "q")
	}
	if in.SortExplicit {
		return libraryBadRequest("invalid_request",
			"sort and view=now cannot be combined: the now view carries its own order", "sort")
	}
	if in.Unread != nil && !*in.Unread {
		return libraryBadRequest("invalid_request",
			"unread=false and view=now cannot be combined: the now view is what is left to read", "unread")
	}
	return nil
}
