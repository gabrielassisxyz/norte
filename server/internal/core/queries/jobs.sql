-- The durable jobs queue. The worker in internal/core/jobs.go leases from
-- core_jobs; this file holds every statement it and the `norte jobs` commands
-- need. The claim itself is built in Go because the list of registered kinds
-- varies at runtime, so it cannot be a fixed sqlc query.

-- name: InsertCoreJob :exec
INSERT INTO core_jobs (id, kind, payload, dedupe_key, status, attempts, available_at, lease_until, lease_owner, last_error, created_at, started_at, finished_at)
VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, NULL, ?, NULL, NULL);

-- name: FindOutstandingCoreJobByDedupeKey :one
SELECT id FROM core_jobs WHERE dedupe_key = ? AND status IN ('queued', 'running') LIMIT 1;

-- name: GetCoreJobByID :one
SELECT id, kind, payload, dedupe_key, status, attempts, available_at, lease_until, lease_owner, last_error, created_at, started_at, finished_at
FROM core_jobs WHERE id = ?;

-- name: MarkCoreJobDone :execresult
UPDATE core_jobs SET status = 'done', finished_at = ?, lease_until = NULL, lease_owner = NULL
WHERE id = ? AND status = 'running' AND lease_owner = ?;

-- name: MarkCoreJobFailedRetry :execresult
UPDATE core_jobs SET status = 'queued', available_at = ?, last_error = ?, lease_until = NULL, lease_owner = NULL
WHERE id = ? AND status = 'running' AND lease_owner = ?;

-- name: MarkCoreJobFailedPermanent :execresult
UPDATE core_jobs SET status = 'failed', finished_at = ?, last_error = ?, lease_until = NULL, lease_owner = NULL
WHERE id = ? AND status = 'running' AND lease_owner = ?;

-- name: ReclaimExpiredCoreJobs :execresult
UPDATE core_jobs SET status = 'queued', lease_until = NULL, lease_owner = NULL
WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?;

-- name: RenewCoreJobLease :execresult
UPDATE core_jobs SET lease_until = ? WHERE id = ? AND status = 'running' AND lease_owner = ?;

-- name: ReleaseCoreJobOnShutdown :execresult
UPDATE core_jobs SET status = 'queued', lease_until = NULL, lease_owner = NULL, attempts = attempts - 1, available_at = ?, started_at = NULL
WHERE id = ? AND status = 'running' AND lease_owner = ?;

-- name: ListCoreJobs :many
SELECT id, kind, status, attempts, available_at, last_error FROM core_jobs ORDER BY available_at, id;

-- name: RetryCoreJob :execresult
UPDATE core_jobs SET status = 'queued', attempts = 0, available_at = ?, lease_until = NULL, lease_owner = NULL, started_at = NULL, finished_at = NULL, last_error = NULL
WHERE id = ? AND status = 'failed';
