package library

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
	"github.com/gabrielassisxyz/norte/server/internal/library/telegram"
	"github.com/gabrielassisxyz/norte/server/internal/library/telegram/telegramtest"
)

// The chat the bot belongs to, and a chat it must ignore.
const (
	libraryTelegramTestChat   = -1001234567890
	libraryTelegramOtherChat  = -1009999999999
	libraryTelegramTestToken  = "7654321:AAHsecretsecretsecretsecret"
	libraryTelegramTestPublic = "https://norte.example"
)

// libraryTelegramHarness is one poller against one fake Telegram, over a
// database of the test's own. Nothing in it reaches the network: the fake is
// an httptest server and the adapter's API base points at it.
type libraryTelegramHarness struct {
	t        *testing.T
	database *core.Database
	dataDir  string
	clock    *clocktest.Clock
	jobs     *core.Jobs
	service  *LibraryService
	store    *libraryTelegramStore
	fake     *telegramtest.Server
	settings telegram.Settings
	logs     *libraryLockedBuffer
	// pollerStore replaces the store the poller writes through, so a test can
	// make a save fail. Nil means the real one.
	pollerStore telegram.Store
}

// libraryLockedBuffer is a log sink the poller goroutine writes while the test
// goroutine reads it.
type libraryLockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *libraryLockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *libraryLockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newLibraryTelegramHarness(t *testing.T) *libraryTelegramHarness {
	t.Helper()
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	fake := telegramtest.New()
	t.Cleanup(fake.Close)

	logs := &libraryLockedBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	jobs := core.NewJobs(database.Writer(), clock, logger)
	deps := app.Deps{
		Database:      database,
		Jobs:          jobs,
		Files:         core.NewFiles(dataDir, database.Writer(), clock),
		Clock:         clock,
		Events:        core.NewEvents(),
		Logger:        logger,
		TelegramToken: libraryTelegramTestToken,
		TelegramChat:  "-1001234567890",
		PublicURL:     libraryTelegramTestPublic,
	}
	settings, err := telegram.ParseSettings(deps.TelegramToken, deps.TelegramChat, deps.PublicURL)
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	// Everything but the API base is what serve would build. The base is the
	// one thing a test has to redirect, because the alternative is a suite
	// that talks to Telegram.
	settings.APIBase = fake.URL()

	return &libraryTelegramHarness{
		t:        t,
		database: database,
		dataDir:  dataDir,
		clock:    clock,
		jobs:     jobs,
		service:  newLibraryServiceFromDeps(deps),
		store:    newLibraryTelegramStore(deps),
		fake:     fake,
		settings: settings,
		logs:     logs,
	}
}

// startPoller runs the adapter until the returned stop is called.
func (h *libraryTelegramHarness) startPoller() (stop func()) {
	h.t.Helper()
	logger := slog.New(slog.NewTextHandler(h.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	var store telegram.Store = h.store
	if h.pollerStore != nil {
		store = h.pollerStore
	}
	adapter := telegram.NewAdapter(h.settings, store, h.clock, logger)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- adapter.Run(ctx) }()
	return func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				h.t.Errorf("the poller stopped with %v", err)
			}
		case <-time.After(20 * time.Second):
			h.t.Fatal("the poller did not stop")
		}
	}
}

// notifier is the reply handler over the same store, with the fake as its
// Telegram.
func (h *libraryTelegramHarness) notifier() *telegram.Notifier {
	return telegram.NewNotifier(h.settings, h.store, nil)
}

// waitFor polls the database until check holds. The poller talks to a real
// httptest server from a goroutine of its own, so this waits on real time; the
// manual clock drives the job worker, not the network.
func (h *libraryTelegramHarness) waitFor(what string, check func() bool) {
	h.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	h.t.Fatalf("the adapter never %s", what)
}

