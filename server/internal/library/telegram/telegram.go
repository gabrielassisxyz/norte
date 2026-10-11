// Package telegram is the library's temporary phone entry: a long-polling
// adapter that saves the links sent to one private Telegram chat and answers
// each of them once.
//
// It owns the Telegram protocol and nothing else. Every row it needs written
// -- the item, the message recorded on it, the update cursor -- goes through
// the Store and Replies ports, which the library implements, so this package
// never names a table and never opens a transaction. That is also what keeps
// the dependency pointing one way: the library knows about Telegram, and
// Telegram knows nothing about the library.
//
// The whole adapter is expected to be deleted once the phone has a share
// sheet, which is the other reason it sits behind two small interfaces instead
// of inside the library's own files.
package telegram

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// DefaultAPIBase is the Telegram Bot API every production run talks to. A test
// points Settings.APIBase at its own fake instead, and nothing in the suite
// reaches this host.
const DefaultAPIBase = "https://api.telegram.org"

// The poller's schedule. The long poll is what keeps an idle bot from asking
// Telegram thirty times a minute; the backoff is what keeps a failing request
// or an unwritable database from turning into a hot loop.
const (
	pollTimeout  = 30 * time.Second
	errorBackoff = 5 * time.Second
	// maxSaveFailures is how many times in a row one update may fail to be
	// recorded before it is given up on. Without it a failure that never
	// clears holds the cursor, and every message behind it, forever.
	maxSaveFailures = 5
)

// Settings is what the adapter needs from the configuration, already
// validated: a chat id that is a number and a public URL a phone can open.
type Settings struct {
	// Token is the bot token. It travels in the request path, which is why
	// every error leaving this package is scrubbed of it.
	Token  string
	ChatID int64
	// PublicURL has no trailing slash, so ItemURL can join with one.
	PublicURL string
	// APIBase overrides DefaultAPIBase. A test sets it; production leaves it
	// empty.
	APIBase string
}

// ParseSettings validates the two settings that have to hold once a token is
// set, and names the one that does not.
//
// It is called before anything starts polling, because a chat id that is not a
// number would make every message fail the sender check in silence: the bot
// would look alive and answer nothing, which is the one failure a person
// cannot tell from "Telegram is slow".
func ParseSettings(token, chat, publicURL string) (Settings, error) {
	chatID, err := strconv.ParseInt(strings.TrimSpace(chat), 10, 64)
	if err != nil {
		return Settings{}, fmt.Errorf(
			"NORTE_TELEGRAM_CHAT must be a Telegram chat id, which is a number, and is %q", chat)
	}
	trimmed := strings.TrimSpace(publicURL)
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return Settings{}, fmt.Errorf(
			"NORTE_PUBLIC_URL must be an absolute http or https URL for the reply to link to, and is %q", publicURL)
	}
	return Settings{
		Token:     token,
		ChatID:    chatID,
		PublicURL: strings.TrimRight(parsed.String(), "/"),
		APIBase:   "",
	}, nil
}

// ItemURL is the address the reply sends the person to.
func (s Settings) ItemURL(itemID string) string {
	return s.PublicURL + "/library/" + itemID
}

// Capture is one accepted message: the link to save, the note sent with it,
// and the ids the reply has to be addressed to.
type Capture struct {
	UpdateID  int64
	ChatID    int64
	MessageID int64
	URL       string
	Reason    string
}

// Store is the library's side of what the poller writes.
type Store interface {
	// UpdateOffset reports the id of the last update already dealt with, and 0
	// when this server has never seen one.
	UpdateOffset(ctx context.Context) (int64, error)
	// SaveLink saves one message's link, records the message on the item and
	// advances the cursor, all in one transaction, so a restart neither
	// replays the save nor skips the message.
	SaveLink(ctx context.Context, capture Capture) error
	// SkipUpdate records an update that produced no save -- another chat, or a
	// message with no URL in it -- so the poller does not offer it again.
	SkipUpdate(ctx context.Context, updateID int64) error
}

