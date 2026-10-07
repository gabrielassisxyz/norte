package core_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

var jobsTestStart = time.Date(2026, 3, 9, 17, 0, 0, 0, time.UTC)

func newJobsTestLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func newJobsTestDatabase(t *testing.T, clock core.Clock) *core.Database {
	t.Helper()
	database, err := core.OpenDatabase(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil && !errors.Is(err, sql.ErrConnDone) {
			t.Errorf("closing the database: %v", err)
		}
	})
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	return database
}

func enqueueJobsTestJob(t *testing.T, queue *core.Jobs, kind, payload, dedupe string) string {
	t.Helper()
	database := jobsTestDatabaseOf(t, queue)
	tx, err := database.Writer().Begin()
	if err != nil {
		t.Fatalf("beginning a transaction: %v", err)
	}
	id, err := queue.Enqueue(context.Background(), tx, kind, payload, dedupe)
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("enqueueing a job of kind %s: %v", kind, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("committing the enqueue: %v", err)
	}
	return id
}

// jobsTestDatabaseOf recovers the database behind a queue for helpers that
// need a raw handle. Queues in tests are always built by newJobsTestQueue,
// which records the mapping.
var jobsTestDatabases sync.Map

func newJobsTestQueue(t *testing.T, database *core.Database, clock core.Clock) *core.Jobs {
	t.Helper()
	queue := core.NewJobs(database.Writer(), clock, newJobsTestLogger())
	jobsTestDatabases.Store(queue, database)
	return queue
}

func jobsTestDatabaseOf(t *testing.T, queue *core.Jobs) *core.Database {
	t.Helper()
	value, ok := jobsTestDatabases.Load(queue)
	if !ok {
		t.Fatal("no database recorded for this queue")
	}
	return value.(*core.Database)
}

type jobsTestRow struct {
	status      string
	attempts    int64
	availableAt string
	leaseUntil  sql.NullString
	leaseOwner  sql.NullString
	lastError   sql.NullString
	startedAt   sql.NullString
	finishedAt  sql.NullString
	payload     string
	kind        string
}

func readJobsTestRow(t *testing.T, database *core.Database, id string) jobsTestRow {
	t.Helper()
	var row jobsTestRow
	err := database.Reader().QueryRow(
		`SELECT status, attempts, available_at, lease_until, lease_owner, last_error, started_at, finished_at, payload, kind FROM core_jobs WHERE id = ?`,
		id).Scan(&row.status, &row.attempts, &row.availableAt, &row.leaseUntil, &row.leaseOwner, &row.lastError, &row.startedAt, &row.finishedAt, &row.payload, &row.kind)
	if err != nil {
		t.Fatalf("reading job %s: %v", id, err)
	}
	return row
}

func countJobsTestRows(t *testing.T, database *core.Database, query string, args ...any) int {
	t.Helper()
	var count int
	if err := database.Reader().QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("counting with %q: %v", query, err)
	}
	return count
}

// waitJobsTestCondition spins until check holds, yielding to the worker
// goroutine each lap. No waiting primitive is used: the manual clock fires
// synchronously and channels signal handler calls.
func waitJobsTestCondition(t *testing.T, check func() bool, message string) {
	t.Helper()
	for i := 0; i < 20000; i++ {
		if check() {
			return
		}
		runtime.Gosched()
	}
	t.Fatalf("timed out waiting: %s", message)
}

func advanceJobsTestClock(clock *clocktest.Clock, d time.Duration) {
	clock.Advance(d)
	for i := 0; i < 500; i++ {
		runtime.Gosched()
	}
}

// waitJobsTestRetryScheduled waits until the worker has recorded the given
// number of failed attempts and put the job back in the queue.
func waitJobsTestRetryScheduled(t *testing.T, database *core.Database, id string, attempts int) {
	t.Helper()
	waitJobsTestCondition(t, func() bool {
		row := readJobsTestRow(t, database, id)
		return row.status == "queued" && row.attempts == int64(attempts)
	}, fmt.Sprintf("failure %d recorded and the retry scheduled", attempts))
}