func (h *libraryTelegramHarness) itemCount() int {
	h.t.Helper()
	var count int
	if err := h.database.Reader().QueryRow(`SELECT COUNT(*) FROM library_items`).Scan(&count); err != nil {
		h.t.Fatalf("counting the items: %v", err)
	}
	return count
}

// onlyItem reads the one item the test saved, and fails when there is not
// exactly one -- which is the assertion half the criteria are about.
func (h *libraryTelegramHarness) onlyItem() db.LibraryItem {
	h.t.Helper()
	var id string
	if err := h.database.Reader().QueryRow(`SELECT id FROM library_items`).Scan(&id); err != nil {
		h.t.Fatalf("reading the saved item: %v", err)
	}
	return h.item(id)
}

func (h *libraryTelegramHarness) item(id string) db.LibraryItem {
	h.t.Helper()
	row, err := db.New(h.database.Reader()).GetLibraryItemByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("reading item %s: %v", id, err)
	}
	return row
}

func (h *libraryTelegramHarness) entries(id string) []libraryTelegramMessage {
	h.t.Helper()
	return libraryTelegramEntries(libraryDecodeMeta(h.item(id).Meta))
}

func (h *libraryTelegramHarness) cursor() int64 {
	h.t.Helper()
	offset, err := h.store.UpdateOffset(context.Background())
	if err != nil {
		h.t.Fatalf("reading the cursor: %v", err)
	}
	return offset
}

// markExtracted puts an item in the terminal state an extraction would leave,
// without running one: these tests are about the reply, and a real extraction
// would only add a fetcher and a fixture to the picture.
func (h *libraryTelegramHarness) markExtracted(id, status, title string) {
	h.t.Helper()
	if _, err := h.database.Writer().Exec(
		`UPDATE library_items SET extract_status = ?, title = ?, extracted_at = ? WHERE id = ?`,
		status, title, core.FormatTime(h.clock.Now()), id); err != nil {
		h.t.Fatalf("marking item %s %s: %v", id, status, err)
	}
}

// runReplyJobs runs every queued notify_telegram job through the handler, the
// way the worker would, and reports how many it ran.
func (h *libraryTelegramHarness) runReplyJobs(notifier *telegram.Notifier) int {
	h.t.Helper()
	rows, err := h.database.Reader().Query(
		`SELECT payload FROM core_jobs WHERE kind = ? AND status = 'queued' ORDER BY created_at, id`,
		LibraryNotifyTelegramJobKind)
	if err != nil {
		h.t.Fatalf("reading the reply jobs: %v", err)
	}
	var payloads []string
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			rows.Close()
			h.t.Fatalf("reading a reply job: %v", err)
		}
		payloads = append(payloads, payload)
	}
	rows.Close()
	for _, payload := range payloads {
		if err := notifier.Handle(context.Background(), core.Job{
			ID:          "reply-job",
			Kind:        LibraryNotifyTelegramJobKind,
			Payload:     payload,
			Attempt:     1,
			MaxAttempts: core.JobsMaxAttempts,
		}); err != nil {
			h.t.Fatalf("the reply job failed: %v", err)
		}
	}
	return len(payloads)
}

