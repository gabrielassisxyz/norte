package notes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/notes/db"
)

// notesLibraryItemExtractedEvent is the event the library publishes after an
// extraction commits.
//
// It is a literal rather than an import of the library's constant on purpose:
// a module that imported another module's package would be compiled against a
// product that can be switched off, and the name of an event is the whole
// contract between the two. A rename on the publishing side is caught by
// TestTheExtractionEventNameTheLibraryPublishes.
const notesLibraryItemExtractedEvent = "library.item_extracted"

// NotesReanchorJobKind is the queue kind one item's re-anchoring runs under.
const NotesReanchorJobKind = "notes.reanchor"

// notesReanchorPayload is what the event's callback puts in the job.
type notesReanchorPayload struct {
	ItemID string `json:"item_id"`
}

// NotesReanchor re-anchors an item's highlights against its current text.
//
// The reaction is a job rather than work done inside the event callback,
// because the callback runs inside the publisher's own call and nothing would
// replay it: enqueueing makes the reaction exactly as durable as the queue.
type NotesReanchor struct {
	database *core.Database
	jobs     *core.Jobs
	texts    *core.Texts
	logger   *slog.Logger
}

// NewNotesReanchor returns the handler over its dependencies.
func NewNotesReanchor(database *core.Database, jobs *core.Jobs, texts *core.Texts, logger *slog.Logger) *NotesReanchor {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &NotesReanchor{database: database, jobs: jobs, texts: texts, logger: logger}
}

func newNotesReanchorFromDeps(deps app.Deps) *NotesReanchor {
	return NewNotesReanchor(deps.Database, deps.Jobs, deps.Texts, deps.Logger)
}

// OnItemExtracted enqueues the re-anchoring of the item the event names.
//
// The dedupe key is the item, so an item extracted three times in a row while
// the queue is busy has one job waiting rather than three, and a replay of the
// publisher's handler adds none. The error comes back to the publisher on
// purpose: the extraction is already durable, so a failed enqueue is retried
// by the worker replaying the extraction handler, which publishes again.
func (r *NotesReanchor) OnItemExtracted(ctx context.Context, event core.Event) error {
	itemID := event.Payload["item_id"]
	if itemID == "" {
		return fmt.Errorf("%s carries no item_id", event.Name)
	}
	payload, err := json.Marshal(notesReanchorPayload{ItemID: itemID})
	if err != nil {
		return fmt.Errorf("encoding the re-anchor job of %s: %w", itemID, err)
	}
	tx, err := r.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the re-anchor enqueue of %s: %w", itemID, err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := r.jobs.Enqueue(ctx, tx, NotesReanchorJobKind, string(payload),
		fmt.Sprintf("reanchor:%s", itemID)); err != nil {
		return fmt.Errorf("enqueueing the re-anchor of %s: %w", itemID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the re-anchor enqueue of %s: %w", itemID, err)
	}
	return nil
}

// Handle re-anchors every highlight of one item.
//
// It is idempotent: re-running reads the same text and reaches the same status
// and the same hint for every passage, so a replay after a crash costs a second
// search and changes nothing. A passage whose owning module is switched off is
// left exactly as it was -- the text it was taken from is unavailable, which is
// not evidence that the passage is gone.
func (r *NotesReanchor) Handle(ctx context.Context, job core.Job) error {
	var payload notesReanchorPayload
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return core.Permanent(fmt.Errorf("reading the re-anchor job payload: %w", err))
	}
	if payload.ItemID == "" {
		return core.Permanent(fmt.Errorf("the re-anchor job names no item"))
	}
	changed, err := r.ReanchorItem(ctx, payload.ItemID)
	if err != nil {
		return err
	}
	r.logger.Info("re-anchored the highlights of an item",
		"item_id", payload.ItemID, "kind", NotesReanchorJobKind, "changed", changed)
	return nil
}

// ReanchorItem searches every highlight of one item against the item's current
// text and reports how many rows it changed.
//
// It is exported because the integration test drives it directly as well as
// through the queue: the path from the event to the job to this is one thing to
// prove, and the search over a table of texts is another.
func (r *NotesReanchor) ReanchorItem(ctx context.Context, itemID string) (int, error) {
	text, err := r.texts.Text(ctx, itemID)
	if err != nil {
		if errors.Is(err, core.ErrNoText) {
			// No text to search. Every passage keeps its stored words and its
			// status, which is the whole point of anchoring by text.
			return 0, nil
		}
		return 0, fmt.Errorf("reading the text of %s: %w", itemID, err)
	}
	queries := db.New(r.database.Writer())
	highlights, err := queries.ListNotesHighlightsForItem(ctx, itemID)
	if err != nil {
		return 0, fmt.Errorf("reading the highlights of %s: %w", itemID, err)
	}
	changed := 0
	for _, highlight := range highlights {
		result := notesAnchor(text, highlight.Exact, highlight.Prefix, highlight.Suffix,
			int(highlight.PositionHint))
		if result.Status == highlight.Status && int64(result.Hint) == highlight.PositionHint {
			continue
		}
		if err := queries.SetNotesHighlightAnchor(ctx, db.SetNotesHighlightAnchorParams{
			Status:       result.Status,
			PositionHint: int64(result.Hint),
			ID:           highlight.ID,
		}); err != nil {
			return changed, fmt.Errorf("re-anchoring the highlight %s: %w", highlight.ID, err)
		}
		changed++
	}
	return changed, nil
}
