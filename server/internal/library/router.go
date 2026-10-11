// The router: where a newly saved link lands, and what said so.
//
// Three deciders in order -- a domain rule the person set, the Laya decider,
// and the Inbox as the default -- and one rule above all three: a placement
// the person made by hand is never undone. A domain rule is known from the
// host, so the save applies it; the decider needs the page's text, so it runs
// as the library.route job the extraction enqueues.
package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// The locations the router may choose between, and the one an import puts an
// otherwise-Inbox item in. Every other location is a move the person makes.
const (
	libraryLocationInbox   = "inbox"
	libraryLocationStash   = "stash"
	libraryLocationArchive = "archive"
)

// What placed the item, which is the location_source column's five values.
const (
	libraryLocationSourceRule    = "rule"
	libraryLocationSourceDecider = "decider"
	libraryLocationSourceDefault = "default"
	libraryLocationSourceUser    = "user"
	libraryLocationSourceImport  = "import"
)

// libraryDefaultKind is the kind a save writes, before anything has looked at
// the page. It is also the guard on the decider's retyping: the only other
// writer of the column is the person's PATCH, so a kind reading anything else
// is one somebody chose.
const libraryDefaultKind = "article"

// The two thresholds, and the text the decider is given.
const (
	// libraryStashThreshold is how sure the decider has to be to hide an item
	// from the Inbox. It is high because the two mistakes do not cost the
	// same: a wrong Stash hides something the person wanted to read, and a
	// wrong Inbox costs them one glance.
	libraryStashThreshold = 0.8
	// libraryKindThreshold is the top probability a kind needs. Lower than
	// the Stash threshold because a wrong kind is a visible label the person
	// can correct, not a place they have to think to look in.
	libraryKindThreshold = 0.6
	// libraryRouteTextRunes is how much of the article the state carries, in
	// runes so the cap does not depend on the page's alphabet. Laya truncates
	// the state to 512 tokens of its own, so this is the ceiling rather than
	// the figure the model sees.
	libraryRouteTextRunes = 1500
	// The names the two questions are asked and answered under.
	libraryRouteWhereQuestion = "where"
	libraryRouteKindQuestion  = "kind"
)

// libraryPlacement is where a new item goes and what decided it.
type libraryPlacement struct {
	location string
	source   string
}

// libraryPlaceNewItem is the save-time half of the router: a domain rule if
// one matches the host, and the Inbox if none does.
//
// The import option moves only the Inbox: an import of a dump the person
// already keeps has nothing in it they are waiting to read, so its items land
// processed. A rule still wins, because a rule saying "stash" is an answer
// about the host and not about this batch.
func libraryPlaceNewItem(rules []db.ListLibraryDomainRulesRow, host string, asImport bool) libraryPlacement {
	placement := libraryPlacement{location: libraryLocationInbox, source: libraryLocationSourceDefault}
	if rule, ok := libraryMatchDomainRule(rules, host); ok {
		placement = libraryPlacement{location: rule.Location, source: libraryLocationSourceRule}
	}
	if asImport && placement.location == libraryLocationInbox {
		return libraryPlacement{location: libraryLocationArchive, source: libraryLocationSourceImport}
	}
	return placement
}

// libraryMatchDomainRule finds the rule that governs a host: the one whose
// domain is the host itself or a parent of it, and the longest such domain
// when several match.
//
// Longest wins because the specific rule is the one the person wrote last and
// meant: with pinterest.com in the stash and help.pinterest.com in the inbox,
// a help page is a page they want to read. Two matching domains can never be
// the same length -- one is a proper suffix of the other -- so the comparison
// needs no tie-break.
func libraryMatchDomainRule(rules []db.ListLibraryDomainRulesRow, host string) (db.ListLibraryDomainRulesRow, bool) {
	wanted := libraryNormalizeRuleHost(host)
	if wanted == "" {
		return db.ListLibraryDomainRulesRow{}, false
	}
	var best db.ListLibraryDomainRulesRow
	found := false
	for _, rule := range rules {
		domain := libraryNormalizeRuleHost(rule.Domain)
		if domain == "" {
			continue
		}
		if domain != wanted && !strings.HasSuffix(wanted, "."+domain) {
			continue
		}
		if found && len(domain) <= len(libraryNormalizeRuleHost(best.Domain)) {
			continue
		}
		best, found = rule, true
	}
	return best, found
}