// TestAMessageFromTheAllowedChatBecomesAnInboxItem is the whole point of the
// adapter: a link sent from the phone is in the library, with the thought that
// came with it as the note.
//
// The ten-second bound the criterion names is not measured here. A figure
// taken inside a worktree says nothing about the machine the bound is about;
// what this proves is that the save happens on the poller's own first pass,
// with no timer and no retry in between.
func TestAMessageFromTheAllowedChatBecomesAnInboxItem(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	stop := harness.startPoller()
	defer stop()

	harness.fake.Deliver(telegramtest.Update{
		UpdateID:  11,
		ChatID:    libraryTelegramTestChat,
		MessageID: 41,
		Text:      "vale para o projeto https://ortaessays.example/essays/notes",
	})
	harness.waitFor("saved the link", func() bool { return harness.itemCount() == 1 })

	item := harness.onlyItem()
	if item.Source != LibrarySourceTelegram {
		t.Errorf("source = %q, want telegram", item.Source)
	}
	if item.Status != "inbox" {
		t.Errorf("status = %q, want inbox", item.Status)
	}
	if item.Url != "https://ortaessays.example/essays/notes" {
		t.Errorf("url = %q, want the link from the message", item.Url)
	}
	if !item.Why.Valid || item.Why.String != "vale para o projeto" {
		t.Errorf("why = %q, want the text around the link", item.Why.String)
	}
	entries := harness.entries(item.ID)
	if len(entries) != 1 {
		t.Fatalf("the item carries %d Telegram messages, want 1", len(entries))
	}
	if entries[0].MessageID.String() != "41" {
		t.Errorf("the recorded message is %s, want 41", entries[0].MessageID.String())
	}
	if entries[0].RepliedAt != nil {
		t.Errorf("the message was recorded as replied to before any reply was sent: %v", *entries[0].RepliedAt)
	}
	harness.waitFor("advanced the cursor", func() bool { return harness.cursor() == 11 })
}

// TestAMessageFromAnotherChatSavesNothingAndStillMovesOn is the sender check.
// The cursor has to move anyway: an update that is refused and not recorded
// would be offered again on every poll, forever.
func TestAMessageFromAnotherChatSavesNothingAndStillMovesOn(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	stop := harness.startPoller()
	defer stop()

	harness.fake.Deliver(telegramtest.Update{
		UpdateID:  7,
		ChatID:    libraryTelegramOtherChat,
		MessageID: 1,
		Text:      "salva isso pra mim https://ortaessays.example/essays/notes",
	})
	harness.waitFor("advanced past the stranger's message", func() bool { return harness.cursor() == 7 })

	if count := harness.itemCount(); count != 0 {
		t.Errorf("a message from another chat produced %d items, want 0", count)
	}
	if sends := harness.fake.Sends(); len(sends) != 0 {
		t.Errorf("a message from another chat was answered: %v", sends)
	}

	// A message with no link in it is the other update that produces nothing.
	harness.fake.Deliver(telegramtest.Update{
		UpdateID:  8,
		ChatID:    libraryTelegramTestChat,
		MessageID: 2,
		Text:      "bom dia",
	})
	harness.waitFor("advanced past the message with no link", func() bool { return harness.cursor() == 8 })
	if count := harness.itemCount(); count != 0 {
		t.Errorf("a message with no link produced %d items, want 0", count)
	}
}

// TestARestartDoesNotSaveTheMessageAgain is what the cursor is for. The fake
// keeps every update it was given and offers the ones at or past the requested
// offset, which is what Telegram does until an offset confirms them -- so a
// poller that started from zero, or from an offset it only held in memory,
// would save the same message twice here.
func TestARestartDoesNotSaveTheMessageAgain(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	stop := harness.startPoller()
	harness.fake.Deliver(telegramtest.Update{
		UpdateID:  21,
		ChatID:    libraryTelegramTestChat,
		MessageID: 41,
		Text:      "https://ortaessays.example/essays/notes",
	})
	harness.waitFor("saved the link", func() bool { return harness.itemCount() == 1 })
	harness.waitFor("advanced the cursor", func() bool { return harness.cursor() == 21 })
	saved := harness.onlyItem().ID
	savedAt := harness.item(saved).UpdatedAt
	stop()

	// Time moves between the two runs, so a second save of the same message
	// would be visible as a later updated_at rather than rewriting the same
	// stamp over itself.
	harness.clock.Advance(time.Minute)
	polledBefore := len(harness.fake.Offsets())

	// A second poller over the same database, as a restart of serve would be.
	restarted := harness.startPoller()
	defer restarted()
	harness.fake.Deliver(telegramtest.Update{
		UpdateID:  22,
		ChatID:    libraryTelegramTestChat,
		MessageID: 42,
		Text:      "https://ortaessays.example/essays/another",
	})
	harness.waitFor("saved the message sent after the restart", func() bool { return harness.itemCount() == 2 })

	// The direct claim: every poll the restarted adapter made asked for the
	// updates after the one the cursor had committed. A poller starting from
	// zero asks for 1 here and is handed update 21 again.
	for i, offset := range harness.fake.Offsets() {
		if i < polledBefore {
			continue
		}
		if offset < 22 {
			t.Errorf("the restarted poller asked from offset %d, want 22 or later", offset)
		}
	}
	if updated := harness.item(saved).UpdatedAt; updated != savedAt {
		t.Errorf("the first item was written again after the restart: updated_at %s, was %s",
			updated, savedAt)
	}
	if entries := harness.entries(saved); len(entries) != 1 {
		t.Errorf("the restart recorded %d messages on the first item, want the original 1", len(entries))
	}
	if cursor := harness.cursor(); cursor != 22 {
		t.Errorf("cursor = %d after the restart, want 22", cursor)
	}
}