// advanceJobsTestClockUntilCall moves the clock by at least d, then on in
// one-second steps until the handler runs again, so a poll timer armed a moment
// late still fires instead of waiting forever for time that never comes.
func advanceJobsTestClockUntilCall(t *testing.T, clock *clocktest.Clock, calls <-chan jobsTestCall, d time.Duration) jobsTestCall {
	t.Helper()
	advanceJobsTestClock(clock, d)
	for i := 0; i < 600; i++ {
		select {
		case call := <-calls:
			return call
		case <-time.After(5 * time.Millisecond):
		}
		advanceJobsTestClock(clock, time.Second)
	}
	t.Fatal("the handler did not run again after the clock moved past the retry")
	return jobsTestCall{}
}

type jobsTestCall struct {
	attempt int
	max     int
}

func TestJobsRetryBackoffEndsDoneWithThreeAttempts(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	calls := make(chan jobsTestCall, 10)
	failures := 0
	queue.Register("extract", func(_ context.Context, job core.Job) error {
		calls <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		failures++
		if failures <= 2 {
			return fmt.Errorf("fetch https://example.invalid/page?token=secret failed")
		}
		return nil
	})

	id := enqueueJobsTestJob(t, queue, "extract", `{"url":"https://example.invalid/page"}`, "")
	workerDone := make(chan error, 1)
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-backoff")
	go func() { workerDone <- worker.Run(workerCtx) }()

	// First attempt runs at the start instant and fails.
	first := <-calls
	if first.attempt != 1 || first.max != 3 {
		t.Fatalf("first call saw Attempt=%d MaxAttempts=%d, want 1 and 3", first.attempt, first.max)
	}
	waitJobsTestCondition(t, func() bool {
		row := readJobsTestRow(t, database, id)
		return row.status == "queued" && row.attempts == 1
	}, "the first failure returning to queued")
	firstRow := readJobsTestRow(t, database, id)
	wantFirst := core.FormatTime(jobsTestStart.Add(time.Minute))
	if firstRow.availableAt != wantFirst {
		t.Fatalf("available_at after the first failure = %s, want %s", firstRow.availableAt, wantFirst)
	}
	if !strings.Contains(firstRow.lastError.String, "https://example.invalid/page") {
		t.Errorf("last_error = %q, want the redacted URL without its query", firstRow.lastError.String)
	}
	if strings.Contains(firstRow.lastError.String, "token=secret") {
		t.Errorf("last_error = %q, want the query stripped", firstRow.lastError.String)
	}

	advanceJobsTestClock(clock, time.Minute)
	second := <-calls
	if second.attempt != 2 || second.max != 3 {
		t.Fatalf("second call saw Attempt=%d MaxAttempts=%d, want 2 and 3", second.attempt, second.max)
	}
	waitJobsTestCondition(t, func() bool {
		row := readJobsTestRow(t, database, id)
		return row.status == "queued" && row.attempts == 2
	}, "the second failure returning to queued")
	secondRow := readJobsTestRow(t, database, id)
	wantSecond := core.FormatTime(jobsTestStart.Add(time.Minute).Add(5 * time.Minute))
	if secondRow.availableAt != wantSecond {
		t.Fatalf("available_at after the second failure = %s, want %s", secondRow.availableAt, wantSecond)
	}

	advanceJobsTestClock(clock, 5*time.Minute)
	third := <-calls
	if third.attempt != 3 || third.max != 3 {
		t.Fatalf("third call saw Attempt=%d MaxAttempts=%d, want 3 and 3", third.attempt, third.max)
	}
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "done"
	}, "the third attempt marking done")
	final := readJobsTestRow(t, database, id)
	if final.attempts != 3 {
		t.Errorf("attempts = %d, want 3", final.attempts)
	}
	if !final.finishedAt.Valid || final.finishedAt.String == "" {
		t.Error("finished_at is empty on a done job")
	}
	workerStop()
	<-workerDone
}

