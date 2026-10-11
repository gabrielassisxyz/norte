package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
	"github.com/gabrielassisxyz/norte/server/internal/library/telegram"
)

// libraryTelegramCursorKey is the core_settings key holding the id of the last
// Telegram update this server has dealt with. The poller asks for everything
// after it, so the cursor is the one thing that must never move without the
// save beside it having committed.
const libraryTelegramCursorKey = "telegram_update_id"

// libraryTelegramMetaKey is where the messages that asked for an item live on
// the item's meta.
const libraryTelegramMetaKey = "telegram_messages"

// libraryTelegramStore is the library's side of the Telegram adapter: the
// transactions the poller and the reply job need, and nothing about Telegram
// itself.
type libraryTelegramStore struct {
	database *core.Database
	service  *LibraryService
	jobs     *core.Jobs
	clock    core.Clock
	logger   *slog.Logger
}

// newLibraryTelegramStore wires the store over what the registry handed the
// module.
func newLibraryTelegramStore(deps app.Deps) *libraryTelegramStore {
	logger := deps.Logger
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	return &libraryTelegramStore{
		database: deps.Database,
		service:  newLibraryServiceFromDeps(deps),
		jobs:     deps.Jobs,
		clock:    deps.Clock,
		logger:   logger,
	}
}

// UpdateOffset reads the persisted cursor, and reports 0 when this server has
// never dealt with an update.
func (s *libraryTelegramStore) UpdateOffset(ctx context.Context) (int64, error) {
	var value string
	err := s.database.Reader().QueryRowContext(ctx,
		`SELECT value FROM core_settings WHERE key = ?`, libraryTelegramCursorKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("reading %s: %w", libraryTelegramCursorKey, err)
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s holds %q, which is not an update id", libraryTelegramCursorKey, value)
	}
	return parsed, nil
}

// SkipUpdate records an update that produced nothing, in a transaction of its
// own. A message from another chat still has to move the cursor, or the poller
// would offer it again on every poll for as long as the chat exists.
func (s *libraryTelegramStore) SkipUpdate(ctx context.Context, updateID int64) error {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the Telegram cursor transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.recordTelegramCursor(ctx, tx, updateID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the Telegram cursor: %w", err)
	}
	return nil
}

// SaveLink saves one message's link, records the message on the item and moves
// the cursor, in one transaction.
//
// The snapshot is prepared outside that transaction, the way every other save
// does it, because the blob store writes through the same single writer
// connection -- though a Telegram save carries no HTML, so there is nothing to
// store and the call only validates.
func (s *libraryTelegramStore) SaveLink(ctx context.Context, capture telegram.Capture) error {
	prepared, err := s.service.PrepareSave(ctx, SaveInput{
		URL:    capture.URL,
		Reason: capture.Reason,
		Source: LibrarySourceTelegram,
	})
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			// The message named something the library will not save, and a
			// retry would refuse it again. The update is recorded as dealt
			// with so the poller moves on; the person gets no reply, which is
			// what an address that is not an address deserves.
			s.logger.Warn("a Telegram message carried a URL the library refuses",
				"update_id", capture.UpdateID, "err", domain.Message)
			return s.SkipUpdate(ctx, capture.UpdateID)
		}
		return err
	}
	err = s.saveTelegramLinkTx(ctx, prepared, capture)
	if errors.Is(err, errLibraryCanonicalRace) {
		// The concurrent save committed before this insert failed, so the one
		// retry reads it as a duplicate -- the same resolution Save uses.
		err = s.saveTelegramLinkTx(ctx, prepared, capture)
	}
	return err
}