// TestADuplicateOfAnExtractedLinkGetsItsOwnReply is the case the save's own
// enqueue exists for. The item is already done, so no extraction will ever run
// again for it, and the reply has to be queued by the save transaction or the
// person waits forever for an answer that nothing owns.
func TestADuplicateOfAnExtractedLinkGetsItsOwnReply(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	outcome, err := harness.service.Save(context.Background(), SaveInput{
		URL:    "https://ortaessays.example/essays/notes",
		Source: LibrarySourceCLI,
	})
	if err != nil {
		t.Fatalf("saving from the CLI: %v", err)
	}
	harness.markExtracted(outcome.ID, "done", "Notes you will read again")

	stop := harness.startPoller()
	defer stop()
	harness.fake.Deliver(telegramtest.Update{
		UpdateID:  31,
		ChatID:    libraryTelegramTestChat,
		MessageID: 41,
		Text:      "https://ortaessays.example/essays/notes de novo",
	})
	harness.waitFor("recorded the message on the existing item", func() bool {
		return len(harness.entries(outcome.ID)) == 1
	})

	if count := harness.itemCount(); count != 1 {
		t.Errorf("the duplicate produced %d rows, want the existing 1", count)
	}
	item := harness.item(outcome.ID)
	if item.Source != LibrarySourceCLI {
		t.Errorf("source = %q, want the cli it was first saved with", item.Source)
	}
	if !item.Why.Valid || item.Why.String != "de novo" {
		t.Errorf("why = %q, want the note that came with the Telegram message", item.Why.String)
	}
	if count := libraryJobCount(t, harness.database, LibraryNotifyTelegramJobKind); count != 1 {
		t.Fatalf("the save enqueued %d replies, want 1", count)
	}

	if ran := harness.runReplyJobs(harness.notifier()); ran != 1 {
		t.Fatalf("%d reply jobs were queued, want 1", ran)
	}
	sends := harness.fake.Sends()
	if len(sends) != 1 {
		t.Fatalf("the duplicate got %d replies, want 1", len(sends))
	}
	want := "Notes you will read again\n" + libraryTelegramTestPublic + "/biblioteca/" + outcome.ID
	if sends[0].Text != want {
		t.Errorf("the reply reads %q, want %q", sends[0].Text, want)
	}
}