func TestJobsThreeFailuresLeaveFailed(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	calls := make(chan jobsTestCall, 10)
	queue.Register("fetch", func(_ context.Context, job core.Job) error {
		calls <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		return fmt.Errorf("boom %d", job.Attempt)
	})

	id := enqueueJobsTestJob(t, queue, "fetch", "{}", "")
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-fail3")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	// Each failure is recorded, and the worker's next poll timer armed, a
	// moment after the handler returns. Advancing the clock before that left the
	// retry scheduled after the new "now" with no timer due, and the test hung,
	// so wait for the failure to land before moving time.
	<-calls
	waitJobsTestRetryScheduled(t, database, id, 1)
	advanceJobsTestClockUntilCall(t, clock, calls, time.Minute)
	waitJobsTestRetryScheduled(t, database, id, 2)
	advanceJobsTestClockUntilCall(t, clock, calls, 5*time.Minute)
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "failed"
	}, "the third failure marking failed")
	row := readJobsTestRow(t, database, id)
	if row.attempts != 3 {
		t.Errorf("attempts = %d, want 3", row.attempts)
	}
	if !row.finishedAt.Valid || row.finishedAt.String == "" {
		t.Error("finished_at is empty on a failed job")
	}
	if !strings.Contains(row.lastError.String, "boom 3") {
		t.Errorf("last_error = %q, want the last error", row.lastError.String)
	}
	workerStop()
	<-workerDone
}

func TestJobsPermanentErrorFailsAtOnce(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	calls := make(chan jobsTestCall, 10)
	queue.Register("parse", func(_ context.Context, job core.Job) error {
		calls <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		return core.Permanent(fmt.Errorf("malformed input"))
	})

	id := enqueueJobsTestJob(t, queue, "parse", "{}", "")
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-perm")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	<-calls
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "failed"
	}, "the permanent error marking failed")
	row := readJobsTestRow(t, database, id)
	if row.attempts != 1 {
		t.Errorf("attempts = %d, want exactly one attempt", row.attempts)
	}
	if !strings.Contains(row.lastError.String, "malformed input") {
		t.Errorf("last_error = %q, want the permanent error", row.lastError.String)
	}
	for i := 0; i < 10; i++ {
		advanceJobsTestClock(clock, time.Minute)
	}
	select {
	case extra := <-calls:
		t.Fatalf("the handler ran again with Attempt=%d, want exactly one attempt", extra.attempt)
	default:
	}
	workerStop()
	<-workerDone
}

func TestJobsReclaimsADeadWorkerThenCompletes(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	nowText := core.FormatTime(jobsTestStart)
	pastLease := core.FormatTime(jobsTestStart.Add(-time.Minute))
	id := core.NewID()
	if _, err := database.Writer().Exec(
		`INSERT INTO core_jobs (id, kind, payload, dedupe_key, status, attempts, available_at, lease_until, lease_owner, last_error, created_at, started_at, finished_at)
		 VALUES (?, 'extract', '{}', NULL, 'running', 1, ?, ?, 'dead-owner', NULL, ?, ?, NULL)`,
		id, nowText, pastLease, nowText, nowText); err != nil {
		t.Fatalf("inserting the dead job: %v", err)
	}

	called := make(chan struct{}, 1)
	queue.Register("extract", func(_ context.Context, job core.Job) error {
		called <- struct{}{}
		return nil
	})
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-reclaim")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	<-called
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "done"
	}, "the reclaimed job completing")
	workerStop()
	<-workerDone
}

func TestJobsRenewsLeaseWhileHandlerBlocks(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	queue.Register("extract", func(_ context.Context, _ core.Job) error {
		started <- struct{}{}
		<-release
		return nil
	})
	id := enqueueJobsTestJob(t, queue, "extract", "{}", "")
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-renew")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	<-started
	initial := readJobsTestRow(t, database, id)
	if !initial.leaseUntil.Valid {
		t.Fatal("the claimed job carries no lease")
	}
	advanceJobsTestClock(clock, 3*time.Minute)
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).leaseUntil.String != initial.leaseUntil.String
	}, "the lease being extended while the handler blocks")
	renewed := readJobsTestRow(t, database, id)
	if renewed.status != "running" {
		t.Fatalf("status = %s, want running while the handler blocks", renewed.status)
	}
	if renewed.leaseUntil.String <= clock.Now().Add(time.Minute).Format(core.TimeLayout) && renewed.leaseUntil.String <= initial.leaseUntil.String {
		t.Errorf("lease_until = %s, want it extended past %s", renewed.leaseUntil.String, initial.leaseUntil.String)
	}
	close(release)
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "done"
	}, "the released handler completing")
	workerStop()
	<-workerDone
}