// libraryNormalizeRuleHost is the one spelling a host and a stored domain are
// compared in: lower-case, with the trailing root dot and any leading dots
// off. Both sides go through it, so a rule written ".Pinterest.com" governs
// "br.pinterest.com." without the matcher knowing which side was sloppy.
func libraryNormalizeRuleHost(raw string) string {
	host := strings.ToLower(strings.TrimSpace(raw))
	return strings.Trim(host, ".")
}

// libraryRoutePayload is what the extraction puts in a library.route job.
type libraryRoutePayload struct {
	ItemID string `json:"item_id"`
}

// LibraryRouterOptions is everything the handler needs. The decider is
// injected, so a test drives the handler against an httptest sidecar.
type LibraryRouterOptions struct {
	Database *core.Database
	Clock    core.Clock
	Logger   *slog.Logger
	Decider  *libraryDecider
}

// LibraryRouter drains the library.route jobs: it asks the Laya sidecar where
// one extracted item belongs and what kind of thing it is, and applies each
// answer only if it is sure enough and only if nobody has said otherwise.
//
// Nothing it writes is a decision the person made, so every write it makes is
// guarded by the state it read: the item is moved only while its location is
// still the one the save left and its location_source still says default, and
// retyped only while its kind is still the one the save wrote.
type LibraryRouter struct {
	database *core.Database
	clock    core.Clock
	logger   *slog.Logger
	decider  *libraryDecider
}

// NewLibraryRouter returns the handler over its dependencies.
func NewLibraryRouter(opts LibraryRouterOptions) *LibraryRouter {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &LibraryRouter{
		database: opts.Database,
		clock:    opts.Clock,
		logger:   logger,
		decider:  opts.Decider,
	}
}

// Handle runs one routing.
//
// The two answers are applied independently, each under a guard of its own,
// and the decider is asked whatever state the item is in. An item a rule
// stashed still has the kind the save wrote, and a kind is a label rather
// than a place -- so the answer that may not move it is still the answer that
// may type it.
//
// A decider that fails is logged with the item id and the job succeeds: the
// item is already where the save put it, which is the answer the bead asks
// for when there is no decider to ask, and a job retrying a down sidecar
// every few minutes would ask the same question of the same process for an
// item nobody is waiting on. The next re-extraction asks again.
func (r *LibraryRouter) Handle(ctx context.Context, job core.Job) error {
	payload, err := libraryDecodeRoutePayload(job.Payload)
	if err != nil {
		return core.Permanent(err)
	}
	// Asked before anything is read, as the classifier and the tagger do it:
	// a job queued while a sidecar was configured can be claimed after it is
	// gone, and no number of retries will conjure one back.
	if !r.decider.Configured() {
		return core.Permanent(fmt.Errorf("routing %s: %w", payload.ItemID, errLibraryNoDecider))
	}
	item, err := db.New(r.database.Reader()).GetLibraryItemByID(ctx, payload.ItemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return core.Permanent(fmt.Errorf("no library item %s to route", payload.ItemID))
		}
		return fmt.Errorf("reading the library item to route: %w", err)
	}
	questions := libraryRouteQuestions()
	state := libraryRouteState(item)
	answers, err := r.decider.Decide(ctx, state,
		map[string]libraryDeciderQuestion{libraryRouteWhereQuestion: questions[libraryRouteWhereQuestion]})
	if err != nil {
		r.logger.Warn("the routing could not be decided", "item_id", item.ID,
			"kind", LibraryRouteJobKind, "error", core.RedactError(err))
		return nil
	}
	// The kind is asked apart and without the host. Measured against the real
	// model on 2026-10-11: with "host" in the state an essay came back
	// podcast at 0.70-0.91; without it the same essay spread across article,
	// book and newsletter under the 0.6 threshold, so nothing is retyped
	// wrongly. A failure here leaves the kind as it is and the placement
	// stands.
	kindState := make(map[string]string, len(state))
	for key, value := range state {
		if key != "host" {
			kindState[key] = value
		}
	}
	kindAnswers, err := r.decider.Decide(ctx, kindState,
		map[string]libraryDeciderQuestion{libraryRouteKindQuestion: questions[libraryRouteKindQuestion]})
	if err != nil {
		r.logger.Warn("the kind could not be decided", "item_id", item.ID,
			"kind", LibraryRouteJobKind, "error", core.RedactError(err))
	} else if answer, ok := kindAnswers[libraryRouteKindQuestion]; ok {
		answers[libraryRouteKindQuestion] = answer
	}

	moved, retyped, err := r.apply(ctx, item, answers)
	if err != nil {
		return err
	}
	r.logger.Info("routed a saved item", "item_id", item.ID, "kind", LibraryRouteJobKind,
		"moved_to", moved, "retyped_to", retyped)
	return nil
}