// TestTwoMessagesWithTheSameLinkEachGetOneReply is why the reply is keyed by
// the message and not by the item. Both messages are about one row, and both
// people waiting -- the same person, twice -- have to hear back.
func TestTwoMessagesWithTheSameLinkEachGetOneReply(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	stop := harness.startPoller()
	defer stop()

	harness.fake.Deliver(telegramtest.Update{
		UpdateID: 41, ChatID: libraryTelegramTestChat, MessageID: 51,
		Text: "https://ortaessays.example/essays/notes",
	})
	harness.waitFor("saved the link", func() bool { return harness.itemCount() == 1 })
	item := harness.onlyItem().ID

	harness.fake.Deliver(telegramtest.Update{
		UpdateID: 42, ChatID: libraryTelegramTestChat, MessageID: 52,
		Text: "https://ortaessays.example/essays/notes",
	})
	harness.waitFor("recorded the second message", func() bool { return len(harness.entries(item)) == 2 })
	if count := harness.itemCount(); count != 1 {
		t.Errorf("two messages about one link produced %d rows, want 1", count)
	}

	// The extraction's terminal step is what queues the replies for an item
	// that was still pending when the messages arrived.
	harness.markExtracted(item, "done", "Notes you will read again")
	harness.enqueueTerminalReplies(item)
	if count := libraryJobCount(t, harness.database, LibraryNotifyTelegramJobKind); count != 2 {
		t.Fatalf("%d replies were queued, want one per message", count)
	}

	if ran := harness.runReplyJobs(harness.notifier()); ran != 2 {
		t.Fatalf("%d reply jobs ran, want 2", ran)
	}
	sends := harness.fake.Sends()
	if len(sends) != 2 {
		t.Fatalf("two messages got %d replies, want 2", len(sends))
	}
	for _, entry := range harness.entries(item) {
		if entry.RepliedAt == nil || *entry.RepliedAt == "" {
			t.Errorf("message %s was not stamped as replied to", entry.MessageID.String())
		}
	}

	// Every job replayed after it completed. This is the suppression the
	// handler's first step buys.
	if err := harness.replayEveryReply(harness.notifier()); err != nil {
		t.Fatalf("replaying the replies: %v", err)
	}
	if len(harness.fake.Sends()) != 2 {
		t.Errorf("the replays brought the total to %d replies, want the same 2", len(harness.fake.Sends()))
	}
}

// TestTheReplyFollowsTheExtractionsOutcome is the message the person reads,
// from both terminal states, over the real store.
func TestTheReplyFollowsTheExtractionsOutcome(t *testing.T) {
	cases := []struct {
		name   string
		status string
		title  string
		want   func(id string) string
	}{
		{
			name:   "a successful extraction answers with the title and the link",
			status: "done",
			title:  "Notes you will read again",
			want: func(id string) string {
				return "Notes you will read again\n" + libraryTelegramTestPublic + "/biblioteca/" + id
			},
		},
		{
			name:   "a final failure says the text could not be read, and still links",
			status: "failed",
			title:  "/essays/notes",
			want: func(id string) string {
				return "salvo, mas não consegui extrair o texto\n" +
					libraryTelegramTestPublic + "/biblioteca/" + id
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryTelegramHarness(t)
			stop := harness.startPoller()
			defer stop()
			harness.fake.Deliver(telegramtest.Update{
				UpdateID: 51, ChatID: libraryTelegramTestChat, MessageID: 61,
				Text: "https://ortaessays.example/essays/notes",
			})
			harness.waitFor("saved the link", func() bool { return harness.itemCount() == 1 })
			item := harness.onlyItem().ID

			harness.markExtracted(item, tc.status, tc.title)
			harness.enqueueTerminalReplies(item)
			if ran := harness.runReplyJobs(harness.notifier()); ran != 1 {
				t.Fatalf("%d reply jobs ran, want 1", ran)
			}
			sends := harness.fake.Sends()
			if len(sends) != 1 {
				t.Fatalf("the message got %d replies, want exactly 1", len(sends))
			}
			if sends[0].Text != tc.want(item) {
				t.Errorf("the reply reads %q, want %q", sends[0].Text, tc.want(item))
			}
			if sends[0].ChatID != libraryTelegramTestChat {
				t.Errorf("the reply went to chat %d, want the message's own", sends[0].ChatID)
			}
		})
	}
}