func TestJobsDedupeYieldsOneRowUntilDone(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	first := enqueueJobsTestJob(t, queue, "fetch", "{}", "page:1")
	second := enqueueJobsTestJob(t, queue, "fetch", "{}", "page:1")
	if first != second {
		t.Fatalf("two enqueues with the same key returned %s and %s, want the same id", first, second)
	}
	if got := countJobsTestRows(t, database, `SELECT count(*) FROM core_jobs`); got != 1 {
		t.Fatalf("found %d rows, want one", got)
	}
	if _, err := database.Writer().Exec(`UPDATE core_jobs SET status = 'done', finished_at = ? WHERE id = ?`,
		core.FormatTime(jobsTestStart), first); err != nil {
		t.Fatalf("finishing the first job: %v", err)
	}
	third := enqueueJobsTestJob(t, queue, "fetch", "{}", "page:1")
	if third == first {
		t.Fatalf("a third enqueue after done returned %s, want a new row", third)
	}
	if got := countJobsTestRows(t, database, `SELECT count(*) FROM core_jobs`); got != 2 {
		t.Fatalf("found %d rows, want two after the re-enqueue", got)
	}
}

func TestJobsUnregisteredKindStaysQueued(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)
	queue.Register("other", func(_ context.Context, _ core.Job) error { return nil })

	id := enqueueJobsTestJob(t, queue, "ghost", "{}", "")
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-ghost")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	for i := 0; i < 10; i++ {
		advanceJobsTestClock(clock, time.Second)
	}
	// Let the tenth cycle land.
	waitJobsTestCondition(t, func() bool {
		return true
	}, "unreachable")
	row := readJobsTestRow(t, database, id)
	if row.status != "queued" {
		t.Errorf("status = %s, want queued for an unregistered kind", row.status)
	}
	if row.attempts != 0 {
		t.Errorf("attempts = %d, want zero for an untouched job", row.attempts)
	}
	workerStop()
	<-workerDone
}

func TestJobsRetryMovesFailedBackToQueued(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	failed := core.NewID()
	stamp := core.FormatTime(jobsTestStart)
	if _, err := database.Writer().Exec(
		`INSERT INTO core_jobs (id, kind, payload, status, attempts, available_at, created_at, last_error, finished_at)
		 VALUES (?, 'fetch', '{}', 'failed', 3, ?, ?, 'boom', ?)`,
		failed, stamp, stamp, stamp); err != nil {
		t.Fatalf("inserting the failed job: %v", err)
	}
	if err := queue.RetryJob(context.Background(), failed); err != nil {
		t.Fatalf("retrying the failed job: %v", err)
	}
	row := readJobsTestRow(t, database, failed)
	if row.status != "queued" || row.attempts != 0 {
		t.Errorf("after retry status=%s attempts=%d, want queued and zero", row.status, row.attempts)
	}

	done := core.NewID()
	if _, err := database.Writer().Exec(
		`INSERT INTO core_jobs (id, kind, payload, status, attempts, available_at, created_at, finished_at)
		 VALUES (?, 'fetch', '{}', 'done', 1, ?, ?, ?)`,
		done, stamp, stamp, stamp); err != nil {
		t.Fatalf("inserting the done job: %v", err)
	}
	if err := queue.RetryJob(context.Background(), done); err == nil {
		t.Fatal("retrying a done job succeeded, want a non-zero exit")
	}
	after := readJobsTestRow(t, database, done)
	if after.status != "done" || after.attempts != 1 {
		t.Errorf("retrying a done job changed it to status=%s attempts=%d", after.status, after.attempts)
	}
}

func TestJobsRetryRefusesWhenDedupeKeyIsHeld(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	stamp := core.FormatTime(jobsTestStart)
	failed := core.NewID()
	if _, err := database.Writer().Exec(
		`INSERT INTO core_jobs (id, kind, payload, dedupe_key, status, attempts, available_at, created_at, last_error, finished_at)
		 VALUES (?, 'fetch', '{}', 'page:9', 'failed', 3, ?, ?, 'boom', ?)`,
		failed, stamp, stamp, stamp); err != nil {
		t.Fatalf("inserting the failed job: %v", err)
	}
	blocking := core.NewID()
	if _, err := database.Writer().Exec(
		`INSERT INTO core_jobs (id, kind, payload, dedupe_key, status, attempts, available_at, created_at)
		 VALUES (?, 'fetch', '{}', 'page:9', 'queued', 0, ?, ?)`,
		blocking, stamp, stamp); err != nil {
		t.Fatalf("inserting the blocking job: %v", err)
	}
	err := queue.RetryJob(context.Background(), failed)
	if err == nil {
		t.Fatal("retrying past a held dedupe key succeeded, want a refusal")
	}
	if !strings.Contains(err.Error(), blocking) {
		t.Errorf("the refusal named %q, want it to name the blocking job %s", err.Error(), blocking)
	}
	if got := readJobsTestRow(t, database, failed); got.status != "failed" {
		t.Errorf("the failed job moved to %s, want it unchanged", got.status)
	}
	if got := readJobsTestRow(t, database, blocking); got.status != "queued" {
		t.Errorf("the blocking job moved to %s, want it unchanged", got.status)
	}
}