// Adapter is the long-polling loop `norte serve` starts when a token is set.
type Adapter struct {
	client   *Client
	store    Store
	settings Settings
	clock    core.Clock
	logger   *slog.Logger
}

// NewAdapter returns the poller over its dependencies.
func NewAdapter(settings Settings, store Store, clock core.Clock, logger *slog.Logger) *Adapter {
	return &Adapter{
		client:   NewClient(settings),
		store:    store,
		settings: settings,
		clock:    clock,
		logger:   adapterLogger(logger),
	}
}

// Run polls until ctx ends.
//
// The offset is read from the cursor the saves advance, never kept only in
// memory: that is what makes a restart continue where the last committed save
// left off. An update whose save fails does not move the offset and stops the
// batch, so the next poll offers it again in order rather than leaving a hole
// behind it -- until the same update has failed maxSaveFailures times in a
// row, when it is logged and skipped so one poisoned message cannot hold the
// rest of the chat.
func (a *Adapter) Run(ctx context.Context) error {
	cursor, err := a.store.UpdateOffset(ctx)
	if err != nil {
		return fmt.Errorf("reading the Telegram update cursor: %w", err)
	}
	a.logger.Info("telegram adapter started", "chat_id", a.settings.ChatID, "offset", cursor+1)
	var failingID int64
	failures := 0
	for {
		if ctx.Err() != nil {
			return nil
		}
		updates, err := a.client.GetUpdates(ctx, cursor+1, pollTimeout)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			a.logger.Warn("the Telegram poll failed", "err", err.Error())
			if !a.pause(ctx, errorBackoff) {
				return nil
			}
			continue
		}
		stalled := false
		for _, update := range updates {
			if err := a.deal(ctx, update); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				a.logger.Error("a Telegram update could not be recorded",
					"update_id", update.UpdateID, "err", err.Error())
				if update.UpdateID != failingID {
					failingID, failures = update.UpdateID, 0
				}
				failures++
				if failures < maxSaveFailures {
					stalled = true
					break
				}
				a.logger.Error("a Telegram update failed too many times in a row and is skipped",
					"update_id", update.UpdateID, "failures", failures)
				failingID, failures = 0, 0
				// Best effort: the in-memory cursor moves either way, and a
				// restart that re-offers the update starts the count again.
				_ = a.store.SkipUpdate(ctx, update.UpdateID)
			}
			cursor = update.UpdateID
		}
		if stalled && !a.pause(ctx, errorBackoff) {
			return nil
		}
	}
}

// deal saves one update, or records it as dealt with. A message from another
// chat and a message with no URL are both recorded and answered with nothing:
// this bot belongs to one person, and a stranger learns nothing from silence.
func (a *Adapter) deal(ctx context.Context, update Update) error {
	message := update.Message
	if message == nil || message.Chat.ID != a.settings.ChatID {
		return a.store.SkipUpdate(ctx, update.UpdateID)
	}
	link, reason, ok := FirstLink(messageText(message))
	if !ok {
		return a.store.SkipUpdate(ctx, update.UpdateID)
	}
	return a.store.SaveLink(ctx, Capture{
		UpdateID:  update.UpdateID,
		ChatID:    message.Chat.ID,
		MessageID: message.MessageID,
		URL:       link,
		Reason:    reason,
	})
}

// messageText is what a person wrote: the text, or the caption of a message
// whose body is media.
func messageText(message *Message) string {
	if message.Text != "" {
		return message.Text
	}
	return message.Caption
}

// pause waits on the injected clock and reports whether the wait finished
// rather than the context ending.
func (a *Adapter) pause(ctx context.Context, d time.Duration) bool {
	timer := a.clock.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C():
		return true
	}
}

func adapterLogger(logger *slog.Logger) *slog.Logger {
	if logger == nil {
		return slog.New(slog.DiscardHandler)
	}
	return logger
}