// TestARunningReplyJobStopsOnceTheMessageIsStamped is the real store's half of
// the suppression: the second run reads replied_at from the item's meta and
// sends nothing. The handler's own ordering is proved in the telegram package,
// over its ports; this proves the implementation of those ports.
func TestARunningReplyJobStopsOnceTheMessageIsStamped(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	stop := harness.startPoller()
	defer stop()
	harness.fake.Deliver(telegramtest.Update{
		UpdateID: 61, ChatID: libraryTelegramTestChat, MessageID: 71,
		Text: "https://ortaessays.example/essays/notes",
	})
	harness.waitFor("saved the link", func() bool { return harness.itemCount() == 1 })
	item := harness.onlyItem().ID
	harness.markExtracted(item, "done", "Notes you will read again")
	harness.enqueueTerminalReplies(item)

	notifier := harness.notifier()
	if ran := harness.runReplyJobs(notifier); ran != 1 {
		t.Fatalf("%d reply jobs ran, want 1", ran)
	}
	if len(harness.fake.Sends()) != 1 {
		t.Fatalf("the first run sent %d replies, want 1", len(harness.fake.Sends()))
	}
	if err := harness.replayEveryReply(notifier); err != nil {
		t.Fatalf("replaying the reply: %v", err)
	}
	if sends := harness.fake.Sends(); len(sends) != 1 {
		t.Errorf("the replay of a completed reply brought the total to %d, want 1", len(sends))
	}
}

// TestTheTokenNeverReachesALogLine covers the whole adapter, not just the
// client: a poll that fails is logged, and the token is in the path of every
// request it made.
func TestTheTokenNeverReachesALogLine(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	// A base nothing is listening on, so every poll fails and is logged.
	harness.settings.APIBase = "http://127.0.0.1:1"
	stop := harness.startPoller()
	harness.waitFor("logged a failing poll", func() bool {
		return strings.Contains(harness.logs.String(), "the Telegram poll failed")
	})
	// The backoff runs on the injected clock, so the second poll only happens
	// when the test moves time.
	harness.clock.Advance(10 * time.Second)
	stop()

	logs := harness.logs.String()
	if logs == "" {
		t.Fatal("the adapter logged nothing, so this proves nothing")
	}
	if strings.Contains(logs, libraryTelegramTestToken) {
		t.Errorf("the token reached a log line:\n%s", logs)
	}
	if strings.Contains(logs, "AAHsecret") {
		t.Errorf("part of the token reached a log line:\n%s", logs)
	}
}

// TestServeRefusesATelegramChatThatIsNotANumber is the startup check, through
// the real command line. A bot with a chat id it cannot compare against would
// start, poll, accept nothing and answer nothing -- the one failure a person
// cannot tell apart from Telegram being slow.
func TestServeRefusesATelegramChatThatIsNotANumber(t *testing.T) {
	cases := []struct {
		name      string
		chat      string
		publicURL string
		wants     string
	}{
		{name: "a chat id that is a word", chat: "abc", publicURL: "https://norte.example", wants: "NORTE_TELEGRAM_CHAT"},
		{name: "a relative public URL", chat: "-1001234567890", publicURL: "/biblioteca", wants: "NORTE_PUBLIC_URL"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := t.TempDir()
			t.Setenv("NORTE_DATA", dataDir)
			t.Setenv("NORTE_MODULES", "library")
			t.Setenv("XDG_CONFIG_HOME", t.TempDir())
			t.Setenv("HOME", t.TempDir())
			t.Setenv("NORTE_LISTEN", "127.0.0.1:0")
			t.Setenv("NORTE_TELEGRAM_TOKEN", libraryTelegramTestToken)
			t.Setenv("NORTE_TELEGRAM_CHAT", tc.chat)
			t.Setenv("NORTE_PUBLIC_URL", tc.publicURL)

			root := app.NewRootCommand()
			var out bytes.Buffer
			root.SetArgs([]string{"serve"})
			root.SetOut(&out)
			root.SetErr(&out)
			done := make(chan error, 1)
			go func() { done <- root.ExecuteContext(context.Background()) }()
			select {
			case err := <-done:
				if err == nil {
					t.Fatalf("serve started with %s = %q:\n%s", tc.wants, tc.chat+tc.publicURL, out.String())
				}
				if !strings.Contains(err.Error(), tc.wants) {
					t.Errorf("serve failed without naming %s: %v", tc.wants, err)
				}
				if strings.Contains(err.Error(), libraryTelegramTestToken) {
					t.Errorf("the startup error carries the token: %v", err)
				}
			case <-time.After(30 * time.Second):
				t.Fatalf("serve neither started nor exited:\n%s", out.String())
			}
		})
	}
}

