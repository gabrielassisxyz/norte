package library

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// LibraryItemExtractedEvent is published after an extraction commits. The notes
// module subscribes to it to re-anchor the highlights of the item whose text
// has just changed; the library knows nothing about that and must not.
const LibraryItemExtractedEvent = "library.item_extracted"

// The two follow-up job kinds extraction enqueues. Their handlers belong to
// other beads -- the Telegram bot and the LLM classifier -- and until those
// land the jobs sit queued, untouched, which is exactly what an unregistered
// kind is meant to do.
const (
	LibraryNotifyTelegramJobKind = "notify_telegram"
	LibraryClassifyJobKind       = "classify"
)

// libraryExtractPayload is what a save or a retry puts in the job.
type libraryExtractPayload struct {
	ItemID     string `json:"item_id"`
	Generation int64  `json:"generation"`
	Refresh    bool   `json:"refresh"`
}

// LibraryExtractionOptions is everything the handler needs. The fetcher is
// built by the caller, so a test supplies one with its own resolver and dialer
// and no test ever reaches the network.
type LibraryExtractionOptions struct {
	Database *core.Database
	Files    *core.Files
	Jobs     *core.Jobs
	Clock    core.Clock
	Events   *core.Events
	Logger   *slog.Logger
	Fetcher  *libraryFetcher
	// LLMConfigured reports whether NORTE_LLM_URL is set. Without it the
	// classify job has nothing to call, so a successful extraction does not
	// enqueue one.
	LLMConfigured bool
}

// LibraryExtraction drains the library.extract jobs: it resolves the page's
// HTML, extracts and sanitizes it, writes the result in one transaction and
// enqueues what has to happen next.
//
// Everything it does is idempotent. The handler replays on a crash between the
// effect and the job's status write, so re-running overwrites the same columns
// from the same snapshot and the follow-up jobs collapse on their dedupe keys.
type LibraryExtraction struct {
	database      *core.Database
	files         *core.Files
	jobs          *core.Jobs
	clock         core.Clock
	events        *core.Events
	logger        *slog.Logger
	fetcher       *libraryFetcher
	llmConfigured bool

	// afterSnapshot and afterCommit are test seams, nil in production.
	//
	// afterSnapshot runs once the page's bytes are in hand and before anything
	// is written, which is where a test holds one run while another supersedes
	// it, and where a test holds the handler to prove a save does not wait for
	// it. afterCommit runs between the commit and the publish, which is the
	// one window a crash can land in, and the only way to exercise it is to
	// crash a process there on purpose.
	afterSnapshot func()
	afterCommit   func()
}

// NewLibraryExtraction returns the handler over its dependencies.
func NewLibraryExtraction(opts LibraryExtractionOptions) *LibraryExtraction {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &LibraryExtraction{
		database:      opts.Database,
		files:         opts.Files,
		jobs:          opts.Jobs,
		clock:         opts.Clock,
		events:        opts.Events,
		logger:        logger,
		fetcher:       opts.Fetcher,
		llmConfigured: opts.LLMConfigured,
	}
}

// librarySnapshotSource is the HTML one run will read, and whether this run is
// the one that fetched it.
type librarySnapshotBytes struct {
	html    []byte
	hash    string
	fetched bool
}