// apply writes both answers in one transaction, and reports what it changed:
// the location it moved the item to and the kind it retyped it as, each empty
// when that answer was not sure enough or its guard refused the write.
//
// One transaction because the two writes are one opinion about one item: a
// crash between them would leave an item stashed under a kind the same answer
// chose and the other half of that answer lost.
func (r *LibraryRouter) apply(
	ctx context.Context,
	item db.LibraryItem,
	answers map[string]libraryDeciderAnswer,
) (string, string, error) {
	tx, err := r.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return "", "", fmt.Errorf("beginning the routing transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	stamp := core.FormatTime(r.clock.Now())

	moved := ""
	if answers[libraryRouteWhereQuestion].probability(libraryLocationStash) >= libraryStashThreshold {
		rows, err := queries.MoveLibraryItemByDecider(ctx, db.MoveLibraryItemByDeciderParams{
			Location:  libraryLocationStash,
			UpdatedAt: stamp,
			ID:        item.ID,
			// The inbox and not the location just read: "where the save left
			// it" is a fact about the save, so an item read in the inbox and
			// one read in Later are told apart by the predicate rather than
			// by this handler agreeing with whatever it happened to see.
			Location_2: libraryLocationInbox,
		})
		if err != nil {
			return "", "", fmt.Errorf("moving %s to the stash: %w", item.ID, err)
		}
		if rows > 0 {
			moved = libraryLocationStash
		}
	}

	retyped := ""
	if kind, confident := libraryRoutedKind(answers[libraryRouteKindQuestion]); confident {
		rows, err := queries.SetLibraryItemKindByDecider(ctx, db.SetLibraryItemKindByDeciderParams{
			Kind:      kind,
			UpdatedAt: stamp,
			ID:        item.ID,
			Kind_2:    libraryDefaultKind,
		})
		if err != nil {
			return "", "", fmt.Errorf("retyping %s as %s: %w", item.ID, kind, err)
		}
		if rows > 0 {
			// The registry carries every item's type for the cross-module
			// screens, so a kind that moves here and not there would make the
			// library and the home screen disagree about what the item is.
			if err := core.UpdateItem(ctx, tx, item.ID, item.Title, kind); err != nil {
				return "", "", err
			}
			retyped = kind
		}
	}

	if err := tx.Commit(); err != nil {
		return "", "", fmt.Errorf("committing the routing of %s: %w", item.ID, err)
	}
	return moved, retyped, nil
}

// libraryRoutedKind is the kind one answer settles, and whether it settles
// one at all: the top option, when it is a kind the library has and the model
// is sure enough of it. Everything else leaves the kind alone, which is what
// the default is for.
func libraryRoutedKind(answer libraryDeciderAnswer) (string, bool) {
	kind, probability := answer.top()
	if probability < libraryKindThreshold {
		return "", false
	}
	if !libraryValidKinds[kind] {
		return "", false
	}
	if kind == libraryDefaultKind {
		// Already the kind on the row: writing it would only move updated_at
		// and report a retyping that changed nothing.
		return "", false
	}
	return kind, true
}

// libraryRouteState is the item as the decider sees it. The text is capped
// because the state is, and the host is spelled out beside the URL because
// the host is what the person's own rules are about -- the model is being
// asked the same question they would answer with a rule.
//
// Nothing here is defanged, unlike the LLM prompts: Laya is a decision model
// answering a typed question over a state, with no instruction channel for a
// page to climb into, and the worst a page arguing for its own placement can
// win is its own placement, which the person can change with one click.
func libraryRouteState(item db.LibraryItem) map[string]string {
	state := map[string]string{
		"url":   item.Url,
		"host":  libraryRouteHost(item),
		"title": item.Title,
	}
	if reason := strings.TrimSpace(item.Reason.String); item.Reason.Valid && reason != "" {
		state["reason"] = reason
	}
	if text := strings.TrimSpace(item.ContentText.String); item.ContentText.Valid && text != "" {
		runes := []rune(text)
		if len(runes) > libraryRouteTextRunes {
			runes = runes[:libraryRouteTextRunes]
		}
		state["text"] = string(runes)
	}
	return state
}

// libraryRouteHost is the item's host, from the canonical URL first because
// that is the address the dedupe agreed on. An address neither spelling can
// be parsed out of answers empty rather than failing the routing: the model
// still has the URL, the title and the text.
func libraryRouteHost(item db.LibraryItem) string {
	for _, raw := range []string{item.CanonicalUrl, item.Url} {
		if parsed, err := ValidateItemURL(raw); err == nil {
			if host := libraryNormalizeRuleHost(parsed.Hostname()); host != "" {
				return host
			}
		}
	}
	return ""
}

// libraryRouteQuestions is what one routing asks: where the item goes, and
// what kind of thing it is. Both are choice questions, so every option comes
// back with a probability and the thresholds have a number to read.
//
// The descriptions are one short line each because Laya gives a question
// header 192 tokens, and the kind question spends them over seven options.
func libraryRouteQuestions() map[string]libraryDeciderQuestion {
	return map[string]libraryDeciderQuestion{
		libraryRouteWhereQuestion: {
			Type:         "choice",
			Instructions: "Does this saved link go to the inbox to be read, or to the stash to be kept?",
			Criteria: map[string]string{
				libraryLocationInbox: "something to read or work through, worth the person's attention",
				libraryLocationStash: "kept as reference or inspiration, with no intention of reading it",
			},
		},
		libraryRouteKindQuestion: {
			Type:         "choice",
			Instructions: "What kind of thing is this saved link?",
			Criteria: map[string]string{
				"article":    "a written piece on a page: an essay, a post, a news story",
				"book":       "a book, or a page about one",
				"paper":      "an academic or technical paper",
				"video":      "a video to watch",
				"podcast":    "an audio episode to listen to",
				"newsletter": "an issue of a newsletter",
				"course":     "a course or a structured set of lessons",
			},
		},
	}
}

func libraryDecodeRoutePayload(raw string) (libraryRoutePayload, error) {
	var payload libraryRoutePayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return libraryRoutePayload{}, fmt.Errorf("reading the route job payload: %w", err)
	}
	if payload.ItemID == "" {
		return libraryRoutePayload{}, errors.New("the route job names no item")
	}
	return payload, nil
}