func TestJobsWorkerSourceUsesOnlyTheInjectedClock(t *testing.T) {
	path := filepath.Join("jobs.go")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the worker source: %v", err)
	}
	for _, banned := range []string{"time." + "Sleep", "time." + "After", "time." + "NewTicker"} {
		if strings.Contains(string(raw), banned) {
			t.Errorf("jobs.go contains %s, want only the injected clock", banned)
		}
	}
}

func TestJobsCleanShutdownCostsNoAttempt(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	started := make(chan jobsTestCall, 10)
	queue.Register("extract", func(ctx context.Context, job core.Job) error {
		started <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		<-ctx.Done()
		return ctx.Err()
	})
	id := enqueueJobsTestJob(t, queue, "extract", "{}", "")

	workerCtx, workerStop := context.WithCancel(context.Background())
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-shutdown")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	first := <-started
	if first.attempt != 1 {
		t.Fatalf("first attempt = %d, want 1", first.attempt)
	}
	workerStop()
	<-workerDone
	waitJobsTestCondition(t, func() bool {
		row := readJobsTestRow(t, database, id)
		return row.status == "queued"
	}, "the shutdown releasing the lease")
	released := readJobsTestRow(t, database, id)
	if released.attempts != 0 {
		t.Fatalf("attempts after release = %d, want zero so a restart costs nothing", released.attempts)
	}

	secondQueue := newJobsTestQueue(t, database, clock)
	secondQueue.Register("extract", func(_ context.Context, job core.Job) error {
		started <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		return nil
	})
	secondCtx, secondStop := context.WithCancel(context.Background())
	defer secondStop()
	secondWorker := core.NewJobsWorker(secondQueue, clock, newJobsTestLogger(), "owner-restart")
	secondDone := make(chan error, 1)
	go func() { secondDone <- secondWorker.Run(secondCtx) }()

	second := <-started
	if second.attempt != 1 {
		t.Errorf("the restarted attempt = %d, want the same Attempt 1", second.attempt)
	}
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "done"
	}, "the restarted job completing")
	secondStop()
	<-secondDone
}

func TestJobsDrainDeadlineLeavesLeaseUntilExpiry(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	started := make(chan jobsTestCall, 10)
	hold := make(chan struct{})
	queue.Register("extract", func(_ context.Context, job core.Job) error {
		started <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		<-hold
		return nil
	})
	id := enqueueJobsTestJob(t, queue, "extract", "{}", "")

	workerCtx, workerStop := context.WithCancel(context.Background())
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-drain")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	<-started
	initial := readJobsTestRow(t, database, id)
	workerStop()
	for i := 0; i < 20; i++ {
		select {
		case <-workerDone:
			goto drained
		default:
		}
		advanceJobsTestClock(clock, time.Second)
	}
	t.Fatal("the first worker never returned after the drain deadline")
drained:
	afterDrain := readJobsTestRow(t, database, id)
	if afterDrain.status != "running" {
		t.Fatalf("status = %s after the missed drain, want running", afterDrain.status)
	}
	if afterDrain.leaseUntil.String != initial.leaseUntil.String {
		t.Errorf("lease_until moved to %s, want it never released early", afterDrain.leaseUntil.String)
	}

	secondStarted := make(chan jobsTestCall, 10)
	secondQueue := newJobsTestQueue(t, database, clock)
	secondQueue.Register("extract", func(_ context.Context, job core.Job) error {
		secondStarted <- jobsTestCall{attempt: job.Attempt, max: job.MaxAttempts}
		return nil
	})
	secondCtx, secondStop := context.WithCancel(context.Background())
	defer secondStop()
	secondWorker := core.NewJobsWorker(secondQueue, clock, newJobsTestLogger(), "owner-second")
	secondDone := make(chan error, 1)
	go func() { secondDone <- secondWorker.Run(secondCtx) }()

	advanceJobsTestClock(clock, time.Second)
	select {
	case extra := <-secondStarted:
		t.Fatalf("the second worker claimed early with Attempt=%d", extra.attempt)
	default:
	}
	var next jobsTestCall
	found := false
	for i := 0; i < 300; i++ {
		select {
		case next = <-secondStarted:
			found = true
		default:
		}
		if found {
			break
		}
		advanceJobsTestClock(clock, time.Second)
	}
	if !found {
		t.Fatal("the second worker never claimed after the lease expired")
	}
	if next.attempt != 2 {
		t.Errorf("the reclaimed attempt = %d, want Attempt+1", next.attempt)
	}
	close(hold)
	waitJobsTestCondition(t, func() bool {
		return readJobsTestRow(t, database, id).status == "done"
	}, "the reclaimed job completing")
	secondStop()
	<-secondDone
}