// Handle runs one extraction.
//
// The order is the whole design. The page is fetched and stored before any
// transaction opens, because the blob store writes through the same single
// writer connection and storing inside an open transaction would wait on
// itself. The event is published after the commit and before the handler
// returns, so a crash in between leaves the job running, its lease expires, and
// the replay publishes again.
func (e *LibraryExtraction) Handle(ctx context.Context, job core.Job) error {
	payload, err := libraryDecodeExtractPayload(job.Payload)
	if err != nil {
		return core.Permanent(err)
	}
	item, err := db.New(e.database.Reader()).GetLibraryItemByID(ctx, payload.ItemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// The item was deleted while the job waited. There is nothing to
			// extract and nothing a retry would find.
			return core.Permanent(fmt.Errorf("no library item %s", payload.ItemID))
		}
		return fmt.Errorf("reading the library item: %w", err)
	}
	if item.ExtractGeneration != payload.Generation {
		// A newer request has already superseded this one; doing the work
		// would only be thrown away by the generation check at the commit.
		return nil
	}

	snapshot, err := e.resolveSnapshot(ctx, item, payload)
	if err != nil {
		return e.recordFailure(ctx, job, item, payload.Generation, err)
	}
	if e.afterSnapshot != nil {
		e.afterSnapshot()
	}

	pageURL, err := url.Parse(item.Url)
	if err != nil {
		return e.recordFailure(ctx, job, item, payload.Generation, core.Permanent(
			fmt.Errorf("reading the item's address: %w", err)))
	}
	extracted, err := libraryExtractPage(snapshot.html, pageURL)
	if err != nil {
		return e.recordFailure(ctx, job, item, payload.Generation, err)
	}

	superseded, err := e.writeExtraction(ctx, item, payload, snapshot, extracted)
	if err != nil {
		return e.recordFailure(ctx, job, item, payload.Generation, err)
	}
	if superseded {
		// A newer generation installed its own snapshot while this run was
		// working. Nothing was written, nothing is published and nothing is
		// enqueued: the newer job carries all three.
		e.logger.Info("extraction superseded", "item_id", item.ID,
			"generation", payload.Generation, "kind", LibraryExtractJobKind)
		return nil
	}

	if e.afterCommit != nil {
		e.afterCommit()
	}
	// The error comes back to the worker on purpose: the extraction is already
	// durable, so retrying the handler republishes until every subscriber's own
	// job has been enqueued, and their dedupe keys make the replay harmless.
	if err := e.events.Publish(ctx, core.Event{
		Name:    LibraryItemExtractedEvent,
		Payload: map[string]string{"item_id": item.ID},
	}); err != nil {
		return fmt.Errorf("publishing %s for %s: %w", LibraryItemExtractedEvent, item.ID, err)
	}
	return nil
}

func libraryDecodeExtractPayload(raw string) (libraryExtractPayload, error) {
	var payload libraryExtractPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return libraryExtractPayload{}, fmt.Errorf("reading the extract job payload: %w", err)
	}
	if payload.ItemID == "" {
		return libraryExtractPayload{}, fmt.Errorf("the extract job names no item")
	}
	if payload.Generation <= 0 {
		return libraryExtractPayload{}, fmt.Errorf("the extract job of %s names no generation", payload.ItemID)
	}
	return payload, nil
}

// resolveSnapshot produces the bytes this run reads: the stored snapshot when
// there is one, a fresh fetch when there is not or when a refresh was asked
// for. A fetch is stored before this returns, so the writer transaction only
// has a hash to record.
func (e *LibraryExtraction) resolveSnapshot(
	ctx context.Context,
	item db.LibraryItem,
	payload libraryExtractPayload,
) (librarySnapshotBytes, error) {
	stored := item.HtmlHash.Valid && item.HtmlHash.String != ""
	if stored && !payload.Refresh {
		content, err := os.ReadFile(e.files.Path(item.HtmlHash.String))
		if err != nil {
			return librarySnapshotBytes{}, fmt.Errorf("reading the stored snapshot of %s: %w", item.ID, err)
		}
		return librarySnapshotBytes{html: content, hash: item.HtmlHash.String}, nil
	}
	if e.fetcher == nil {
		return librarySnapshotBytes{}, core.Permanent(
			fmt.Errorf("item %s has no snapshot and this server has no fetcher", item.ID))
	}
	fetched, err := e.fetcher.Fetch(ctx, item.Url)
	if err != nil {
		return librarySnapshotBytes{}, err
	}
	blob, err := e.files.Store(ctx, bytes.NewReader(fetched.HTML), librarySnapshotMediaType)
	if err != nil {
		return librarySnapshotBytes{}, fmt.Errorf("storing the fetched snapshot of %s: %w", item.ID, err)
	}
	// The person chose to measure before capping anything smaller than the
	// fetch limit, and these are the numbers that choice waits on.
	e.logger.Info("stored a fetched snapshot", "item_id", item.ID,
		"bytes", blob.Size, "media_type", fetched.MediaType)
	return librarySnapshotBytes{html: fetched.HTML, hash: blob.Hash, fetched: true}, nil
}

