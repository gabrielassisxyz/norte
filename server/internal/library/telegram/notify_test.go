package telegram

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/telegram/telegramtest"
)

// repliesStub stands in for the library's side of a reply: the Reply to send,
// and the replied_at stamp whose presence suppresses a replay. The library's
// own implementation of the same contract is proved against a real database in
// the library package's tests; what is proved here is the handler's ordering,
// which only this package owns.
type repliesStub struct {
	reply   Reply
	replied bool
	stamps  int
}

func (s *repliesStub) PendingReply(context.Context, Target) (Reply, bool, error) {
	if s.replied {
		return Reply{}, false, nil
	}
	return s.reply, true, nil
}

func (s *repliesStub) MarkReplied(context.Context, Target) error {
	s.replied = true
	s.stamps++
	return nil
}

func newNotifierForTest(t *testing.T, replies Replies) (*Notifier, *telegramtest.Server) {
	t.Helper()
	fake := telegramtest.New()
	t.Cleanup(fake.Close)
	notifier := NewNotifier(Settings{
		Token:     "secret-bot-token",
		ChatID:    -1001234567890,
		PublicURL: "https://norte.example",
		APIBase:   fake.URL(),
	}, replies, nil)
	return notifier, fake
}

func replyJob(itemID string) core.Job {
	return core.Job{
		ID:          "job-" + itemID,
		Kind:        "notify_telegram",
		Payload:     `{"chat_id":-1001234567890,"message_id":41,"item_id":"` + itemID + `"}`,
		Attempt:     1,
		MaxAttempts: core.JobsMaxAttempts,
	}
}

// TestACrashBetweenTheSendAndTheStampRepeatsTheReplyOnce is the claim the
// handler's comment makes, as a test.
//
// Two runs die in the one window that cannot be closed -- Telegram has
// accepted the send, replied_at is not yet written -- and the third completes.
// Three sends is the honest total: each crash costs exactly one repeat, which
// is what at-least-once means when the far side offers no idempotency key. The
// fourth run is the replay of a completed job, and it sends nothing.
//
// The crash is simulated with the handler's own seam rather than by exiting a
// process. The window is defined by replied_at not having been written, and
// returning from the seam leaves precisely that state; the generic
// "a crash leaves the job runnable" claim is proved against a real process
// exit by the extraction's own test.
func TestACrashBetweenTheSendAndTheStampRepeatsTheReplyOnce(t *testing.T) {
	replies := &repliesStub{reply: Reply{Title: "Notes you will read again", Extracted: true}}
	notifier, fake := newNotifierForTest(t, replies)

	crash := errors.New("the process died before replied_at was written")
	notifier.afterSend = func() error { return crash }
	for attempt := 1; attempt <= 2; attempt++ {
		if err := notifier.Handle(context.Background(), replyJob("item-1")); !errors.Is(err, crash) {
			t.Fatalf("crash %d returned %v, want the crash", attempt, err)
		}
		if replies.replied {
			t.Fatalf("crash %d stamped replied_at, so there was no crash window at all", attempt)
		}
	}
	if sends := len(fake.Sends()); sends != 2 {
		t.Fatalf("two crashed runs sent %d replies, want 2", sends)
	}

	notifier.afterSend = nil
	if err := notifier.Handle(context.Background(), replyJob("item-1")); err != nil {
		t.Fatalf("the clean run failed: %v", err)
	}
	sends := fake.Sends()
	if len(sends) != 3 {
		t.Fatalf("two crashes and a clean run sent %d replies, want 3", len(sends))
	}
	if !replies.replied {
		t.Fatal("the clean run did not stamp replied_at")
	}

	// The replay of a job that completed. This is the half that is not
	// at-least-once: it reads the stamp first and stops.
	if err := notifier.Handle(context.Background(), replyJob("item-1")); err != nil {
		t.Fatalf("the replay failed: %v", err)
	}
	if len(fake.Sends()) != 3 {
		t.Errorf("the replay of a completed reply sent %d replies in total, want the same 3",
			len(fake.Sends()))
	}
	if replies.stamps != 1 {
		t.Errorf("replied_at was written %d times, want 1", replies.stamps)
	}
}

// TestTheReplyCarriesTheTitleOrTheReason is the message the person reads on
// their phone, in both outcomes. The link goes out either way, because the
// item is saved either way.
func TestTheReplyCarriesTheTitleOrTheReason(t *testing.T) {
	cases := []struct {
		name  string
		reply Reply
		want  string
	}{
		{
			name:  "an extracted article answers with its title",
			reply: Reply{Title: "Notes you will read again", Extracted: true},
			want:  "Notes you will read again\nhttps://norte.example/library/item-1",
		},
		{
			name:  "a failed extraction says so and still links",
			reply: Reply{Title: "/essays/notes"},
			want:  failedExtractionReply + "\nhttps://norte.example/library/item-1",
		},
		{
			name:  "an extracted article with no title is just the link",
			reply: Reply{Extracted: true},
			want:  "https://norte.example/library/item-1",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			notifier, fake := newNotifierForTest(t, &repliesStub{reply: tc.reply})
			if err := notifier.Handle(context.Background(), replyJob("item-1")); err != nil {
				t.Fatalf("Handle: %v", err)
			}
			sends := fake.Sends()
			if len(sends) != 1 {
				t.Fatalf("the handler sent %d replies, want 1", len(sends))
			}
			if sends[0].Text != tc.want {
				t.Errorf("the reply reads %q, want %q", sends[0].Text, tc.want)
			}
			if sends[0].ChatID != -1001234567890 {
				t.Errorf("the reply went to chat %d, want the message's own", sends[0].ChatID)
			}
		})
	}
}

// TestTheTokenIsNeverInAnErrorTheClientReturns is the other half of "the token
// never appears in a log line": the adapter logs the errors this package
// returns, and the token is a path segment of every request, so the standard
// library's own *url.Error carries it unless something takes it out.
func TestTheTokenIsNeverInAnErrorTheClientReturns(t *testing.T) {
	const token = "7654321:AAHsecretsecretsecret"

	fake := telegramtest.New()
	defer fake.Close()
	fake.FailSends(1)
	live := NewClient(Settings{Token: token, APIBase: fake.URL()})
	err := live.SendMessage(context.Background(), -1, "oi")
	if err == nil {
		t.Fatal("a failing sendMessage returned no error")
	}
	if strings.Contains(err.Error(), token) {
		t.Errorf("the failing send's error carries the token: %v", err)
	}

	// A server that is not there. This is the shape that actually leaks: the
	// transport's error names the whole URL it could not reach.
	fake.Close()
	dead := NewClient(Settings{Token: token, APIBase: fake.URL()})
	if _, err := dead.GetUpdates(context.Background(), 1, 0); err == nil {
		t.Fatal("a poll at a closed server returned no error")
	} else if strings.Contains(err.Error(), token) {
		t.Errorf("the refused poll's error carries the token: %v", err)
	}
}