// TestNoTokenMeansNoAdapterAndNoReplyHandler is the other side of the same
// switch: with no bot configured, nothing is started and the notify_telegram
// jobs a terminal extraction may already have queued stay queued, untouched.
func TestNoTokenMeansNoAdapterAndNoReplyHandler(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	deps := app.Deps{
		Database: database,
		Jobs:     core.NewJobs(database.Writer(), clock, nil),
		Files:    core.NewFiles(dataDir, database.Writer(), clock),
		Clock:    clock,
		Events:   core.NewEvents(),
	}
	adapter, err := newLibraryTelegramAdapter(deps)
	if err != nil {
		t.Fatalf("building the adapter without a token: %v", err)
	}
	if adapter != nil {
		t.Error("an adapter was built with no token to poll with")
	}
	if _, ok := (&LibraryModule{}).JobHandlers(deps)[LibraryNotifyTelegramJobKind]; ok {
		t.Error("the reply handler was registered with no bot to reply through")
	}

	// A token with a chat id that is not a number is a configuration error,
	// and the module reports it from Start so that serve exits.
	deps.TelegramToken = libraryTelegramTestToken
	deps.TelegramChat = "abc"
	deps.PublicURL = libraryTelegramTestPublic
	if err := (&LibraryModule{}).Start(context.Background(), deps); err == nil {
		t.Error("Start accepted a chat id that is not a number")
	} else if !strings.Contains(err.Error(), "NORTE_TELEGRAM_CHAT") {
		t.Errorf("Start failed without naming NORTE_TELEGRAM_CHAT: %v", err)
	}
	if _, ok := (&LibraryModule{}).JobHandlers(deps)[LibraryNotifyTelegramJobKind]; ok {
		t.Error("the reply handler was registered over a configuration Start refuses")
	}
}

// enqueueTerminalReplies queues the replies a terminal extraction would queue,
// through the extraction's own code, so the test exercises the enqueue the
// shipped path uses rather than a copy of it.
func (h *libraryTelegramHarness) enqueueTerminalReplies(itemID string) {
	h.t.Helper()
	extraction := NewLibraryExtraction(LibraryExtractionOptions{
		Database: h.database,
		Files:    core.NewFiles(h.dataDir, h.database.Writer(), h.clock),
		Jobs:     h.jobs,
		Clock:    h.clock,
		Events:   core.NewEvents(),
	})
	tx, err := h.database.Writer().BeginTx(context.Background(), nil)
	if err != nil {
		h.t.Fatalf("beginning the enqueue transaction: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	meta := libraryDecodeMeta(h.item(itemID).Meta)
	if err := extraction.enqueueTelegramReplies(context.Background(), tx, itemID, meta); err != nil {
		h.t.Fatalf("enqueueing the replies of %s: %v", itemID, err)
	}
	if err := tx.Commit(); err != nil {
		h.t.Fatalf("committing the enqueue: %v", err)
	}
}

// replayEveryReply runs the handler again for every reply job on the item,
// whatever its status -- which is what a crash after the send and before the
// job's status write leaves the queue to do.
func (h *libraryTelegramHarness) replayEveryReply(notifier *telegram.Notifier) error {
	h.t.Helper()
	rows, err := h.database.Reader().Query(
		`SELECT payload FROM core_jobs WHERE kind = ? ORDER BY created_at, id`,
		LibraryNotifyTelegramJobKind)
	if err != nil {
		return err
	}
	var payloads []string
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			rows.Close()
			return err
		}
		payloads = append(payloads, payload)
	}
	rows.Close()
	for _, payload := range payloads {
		if err := notifier.Handle(context.Background(), core.Job{
			ID:          "replay",
			Kind:        LibraryNotifyTelegramJobKind,
			Payload:     payload,
			Attempt:     1,
			MaxAttempts: core.JobsMaxAttempts,
		}); err != nil {
			return err
		}
	}
	return nil
}