func (s *libraryTelegramStore) saveTelegramLinkTx(
	ctx context.Context,
	prepared *PreparedSave,
	capture telegram.Capture,
) error {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the Telegram save: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	outcome, err := s.service.SavePrepared(ctx, tx, prepared)
	if err != nil {
		return err
	}
	queries := db.New(tx)
	item, err := queries.GetLibraryItemByID(ctx, outcome.ID)
	if err != nil {
		return fmt.Errorf("reading the item %s the Telegram save produced: %w", outcome.ID, err)
	}
	meta := libraryDecodeMeta(item.Meta)
	entries := libraryAppendTelegramEntry(
		libraryTelegramEntries(meta), capture.ChatID, capture.MessageID)
	meta[libraryTelegramMetaKey] = entries
	stamp := core.FormatTime(s.clock.Now())
	if _, err := tx.ExecContext(ctx,
		`UPDATE library_items SET meta = ?, updated_at = ? WHERE id = ?`,
		libraryEncodeMeta(meta), stamp, item.ID); err != nil {
		return fmt.Errorf("recording the Telegram message on %s: %w", item.ID, err)
	}
	// A URL saved and extracted earlier has its answer already. Nothing is
	// going to run the extraction again, so this transaction is the only place
	// that reply can be enqueued from.
	if item.ExtractStatus == "done" || item.ExtractStatus == "failed" {
		if err := libraryEnqueueTelegramReply(ctx, s.jobs, tx,
			json.Number(strconv.FormatInt(capture.ChatID, 10)),
			json.Number(strconv.FormatInt(capture.MessageID, 10)),
			item.ID); err != nil {
			return err
		}
	}
	if err := s.recordTelegramCursor(ctx, tx, capture.UpdateID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the Telegram save of %s: %w", item.ID, err)
	}
	return nil
}

// recordTelegramCursor writes the cursor inside the caller's transaction, so a
// cursor never moves without whatever it stands for having committed.
func (s *libraryTelegramStore) recordTelegramCursor(ctx context.Context, tx *sql.Tx, updateID int64) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO core_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		libraryTelegramCursorKey, strconv.FormatInt(updateID, 10),
		core.FormatTime(s.clock.Now())); err != nil {
		return fmt.Errorf("recording %s = %d: %w", libraryTelegramCursorKey, updateID, err)
	}
	return nil
}

// PendingReply reports what the reply for one message should say, and false
// once that message carries a replied_at.
func (s *libraryTelegramStore) PendingReply(
	ctx context.Context,
	target telegram.Target,
) (telegram.Reply, bool, error) {
	item, err := db.New(s.database.Reader()).GetLibraryItemByID(ctx, target.ItemID)
	if errors.Is(err, sql.ErrNoRows) {
		return telegram.Reply{}, false, core.Permanent(fmt.Errorf("no library item %s", target.ItemID))
	}
	if err != nil {
		return telegram.Reply{}, false, fmt.Errorf("reading the item %s to reply about: %w", target.ItemID, err)
	}
	entries := libraryTelegramEntries(libraryDecodeMeta(item.Meta))
	index := libraryFindTelegramEntry(entries, target.ChatID, target.MessageID)
	if index < 0 {
		return telegram.Reply{}, false, core.Permanent(fmt.Errorf(
			"item %s carries no Telegram message %d, so there is nobody to answer",
			target.ItemID, target.MessageID))
	}
	if entries[index].RepliedAt != nil && *entries[index].RepliedAt != "" {
		return telegram.Reply{}, false, nil
	}
	switch item.ExtractStatus {
	case "done":
		return telegram.Reply{Title: item.Title, Extracted: true}, true, nil
	case "failed":
		return telegram.Reply{Title: item.Title}, true, nil
	default:
		// The job was enqueued before the extraction reached a terminal state,
		// which the queue's own backoff is the right answer to: the retry a
		// minute later finds the answer the person is waiting for, instead of
		// this run inventing one.
		return telegram.Reply{}, false, fmt.Errorf(
			"the extraction of %s is %s, so there is nothing to tell Telegram yet",
			target.ItemID, item.ExtractStatus)
	}
}