func TestJobsEnqueuedWhileIdleClaimsWithinOneSecond(t *testing.T) {
	clock := clocktest.New(jobsTestStart)
	database := newJobsTestDatabase(t, clock)
	queue := newJobsTestQueue(t, database, clock)

	called := make(chan struct{}, 1)
	queue.Register("extract", func(_ context.Context, _ core.Job) error {
		called <- struct{}{}
		return nil
	})
	workerCtx, workerStop := context.WithCancel(context.Background())
	defer workerStop()
	worker := core.NewJobsWorker(queue, clock, newJobsTestLogger(), "owner-idle")
	workerDone := make(chan error, 1)
	go func() { workerDone <- worker.Run(workerCtx) }()

	advanceJobsTestClock(clock, time.Second)
	enqueueJobsTestJob(t, queue, "extract", "{}", "")
	advanceJobsTestClock(clock, time.Second)
	waitJobsTestCondition(t, func() bool {
		select {
		case <-called:
			return true
		default:
			return false
		}
	}, "the idle worker claiming within one second")
	workerStop()
	<-workerDone
}

func TestWorkersDoNotDoubleClaim(t *testing.T) {
	database := newJobsTestDatabase(t, core.SystemClock())
	queue := core.NewJobs(database.Writer(), core.SystemClock(), newJobsTestLogger())

	const total = 50
	for i := 0; i < total; i++ {
		tx, err := database.Writer().Begin()
		if err != nil {
			t.Fatalf("beginning a transaction: %v", err)
		}
		if _, err := queue.Enqueue(context.Background(), tx, "extract", fmt.Sprintf(`{"n":%d}`, i), ""); err != nil {
			_ = tx.Rollback()
			t.Fatalf("enqueueing job %d: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("committing job %d: %v", i, err)
		}
	}

	var mu sync.Mutex
	seen := map[string]int{}
	finished := make(chan string, total)
	queue.Register("extract", func(_ context.Context, job core.Job) error {
		mu.Lock()
		seen[job.ID]++
		mu.Unlock()
		finished <- job.ID
		return nil
	})

	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	first := core.NewJobsWorker(queue, core.SystemClock(), newJobsTestLogger(), "owner-a")
	second := core.NewJobsWorker(queue, core.SystemClock(), newJobsTestLogger(), "owner-b")
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	go func() { firstDone <- first.Run(ctx) }()
	go func() { secondDone <- second.Run(ctx) }()

	collected := map[string]bool{}
	for len(collected) < total {
		select {
		case id := <-finished:
			if collected[id] {
				t.Fatalf("job %s ran twice", id)
			}
			collected[id] = true
		case <-time.After(30 * time.Second):
			t.Fatalf("only %d of %d jobs finished", len(collected), total)
		}
	}
	stop()
	<-firstDone
	<-secondDone

	mu.Lock()
	defer mu.Unlock()
	for id, count := range seen {
		if count != 1 {
			t.Errorf("job %s ran %d times, want once", id, count)
		}
	}
	if len(seen) != total {
		t.Errorf("%d jobs ran, want %d", len(seen), total)
	}
}
