package core

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// JobsMaxAttempts bounds how many times one job runs. The claiming statement
// counts, so a job that succeeds on its third run records attempts 3.
const JobsMaxAttempts = 3

// The worker's schedule. Polling while idle, reclaiming dead leases, renewing
// a running lease and extending it, and the shutdown drain all hang off the
// injected clock, so a test can walk them without waiting.
const (
	jobsPollInterval    = time.Second
	jobsReclaimInterval = time.Minute
	jobsRenewInterval   = 30 * time.Second
	jobsLeaseDuration   = 2 * time.Minute
	jobsDrainTimeout    = 15 * time.Second
	jobsFirstBackoff    = time.Minute
	jobsSecondBackoff   = 5 * time.Minute
)

// Job is what a handler receives: identifiers and the attempt count, never a
// live row. Attempt starts at 1 and MaxAttempts is JobsMaxAttempts, so a
// handler can tell its last attempt from an earlier one.
type Job struct {
	ID          string
	Kind        string
	Payload     string
	Attempt     int
	MaxAttempts int
}

// JobHandler runs one job. Returning nil marks done. Returning an error
// schedules a retry with backoff until the third failure, which marks failed.
// Returning Permanent marks failed at once with no retry.
type JobHandler func(ctx context.Context, job Job) error

// jobsPermanentError marks an error as unretryable. Handlers wrap with
// Permanent; the worker unwraps with errors.As.
type jobsPermanentError struct {
	err error
}

func (e *jobsPermanentError) Error() string { return e.err.Error() }

func (e *jobsPermanentError) Unwrap() error { return e.err }

// Permanent marks a handler error as unretryable: a refused address, a body
// over a cap, a malformed input. The job is marked failed after one attempt.
func Permanent(err error) error {
	return &jobsPermanentError{err: err}
}

func isJobsPermanent(err error) bool {
	var target *jobsPermanentError
	return errors.As(err, &target)
}

// IsPermanent reports whether err was marked with Permanent, for a handler that
// has to write its own terminal state before returning. The worker asks the same
// question when it decides between a retry and a failure, and both have to
// reach the same answer from the same error.
func IsPermanent(err error) bool {
	return isJobsPermanent(err)
}

// jobsURLPattern finds URLs inside an error message so the redactor can strip
// what must never reach the database row: query strings and fragments, where
// tokens travel.
var jobsURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

// redactJobsError strips query strings and fragments from every URL in an
// error message. A failing fetch reports the page it could not read, never the
// signed address it was given.
func redactJobsError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	for _, raw := range jobsURLPattern.FindAllString(message, -1) {
		trimmed := strings.TrimRight(raw, ".,;:!?)")
		if trimmed == "" {
			continue
		}
		parsed, parseErr := url.Parse(trimmed)
		if parseErr != nil || parsed.Scheme == "" || parsed.Host == "" {
			continue
		}
		parsed.RawQuery = ""
		parsed.ForceQuery = false
		parsed.Fragment = ""
		parsed.RawFragment = ""
		message = strings.ReplaceAll(message, trimmed, parsed.String())
	}
	return message
}

// RedactError renders an error the way the queue stores one, for a handler that
// writes a failure into a column of its own. The queue already redacts what it
// puts in core_jobs.last_error; a handler recording the same failure beside its
// own row has to apply the same rule, and the rule belongs in one place.
func RedactError(err error) string {
	return redactJobsError(err)
}

// Jobs is the durable queue: the registry handlers are called through and the
// writer they lease from. Modules enqueue inside their own transaction so a
// save and its job commit together.
type Jobs struct {
	writer   *sql.DB
	clock    Clock
	logger   *slog.Logger
	mu       sync.RWMutex
	handlers map[string]JobHandler
}

// NewJobs returns the queue over writer. Handlers arrive later through
// Register, which the module registry calls for each enabled module.
func NewJobs(writer *sql.DB, clock Clock, logger *slog.Logger) *Jobs {
	if logger == nil {
		logger = slog.Default()
	}
	return &Jobs{
		writer:   writer,
		clock:    clock,
		logger:   logger,
		handlers: map[string]JobHandler{},
	}
}

// Register makes kind runnable. A job whose kind has no handler stays queued,
// untouched, which is what lets a module be switched off without stranding.
func (j *Jobs) Register(kind string, handler JobHandler) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.handlers == nil {
		j.handlers = map[string]JobHandler{}
	}
	j.handlers[kind] = handler
}

func (j *Jobs) jobsHandlerFor(kind string) (JobHandler, bool) {
	j.mu.RLock()
	defer j.mu.RUnlock()
	handler, ok := j.handlers[kind]
	return handler, ok
}

