package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// failedExtractionReply is what a message gets when the article was saved and
// its text could not be read. It does not say "saved": the link under it is
// the proof, and a phone would rather read two lines than four.
const failedExtractionReply = "saved, but I could not extract the text"

// Target addresses one reply: the message that asked for it and the item it is
// about.
type Target struct {
	ChatID    int64
	MessageID int64
	ItemID    string
}

// Reply is what the library knows that the sender of the message wants to
// hear. Extracted is false when the text could not be read, which is a reply
// of its own rather than silence.
type Reply struct {
	Title     string
	Extracted bool
}

// Replies is the library's side of one reply.
type Replies interface {
	// PendingReply reports what to say, and false when that message already
	// carries a replied_at -- which is what makes a replay of a completed job
	// send nothing. An item whose extraction has not reached a terminal state
	// comes back as an error, so the queue tries again later.
	PendingReply(ctx context.Context, target Target) (Reply, bool, error)
	// MarkReplied records that this message has been answered.
	MarkReplied(ctx context.Context, target Target) error
}

// Notifier handles the notify_telegram jobs: one job per accepted message, one
// message per job.
//
// Delivery is at least once, and the duplicate that remains is one crash
// window wide. The handler reads the message's entry first and stops when
// replied_at is already set, so a replay after a completed run sends nothing;
// it writes replied_at last, so a process that dies between Telegram accepting
// the send and that write repeats the reply once when the job is replayed.
// That duplicate cannot be removed from this side: the Bot API takes no
// idempotency key, so there is no way to tell Telegram that this send and the
// one before it are the same reply. One repeated line in a chat is the price,
// and it is paid only by a crash in that window.
type Notifier struct {
	client   *Client
	replies  Replies
	settings Settings
	logger   *slog.Logger

	// afterSend is a test seam, nil in production. It runs in the window
	// described above -- after Telegram accepted the send and before
	// replied_at is written -- and returning an error from it leaves exactly
	// the state a crash there would leave.
	afterSend func() error
}

// NewNotifier returns the handler over its dependencies.
func NewNotifier(settings Settings, replies Replies, logger *slog.Logger) *Notifier {
	return &Notifier{
		client:   NewClient(settings),
		replies:  replies,
		settings: settings,
		logger:   adapterLogger(logger),
	}
}

// Handle sends one reply.
func (n *Notifier) Handle(ctx context.Context, job core.Job) error {
	target, err := decodeTarget(job.Payload)
	if err != nil {
		return core.Permanent(err)
	}
	reply, pending, err := n.replies.PendingReply(ctx, target)
	if err != nil {
		return err
	}
	if !pending {
		n.logger.Info("the Telegram message was already answered",
			"item_id", target.ItemID, "message_id", target.MessageID)
		return nil
	}
	if err := n.client.SendMessage(ctx, target.ChatID, n.text(reply, target.ItemID)); err != nil {
		return err
	}
	if n.afterSend != nil {
		if err := n.afterSend(); err != nil {
			return err
		}
	}
	// The write runs on a context of its own. The send has already happened,
	// and a shutdown arriving now would otherwise lose the only record that
	// keeps the replay from sending the same reply again.
	return n.replies.MarkReplied(context.WithoutCancel(ctx), target)
}

// text is the reply itself: the title over the link on success, and the reason
// over the same link when the text could not be read. The link goes out either
// way, because the item is saved either way.
func (n *Notifier) text(reply Reply, itemID string) string {
	link := n.settings.ItemURL(itemID)
	if !reply.Extracted {
		return failedExtractionReply + "\n" + link
	}
	title := strings.TrimSpace(reply.Title)
	if title == "" {
		return link
	}
	return title + "\n" + link
}

// notifyPayload is what the save and the extraction put in the job. The ids
// are read as numbers and parsed here, so a payload whose chat id arrived as a
// float is refused rather than rounded.
type notifyPayload struct {
	ChatID    json.Number `json:"chat_id"`
	MessageID json.Number `json:"message_id"`
	ItemID    string      `json:"item_id"`
}

func decodeTarget(raw string) (Target, error) {
	var payload notifyPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return Target{}, fmt.Errorf("reading the Telegram reply payload: %w", err)
	}
	if payload.ItemID == "" {
		return Target{}, fmt.Errorf("the Telegram reply job names no item")
	}
	chatID, err := strconv.ParseInt(payload.ChatID.String(), 10, 64)
	if err != nil {
		return Target{}, fmt.Errorf("the Telegram reply job of %s names chat %q",
			payload.ItemID, payload.ChatID.String())
	}
	messageID, err := strconv.ParseInt(payload.MessageID.String(), 10, 64)
	if err != nil {
		return Target{}, fmt.Errorf("the Telegram reply job of %s names message %q",
			payload.ItemID, payload.MessageID.String())
	}
	return Target{ChatID: chatID, MessageID: messageID, ItemID: payload.ItemID}, nil
}