// TestEveryPollAsksForASmallBatch: an answer past the client's read cap is cut
// mid-JSON and the same batch would be fetched forever, so the request itself
// has to bound the batch.
func TestEveryPollAsksForASmallBatch(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	stop := harness.startPoller()
	defer stop()
	harness.waitFor("polled", func() bool { return len(harness.fake.Limits()) > 0 })
	for _, limit := range harness.fake.Limits() {
		if limit != "20" {
			t.Errorf("a poll sent limit=%q, want 20", limit)
		}
	}
}

// libraryFailingSaveStore refuses to save a link whose URL contains "poison",
// the way a database that keeps failing on one message would.
type libraryFailingSaveStore struct {
	telegram.Store
	mu       sync.Mutex
	attempts int
}

func (s *libraryFailingSaveStore) SaveLink(ctx context.Context, capture telegram.Capture) error {
	if strings.Contains(capture.URL, "poison") {
		s.mu.Lock()
		s.attempts++
		s.mu.Unlock()
		return errors.New("the database is unhappy")
	}
	return s.Store.SaveLink(ctx, capture)
}

func (s *libraryFailingSaveStore) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attempts
}

// TestAnUpdateThatKeepsFailingIsSkippedAfterFiveTries: a save that never
// succeeds must not hold the cursor, and the message behind it, forever.
func TestAnUpdateThatKeepsFailingIsSkippedAfterFiveTries(t *testing.T) {
	harness := newLibraryTelegramHarness(t)
	failing := &libraryFailingSaveStore{Store: harness.store}
	harness.pollerStore = failing
	stop := harness.startPoller()
	defer stop()

	harness.fake.Deliver(telegramtest.Update{
		UpdateID: 5, ChatID: libraryTelegramTestChat, MessageID: 1,
		Text: "https://ortaessays.example/poison",
	})
	harness.fake.Deliver(telegramtest.Update{
		UpdateID: 6, ChatID: libraryTelegramTestChat, MessageID: 2,
		Text: "https://ortaessays.example/fine",
	})
	// The backoff runs on the injected clock, so time is moved until the
	// sixth poll asks past the poisoned update.
	harness.waitFor("moved past the poisoned update", func() bool {
		harness.clock.Advance(10 * time.Second)
		return harness.cursor() >= 6 && harness.itemCount() == 1
	})
	if got := failing.count(); got != 5 {
		t.Errorf("the poisoned update was tried %d times, want 5", got)
	}
	if item := harness.onlyItem(); item.Url != "https://ortaessays.example/fine" {
		t.Errorf("the saved item is %q, want the message behind the poisoned one", item.Url)
	}
	logs := harness.logs.String()
	if !strings.Contains(logs, "is skipped") || !strings.Contains(logs, "update_id=5") {
		t.Errorf("the skip was not logged with the update id:\n%s", logs)
	}
	if strings.Contains(logs, libraryTelegramTestToken) || strings.Contains(logs, "poison") {
		t.Errorf("the skip line carries the token or the message:\n%s", logs)
	}
}