// writeExtraction commits everything one pass produced, and reports whether a
// newer generation superseded the run instead.
//
// The generation is re-read inside this transaction, not before it. A check
// outside would be a check against a row that can change before the write, and
// the whole point is that a superseded run writes no column, publishes no event
// and enqueues no job.
func (e *LibraryExtraction) writeExtraction(
	ctx context.Context,
	item db.LibraryItem,
	payload libraryExtractPayload,
	snapshot librarySnapshotBytes,
	extracted libraryExtracted,
) (bool, error) {
	tx, err := e.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("beginning the extraction transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)

	generation, err := queries.GetLibraryExtractGeneration(ctx, item.ID)
	if err != nil {
		return false, fmt.Errorf("reading the extract generation of %s: %w", item.ID, err)
	}
	if generation != payload.Generation {
		return true, nil
	}

	now := e.clock.Now()
	stamp := core.FormatTime(now)
	meta := libraryDecodeMeta(item.Meta)

	htmlHash := item.HtmlHash
	if snapshot.fetched {
		htmlHash = sql.NullString{String: snapshot.hash, Valid: true}
		meta["snapshot_source"] = "server_fetch"
		if err := librarySwapSnapshotRef(ctx, tx, item, snapshot.hash); err != nil {
			return false, err
		}
	}

	title := item.Title
	if item.TitleEdited == 1 {
		if extracted.Title != "" {
			// The person's title stands; the extractor's goes where the
			// library screen can offer it without overwriting anything.
			meta["extracted_title"] = extracted.Title
		}
	} else if extracted.Title != "" {
		title = extracted.Title
	}

	headings, err := json.Marshal(extracted.Headings)
	if err != nil {
		return false, fmt.Errorf("encoding the headings of %s: %w", item.ID, err)
	}

	if err := queries.WriteLibraryExtraction(ctx, db.WriteLibraryExtractionParams{
		Title:           title,
		Author:          libraryNullableText(extracted.Author),
		Site:            libraryNullableText(extracted.Site),
		PublishedAt:     libraryNullableText(extracted.PublishedAt),
		LeadImage:       libraryNullableText(extracted.LeadImage),
		HtmlHash:        htmlHash,
		ContentHtml:     libraryNullableText(extracted.ContentHTML),
		ContentText:     libraryNullableText(extracted.ContentText),
		ContentHeadings: libraryNullableText(string(headings)),
		Minutes:         sql.NullInt64{Int64: int64(extracted.Minutes), Valid: extracted.Minutes > 0},
		ReadPosition:    libraryRevalidateReadPosition(item.ReadPosition, extracted.Headings),
		Meta:            libraryEncodeMeta(meta),
		ExtractedAt:     sql.NullString{String: stamp, Valid: true},
		UpdatedAt:       stamp,
		ID:              item.ID,
	}); err != nil {
		return false, fmt.Errorf("writing the extraction of %s: %w", item.ID, err)
	}

	if title != item.Title {
		if err := core.UpdateItem(ctx, tx, item.ID, title, item.Kind); err != nil {
			return false, err
		}
	}

	if err := e.enqueueTelegramReplies(ctx, tx, item.ID, meta); err != nil {
		return false, err
	}
	if err := e.enqueueClassification(ctx, tx, item.ID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("committing the extraction of %s: %w", item.ID, err)
	}
	return false, nil
}

// librarySwapSnapshotRef points the item at the blob this run fetched: the new
// reference is inserted and the previous one deleted in the same transaction,
// so the old blob becomes eligible for `norte files gc` and nothing is ever
// referenced by a row that is not there.
func librarySwapSnapshotRef(ctx context.Context, tx *sql.Tx, item db.LibraryItem, hash string) error {
	previous := ""
	if item.HtmlHash.Valid {
		previous = item.HtmlHash.String
	}
	if previous == hash {
		// Refetching produced the same bytes, so the reference already holds.
		return nil
	}
	if previous != "" {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM core_file_refs WHERE hash = ? AND owner_id = ? AND kind = 'snapshot'`,
			previous, item.ID); err != nil {
			return fmt.Errorf("releasing the previous snapshot of %s: %w", item.ID, err)
		}
	}
	return insertLibraryFileRef(ctx, tx, hash, item.ID)
}

// recordFailure writes the reason on the item and decides, from the worker's
// own attempt count, whether this was the last word.
//
// Below the maximum the item stays pending with the reason recorded, and the
// error goes back so the worker schedules the retry. On the last attempt, or on
// a permanent error, the item is marked failed and the terminal follow-ups are
// enqueued in that same transaction -- so a person waiting on Telegram hears
// about the failure exactly once.
func (e *LibraryExtraction) recordFailure(
	ctx context.Context,
	job core.Job,
	item db.LibraryItem,
	generation int64,
	handlerErr error,
) error {
	terminal := core.IsPermanent(handlerErr) || job.Attempt >= job.MaxAttempts
	redacted := core.RedactError(handlerErr)
	if redacted == "" {
		redacted = "the extraction failed"
	}
	// A failure is recorded on a context of its own: the handler's may already
	// be cancelled by the shutdown that caused the failure, and a row with no
	// reason on it is the one thing the screen cannot explain.
	writeCtx := context.WithoutCancel(ctx)
	stamp := core.FormatTime(e.clock.Now())

	if !terminal {
		recorded, err := db.New(e.database.Writer()).RecordLibraryExtractionError(writeCtx,
			db.RecordLibraryExtractionErrorParams{
				ExtractError:      sql.NullString{String: redacted, Valid: true},
				UpdatedAt:         stamp,
				ID:                item.ID,
				ExtractGeneration: generation,
			})
		if err != nil {
			return errors.Join(handlerErr, fmt.Errorf("recording the extraction error: %w", err))
		}
		if recorded == 0 {
			return nil
		}
		return handlerErr
	}

	tx, err := e.database.Writer().BeginTx(writeCtx, nil)
	if err != nil {
		return errors.Join(handlerErr, fmt.Errorf("beginning the failure transaction: %w", err))
	}
	defer func() { _ = tx.Rollback() }()
	marked, err := db.New(tx).MarkLibraryExtractionFailed(writeCtx, db.MarkLibraryExtractionFailedParams{
		ExtractError:      sql.NullString{String: redacted, Valid: true},
		UpdatedAt:         stamp,
		ID:                item.ID,
		ExtractGeneration: generation,
	})
	if err != nil {
		return errors.Join(handlerErr, fmt.Errorf("marking the extraction of %s failed: %w", item.ID, err))
	}
	if marked == 0 {
		// A newer generation owns the item; its job reports its own outcome,
		// and retrying this one could only repeat the stale write.
		return nil
	}
	if err := e.enqueueTelegramReplies(writeCtx, tx, item.ID, libraryDecodeMeta(item.Meta)); err != nil {
		return errors.Join(handlerErr, err)
	}
	if err := tx.Commit(); err != nil {
		return errors.Join(handlerErr, fmt.Errorf("committing the extraction failure: %w", err))
	}
	return handlerErr
}

// libraryTelegramMessage is one Telegram message that asked for this item. The
// poller records them in the save's transaction and the reply job stamps them;
// extraction only has to say that the answer is ready.
//
// RepliedAt is a pointer so that an unanswered message is written as null
// rather than as the empty string -- the column is read by a person debugging
// a reply that did not arrive, and "replied_at": "" reads like a bug.
type libraryTelegramMessage struct {
	ChatID    json.Number `json:"chat_id"`
	MessageID json.Number `json:"message_id"`
	ItemID    string      `json:"item_id,omitempty"`
	RepliedAt *string     `json:"replied_at"`
}

// enqueueTelegramReplies queues one reply per message that has not had one.
// The dedupe key is the message itself, so a replay of this handler -- or a
// success followed by nothing at all -- leaves exactly one job per message.
func (e *LibraryExtraction) enqueueTelegramReplies(
	ctx context.Context,
	tx *sql.Tx,
	itemID string,
	meta map[string]any,
) error {
	for _, message := range libraryUnrepliedTelegramMessages(meta, itemID) {
		if err := libraryEnqueueTelegramReply(ctx, e.jobs, tx,
			message.ChatID, message.MessageID, message.ItemID); err != nil {
			return err
		}
	}
	return nil
}

// libraryEnqueueTelegramReply queues one reply inside the caller's
// transaction. It is the one place the payload and the dedupe key are built,
// because the save enqueues a reply for an item that is already extracted and
// the extraction enqueues one for everything else: two spellings of that key
// would mean a message answered twice.
func libraryEnqueueTelegramReply(
	ctx context.Context,
	jobs *core.Jobs,
	tx *sql.Tx,
	chatID, messageID json.Number,
	itemID string,
) error {
	payload, err := json.Marshal(map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
		"item_id":    itemID,
	})
	if err != nil {
		return fmt.Errorf("encoding the Telegram reply of %s: %w", itemID, err)
	}
	dedupe := fmt.Sprintf("%s:%s:%s:%s",
		LibraryNotifyTelegramJobKind, chatID, messageID, itemID)
	if _, err := jobs.Enqueue(ctx, tx, LibraryNotifyTelegramJobKind, string(payload), dedupe); err != nil {
		return fmt.Errorf("enqueueing the Telegram reply of %s: %w", itemID, err)
	}
	return nil
}

// libraryUnrepliedTelegramMessages reads meta.telegram_messages and keeps the
// entries with no replied_at. A malformed entry is skipped rather than failing
// the extraction: the text is the thing the person asked for, and a reply that
// cannot be addressed is not worth losing it over.
func libraryUnrepliedTelegramMessages(meta map[string]any, itemID string) []libraryTelegramMessage {
	raw, ok := meta["telegram_messages"]
	if !ok {
		return nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var entries []libraryTelegramMessage
	if err := json.Unmarshal(encoded, &entries); err != nil {
		return nil
	}
	unreplied := make([]libraryTelegramMessage, 0, len(entries))
	for _, entry := range entries {
		if entry.RepliedAt != nil && *entry.RepliedAt != "" {
			continue
		}
		if entry.ChatID == "" || entry.MessageID == "" {
			continue
		}
		if entry.ItemID == "" {
			entry.ItemID = itemID
		}
		unreplied = append(unreplied, entry)
	}
	return unreplied
}

// enqueueClassification queues the LLM's look at the item, when there is an LLM
// to ask and the person has not already said what the item is about. A
// confirmed link is such a statement, and asking the model to second-guess it
// would put a suggestion back in a review queue that was deliberately emptied.
func (e *LibraryExtraction) enqueueClassification(ctx context.Context, tx *sql.Tx, itemID string) error {
	if !e.llmConfigured {
		return nil
	}
	confirmed, err := libraryHasConfirmedLink(ctx, tx, itemID)
	if err != nil {
		return err
	}
	if confirmed {
		return nil
	}
	payload, err := json.Marshal(map[string]string{"item_id": itemID})
	if err != nil {
		return fmt.Errorf("encoding the classify job of %s: %w", itemID, err)
	}
	if _, err := e.jobs.Enqueue(ctx, tx, LibraryClassifyJobKind, string(payload),
		fmt.Sprintf("%s:%s", LibraryClassifyJobKind, itemID)); err != nil {
		return fmt.Errorf("enqueueing the classify job of %s: %w", itemID, err)
	}
	return nil
}

func libraryHasConfirmedLink(ctx context.Context, tx *sql.Tx, itemID string) (bool, error) {
	var present int
	err := tx.QueryRowContext(ctx,
		`SELECT 1 FROM core_links WHERE src_id = ? AND status = 'confirmed' LIMIT 1`, itemID).Scan(&present)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading the confirmed links of %s: %w", itemID, err)
	}
	return true, nil
}

// libraryRevalidateReadPosition keeps a stored reading position across a
// re-extraction, as far as the new text allows.
//
// The anchor is checked against the new headings and nothing else. When it is
// gone only the anchor is cleared: the percent is a coarser answer to the same
// question, and throwing it away would send the person back to the top of an
// article they were halfway through.
func libraryRevalidateReadPosition(stored sql.NullString, headings []libraryHeading) sql.NullString {
	if !stored.Valid || strings.TrimSpace(stored.String) == "" {
		return stored
	}
	var position map[string]any
	if err := json.Unmarshal([]byte(stored.String), &position); err != nil {
		return stored
	}
	anchor, ok := position["anchor"].(string)
	if !ok || anchor == "" {
		return stored
	}
	for _, heading := range headings {
		if heading.Anchor == anchor {
			return stored
		}
	}
	delete(position, "anchor")
	encoded, err := json.Marshal(position)
	if err != nil {
		return stored
	}
	return sql.NullString{String: string(encoded), Valid: true}
}

// libraryDecodeMeta reads an item's meta JSON, answering with an empty object
// rather than an error: meta is open by design, and a row whose meta cannot be
// read is still a row whose text is worth extracting.
func libraryDecodeMeta(raw string) map[string]any {
	decoded := map[string]any{}
	if strings.TrimSpace(raw) == "" {
		return decoded
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return map[string]any{}
	}
	return decoded
}

func libraryEncodeMeta(meta map[string]any) string {
	encoded, err := json.Marshal(meta)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// libraryNullableText stores an absent string as NULL, so "the page declared no
// author" is one value in the column rather than two.
func libraryNullableText(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}