func (j *Jobs) jobsRegisteredKinds() []string {
	j.mu.RLock()
	defer j.mu.RUnlock()
	kinds := make([]string, 0, len(j.handlers))
	for kind := range j.handlers {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	return kinds
}

// Enqueue records one job inside the caller's transaction. When dedupeKey is
// set and a queued or running job already holds it, no row is inserted and the
// existing id comes back, so enqueueing the same work twice yields one job. A
// finished job never blocks: the index is partial to queued and running.
func (j *Jobs) Enqueue(ctx context.Context, tx *sql.Tx, kind, payload, dedupeKey string) (string, error) {
	if kind == "" {
		return "", fmt.Errorf("jobs enqueue requires a kind")
	}
	if payload == "" {
		payload = "{}"
	}
	now := FormatTime(j.clock.Now())
	queries := db.New(tx)
	if dedupeKey != "" {
		existing, err := queries.FindOutstandingCoreJobByDedupeKey(ctx, sql.NullString{String: dedupeKey, Valid: true})
		if err == nil {
			return existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("looking for the outstanding job: %w", err)
		}
	}
	id := NewID()
	dedupeParam := sql.NullString{}
	if dedupeKey != "" {
		dedupeParam = sql.NullString{String: dedupeKey, Valid: true}
	}
	if err := queries.InsertCoreJob(ctx, db.InsertCoreJobParams{
		ID:          id,
		Kind:        kind,
		Payload:     payload,
		DedupeKey:   dedupeParam,
		AvailableAt: now,
		CreatedAt:   now,
	}); err != nil {
		if dedupeKey != "" && strings.Contains(err.Error(), "UNIQUE constraint failed") {
			existing, findErr := queries.FindOutstandingCoreJobByDedupeKey(ctx, sql.NullString{String: dedupeKey, Valid: true})
			if findErr == nil {
				return existing, nil
			}
		}
		return "", fmt.Errorf("enqueueing a job of kind %s: %w", kind, err)
	}
	return id, nil
}

// claimJobsQueueJob takes the oldest queued job that is due and whose kind has
// a handler, in the same statement that marks it running. The single writer
// serialises two claims, so two workers cannot take one job.
func (j *Jobs) claimJobsQueueJob(ctx context.Context, owner string) (Job, bool, error) {
	kinds := j.jobsRegisteredKinds()
	if len(kinds) == 0 {
		return Job{}, false, nil
	}
	now := j.clock.Now()
	nowText := FormatTime(now)
	leaseUntilText := FormatTime(now.Add(jobsLeaseDuration))
	query := "UPDATE core_jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, lease_owner = ?, started_at = ? " +
		"WHERE id = (SELECT id FROM core_jobs WHERE status = 'queued' AND available_at <= ? AND kind IN ("
	for i := range kinds {
		if i > 0 {
			query += ", "
		}
		query += "?"
	}
	query += ") ORDER BY available_at, id LIMIT 1) RETURNING id, kind, payload, attempts"
	args := make([]any, 0, 4+len(kinds))
	args = append(args, leaseUntilText, sql.NullString{String: owner, Valid: true}, nowText, nowText)
	for _, kind := range kinds {
		args = append(args, kind)
	}
	var id, kind, payload string
	var attempts int64
	if err := j.writer.QueryRowContext(ctx, query, args...).Scan(&id, &kind, &payload, &attempts); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Job{}, false, nil
		}
		return Job{}, false, fmt.Errorf("claiming a job: %w", err)
	}
	return Job{ID: id, Kind: kind, Payload: payload, Attempt: int(attempts), MaxAttempts: JobsMaxAttempts}, true, nil
}