// MarkReplied stamps the message's entry. It reads and writes meta in one
// transaction, so two replies about one item cannot each drop the other's
// stamp.
func (s *libraryTelegramStore) MarkReplied(ctx context.Context, target telegram.Target) error {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the Telegram reply transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	item, err := queries.GetLibraryItemByID(ctx, target.ItemID)
	if err != nil {
		return fmt.Errorf("reading the item %s to stamp its reply: %w", target.ItemID, err)
	}
	meta := libraryDecodeMeta(item.Meta)
	entries := libraryTelegramEntries(meta)
	index := libraryFindTelegramEntry(entries, target.ChatID, target.MessageID)
	if index < 0 {
		return fmt.Errorf("item %s carries no Telegram message %d to stamp",
			target.ItemID, target.MessageID)
	}
	stamp := core.FormatTime(s.clock.Now())
	entries[index].RepliedAt = &stamp
	meta[libraryTelegramMetaKey] = entries
	if _, err := tx.ExecContext(ctx,
		`UPDATE library_items SET meta = ?, updated_at = ? WHERE id = ?`,
		libraryEncodeMeta(meta), stamp, item.ID); err != nil {
		return fmt.Errorf("stamping the Telegram reply of %s: %w", item.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the Telegram reply stamp of %s: %w", item.ID, err)
	}
	return nil
}

// libraryTelegramEntries reads meta.telegram_messages. A malformed value comes
// back as no entries: the item and its text are what the person asked for, and
// an unreadable reply list is not worth refusing a save over.
func libraryTelegramEntries(meta map[string]any) []libraryTelegramMessage {
	raw, ok := meta[libraryTelegramMetaKey]
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
	return entries
}

// libraryAppendTelegramEntry adds one message, or leaves the list alone when it
// is already there -- which is what keeps a replayed save from asking for two
// replies to one message.
func libraryAppendTelegramEntry(
	entries []libraryTelegramMessage,
	chatID, messageID int64,
) []libraryTelegramMessage {
	if libraryFindTelegramEntry(entries, chatID, messageID) >= 0 {
		return entries
	}
	return append(entries, libraryTelegramMessage{
		ChatID:    json.Number(strconv.FormatInt(chatID, 10)),
		MessageID: json.Number(strconv.FormatInt(messageID, 10)),
	})
}

func libraryFindTelegramEntry(entries []libraryTelegramMessage, chatID, messageID int64) int {
	chat := strconv.FormatInt(chatID, 10)
	message := strconv.FormatInt(messageID, 10)
	for i, entry := range entries {
		if entry.ChatID.String() == chat && entry.MessageID.String() == message {
			return i
		}
	}
	return -1
}

// libraryTelegramSettings resolves the adapter's configuration, and reports
// whether a bot is configured at all.
func libraryTelegramSettings(deps app.Deps) (telegram.Settings, bool, error) {
	if deps.TelegramToken == "" {
		return telegram.Settings{}, false, nil
	}
	settings, err := telegram.ParseSettings(deps.TelegramToken, deps.TelegramChat, deps.PublicURL)
	if err != nil {
		return telegram.Settings{}, false, err
	}
	return settings, true, nil
}

// newLibraryTelegramAdapter builds the poller, or reports nil when no bot is
// configured.
func newLibraryTelegramAdapter(deps app.Deps) (*telegram.Adapter, error) {
	settings, configured, err := libraryTelegramSettings(deps)
	if err != nil || !configured {
		return nil, err
	}
	return telegram.NewAdapter(settings, newLibraryTelegramStore(deps), deps.Clock, deps.Logger), nil
}

// newLibraryTelegramNotifier builds the reply handler, or reports nil when no
// bot is configured.
func newLibraryTelegramNotifier(deps app.Deps) (*telegram.Notifier, error) {
	settings, configured, err := libraryTelegramSettings(deps)
	if err != nil || !configured {
		return nil, err
	}
	return telegram.NewNotifier(settings, newLibraryTelegramStore(deps), deps.Logger), nil
}
