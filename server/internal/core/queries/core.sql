-- name: InsertCoreItem :exec
INSERT INTO core_items (id, module, type, title, url, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: UpdateCoreItem :execresult
UPDATE core_items SET title = ?, type = ? WHERE id = ?;

-- name: DeleteCoreItem :execresult
DELETE FROM core_items WHERE id = ?;

-- Insert a manual, confirmed link, or take over whatever decision was on that
-- triple before. The WHERE on the conflict branch is what makes confirming an
-- already confirmed link a no-op, rather than moving the date it was decided.
-- name: ConfirmCoreLink :exec
INSERT INTO core_links (id, src_id, dst_id, kind, source, status, confidence, created_at, decided_at)
VALUES (?, ?, ?, ?, 'manual', 'confirmed', NULL, ?, ?)
ON CONFLICT (src_id, dst_id, kind) DO UPDATE SET
    source     = 'manual',
    status     = 'confirmed',
    decided_at = excluded.decided_at
WHERE core_links.status <> 'confirmed';

-- Record what the model thinks. The WHERE on the conflict branch is what keeps a
-- re-run from putting a rejected link back in the review queue.
-- name: SuggestCoreLink :exec
INSERT INTO core_links (id, src_id, dst_id, kind, source, status, confidence, created_at, decided_at)
VALUES (?, ?, ?, ?, 'llm', 'suggested', ?, ?, NULL)
ON CONFLICT (src_id, dst_id, kind) DO UPDATE SET
    confidence = excluded.confidence
WHERE core_links.status = 'suggested';

-- Storing bytes that already exist refreshes created_at on purpose. The grace
-- period protects a blob between Store and the transaction that references it,
-- and a second Store opens exactly such a window again; keeping an old
-- unreferenced row's timestamp would let gc delete the blob under that caller.
-- A referenced blob is never collected, so the refresh changes nothing for it.
-- name: InsertCoreFile :exec
INSERT INTO core_files (hash, media_type, size, created_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (hash) DO UPDATE SET created_at = excluded.created_at;

-- name: ListCollectableCoreFiles :many
SELECT core_files.hash, core_files.size FROM core_files
WHERE core_files.created_at < ?
  AND NOT EXISTS (SELECT 1 FROM core_file_refs WHERE core_file_refs.hash = core_files.hash)
ORDER BY hash;

-- The no-references condition is repeated here so a reference written since the
-- listing wins over the collector.
-- name: DeleteCollectableCoreFile :execresult
DELETE FROM core_files WHERE core_files.hash = ?
  AND NOT EXISTS (SELECT 1 FROM core_file_refs WHERE core_file_refs.hash = ?);