func (j *Jobs) markJobsJobDone(ctx context.Context, id, owner string) error {
	nowText := FormatTime(j.clock.Now())
	_, err := db.New(j.writer).MarkCoreJobDone(ctx, db.MarkCoreJobDoneParams{
		FinishedAt: sql.NullString{String: nowText, Valid: true},
		ID:         id,
		LeaseOwner: sql.NullString{String: owner, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("marking job %s done: %w", id, err)
	}
	return nil
}

// failJobsJob records a handler error. The first failure is runnable a minute
// later, the second five minutes later, the third and any permanent error mark
// failed at once. Attempts were already counted at claim.
func (j *Jobs) failJobsJob(ctx context.Context, id, owner string, attempt int, handlerErr error) error {
	redacted := redactJobsError(handlerErr)
	lastErr := sql.NullString{String: redacted, Valid: redacted != ""}
	now := j.clock.Now()
	nowText := FormatTime(now)
	ownerParam := sql.NullString{String: owner, Valid: true}
	queries := db.New(j.writer)
	if isJobsPermanent(handlerErr) || attempt >= JobsMaxAttempts {
		_, err := queries.MarkCoreJobFailedPermanent(ctx, db.MarkCoreJobFailedPermanentParams{
			FinishedAt: sql.NullString{String: nowText, Valid: true},
			LastError:  lastErr,
			ID:         id,
			LeaseOwner: ownerParam,
		})
		if err != nil {
			return fmt.Errorf("marking job %s failed: %w", id, err)
		}
		return nil
	}
	var available string
	if attempt <= 1 {
		available = FormatTime(now.Add(jobsFirstBackoff))
	} else {
		available = FormatTime(now.Add(jobsSecondBackoff))
	}
	_, err := queries.MarkCoreJobFailedRetry(ctx, db.MarkCoreJobFailedRetryParams{
		AvailableAt: available,
		LastError:   lastErr,
		ID:          id,
		LeaseOwner:  ownerParam,
	})
	if err != nil {
		return fmt.Errorf("scheduling the retry of job %s: %w", id, err)
	}
	return nil
}

func (j *Jobs) reclaimJobsExpired(ctx context.Context) (int64, error) {
	nowText := FormatTime(j.clock.Now())
	result, err := db.New(j.writer).ReclaimExpiredCoreJobs(ctx, sql.NullString{String: nowText, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("reclaiming expired jobs: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("counting reclaimed jobs: %w", err)
	}
	return affected, nil
}

func (j *Jobs) renewJobsLease(ctx context.Context, id, owner string) error {
	extended := FormatTime(j.clock.Now().Add(jobsLeaseDuration))
	_, err := db.New(j.writer).RenewCoreJobLease(ctx, db.RenewCoreJobLeaseParams{
		LeaseUntil: sql.NullString{String: extended, Valid: true},
		ID:         id,
		LeaseOwner: sql.NullString{String: owner, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("renewing the lease of job %s: %w", id, err)
	}
	return nil
}

// releaseJobsLease returns a running job to queued after a clean shutdown.
// Attempts drop by one so a restart costs no attempt; a reclaim after a crash
// keeps the count, which is what bounds a crash loop.
func (j *Jobs) releaseJobsLease(ctx context.Context, id, owner string) error {
	nowText := FormatTime(j.clock.Now())
	_, err := db.New(j.writer).ReleaseCoreJobOnShutdown(ctx, db.ReleaseCoreJobOnShutdownParams{
		AvailableAt: nowText,
		ID:          id,
		LeaseOwner:  sql.NullString{String: owner, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("releasing job %s: %w", id, err)
	}
	return nil
}

// ListJobs reads every job for `norte jobs list`. It opens no migration: the
// command reports what is on disk, even on a database from an older version.
func (j *Jobs) ListJobs(ctx context.Context) ([]db.ListCoreJobsRow, error) {
	rows, err := db.New(j.writer).ListCoreJobs(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing jobs: %w", err)
	}
	return rows, nil
}

// RetryJob moves a failed job back to queued with a clean attempt count. A
// queued or running row holding the same dedupe key refuses the retry, since
// the partial index would otherwise be violated, and any other status is
// refused without touching either row.
func (j *Jobs) RetryJob(ctx context.Context, id string) error {
	queries := db.New(j.writer)
	job, err := queries.GetCoreJobByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no such job: %s", id)
		}
		return fmt.Errorf("reading job %s: %w", id, err)
	}
	if job.Status != "failed" {
		return fmt.Errorf("job %s is %s, only failed jobs can be retried", id, job.Status)
	}
	if job.DedupeKey.Valid && job.DedupeKey.String != "" {
		blocking, err := queries.FindOutstandingCoreJobByDedupeKey(ctx, job.DedupeKey)
		if err == nil {
			return fmt.Errorf("cannot retry job %s: dedupe key is held by job %s", id, blocking)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("checking the dedupe key of job %s: %w", id, err)
		}
	}
	nowText := FormatTime(j.clock.Now())
	result, err := queries.RetryCoreJob(ctx, db.RetryCoreJobParams{AvailableAt: nowText, ID: id})
	if err != nil {
		return fmt.Errorf("retrying job %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("counting the retried job %s: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("job %s is no longer failed", id)
	}
	return nil
}

// JobsWorker is the one in-process worker `norte serve` starts. It claims the
// oldest due job of a registered kind every worker cycle and again immediately
// after a job finishes, renews the lease while the handler runs, and reclaims
// expired leases every minute and at startup.
type JobsWorker struct {
	jobs   *Jobs
	clock  Clock
	logger *slog.Logger
	owner  string
}

// NewJobsWorker returns the worker over jobs. Owner identifies this worker's
// leases; a fresh id per process keeps a restart from renewing a dead lease.
func NewJobsWorker(jobs *Jobs, clock Clock, logger *slog.Logger, owner string) *JobsWorker {
	if logger == nil {
		logger = slog.Default()
	}
	if owner == "" {
		owner = NewID()
	}
	return &JobsWorker{jobs: jobs, clock: clock, logger: logger, owner: owner}
}

// Run leases and runs jobs until ctx ends. An idle worker waits on the clock;
// a shutdown while a job runs cancels the handler and waits for the drain
// before releasing the lease, so a restart costs no attempt.
func (w *JobsWorker) Run(ctx context.Context) error {
	_, _ = w.jobs.reclaimJobsExpired(ctx)
	pollTimer := w.clock.NewTimer(jobsPollInterval)
	defer pollTimer.Stop()
	reclaimTimer := w.clock.NewTimer(jobsReclaimInterval)
	defer reclaimTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		claimed, ok, err := w.jobs.claimJobsQueueJob(ctx, w.owner)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			w.logger.Error("claiming jobs", "err", err.Error())
		} else if ok {
			if w.executeJobsJob(ctx, claimed) {
				return nil
			}
			continue
		}
		select {
		case <-ctx.Done():
			return nil
		case <-pollTimer.C():
			pollTimer.Stop()
			pollTimer = w.clock.NewTimer(jobsPollInterval)
		case <-reclaimTimer.C():
			reclaimTimer.Stop()
			_, _ = w.jobs.reclaimJobsExpired(ctx)
			reclaimTimer = w.clock.NewTimer(jobsReclaimInterval)
		}
	}
}

// executeJobsJob runs one claimed job to completion. It reports whether Run
// should stop: true only when a shutdown arrived while the job ran. Renewal
// extends the lease until the handler returns; a clean shutdown releases it
// after the handler returns, and a missed drain leaves it to expire.
func (w *JobsWorker) executeJobsJob(ctx context.Context, job Job) bool {
	handler, ok := w.jobs.jobsHandlerFor(job.Kind)
	if !ok {
		_ = w.jobs.releaseJobsLease(context.Background(), job.ID, w.owner)
		w.logger.Warn("no handler for job kind", "job_id", job.ID, "kind", job.Kind)
		return false
	}
	start := w.clock.Now()
	handlerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				done <- fmt.Errorf("handler panicked: %v", recovered)
			}
		}()
		done <- handler(handlerCtx, job)
	}()
	renewTimer := w.clock.NewTimer(jobsRenewInterval)
	defer renewTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			cancel()
			drainTimer := w.clock.NewTimer(jobsDrainTimeout)
			select {
			case <-done:
				drainTimer.Stop()
				_ = w.jobs.releaseJobsLease(context.Background(), job.ID, w.owner)
				duration := w.clock.Now().Sub(start)
				w.logger.Info("jobs worker released a job on shutdown",
					"job_id", job.ID, "kind", job.Kind, "attempt", job.Attempt,
					"duration_ms", duration.Milliseconds(), "outcome", "released")
				return true
			case <-drainTimer.C():
				w.logger.Error("jobs worker did not drain", "job_id", job.ID, "kind", job.Kind)
				return true
			}
		case handlerErr := <-done:
			cancel()
			renewTimer.Stop()
			duration := w.clock.Now().Sub(start)
			if handlerErr != nil {
				redacted := redactJobsError(handlerErr)
				_ = w.jobs.failJobsJob(context.Background(), job.ID, w.owner, job.Attempt, handlerErr)
				outcome := "retry_scheduled"
				permanent := isJobsPermanent(handlerErr)
				if permanent || job.Attempt >= JobsMaxAttempts {
					outcome = "failed"
				}
				w.logger.Info("job failed",
					"job_id", job.ID, "kind", job.Kind, "attempt", job.Attempt,
					"duration_ms", duration.Milliseconds(), "outcome", outcome,
					"permanent", permanent, "err", redacted)
			} else {
				_ = w.jobs.markJobsJobDone(context.Background(), job.ID, w.owner)
				w.logger.Info("job done",
					"job_id", job.ID, "kind", job.Kind, "attempt", job.Attempt,
					"duration_ms", duration.Milliseconds(), "outcome", "done")
			}
			return false
		case <-renewTimer.C():
			if ctx.Err() != nil {
				cancel()
				drainTimer := w.clock.NewTimer(jobsDrainTimeout)
				select {
				case <-done:
					drainTimer.Stop()
					_ = w.jobs.releaseJobsLease(context.Background(), job.ID, w.owner)
					return true
				case <-drainTimer.C():
					w.logger.Error("jobs worker did not drain", "job_id", job.ID, "kind", job.Kind)
					return true
				}
			}
			renewTimer.Stop()
			renewTimer = w.clock.NewTimer(jobsRenewInterval)
			_ = w.jobs.renewJobsLease(context.Background(), job.ID, w.owner)
		}
	}
}
