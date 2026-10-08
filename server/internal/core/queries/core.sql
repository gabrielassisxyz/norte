-- name: InsertCoreItem :exec
INSERT INTO core_items (id, module, type, title, url, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: UpdateCoreItem :execresult
UPDATE core_items SET title = ?, type = ? WHERE id = ?;

-- name: DeleteCoreItem :execresult
DELETE FROM core_items WHERE id = ?;

-- The registry row behind one id, which is how a module renders an item it does
-- not own: the title and the type are here, so a note shows where it came from
-- with the owning module switched off.
-- name: GetCoreItemByID :one
SELECT id, module, type, title, url, created_at FROM core_items WHERE id = ?;

-- Insert a manual, confirmed link, or take over whatever decision was on that
-- triple before. A manual confirmation clears the model's confidence: the row
-- is the person's decision now, not a suggestion with a score. The WHERE on
-- the conflict branch is what makes confirming an already confirmed link a
-- no-op, rather than moving the date it was decided.
-- name: ConfirmCoreLink :exec
INSERT INTO core_links (id, src_id, dst_id, kind, source, status, confidence, created_at, decided_at)
VALUES (?, ?, ?, ?, 'manual', 'confirmed', NULL, ?, ?)
ON CONFLICT (src_id, dst_id, kind) DO UPDATE SET
    source     = 'manual',
    status     = 'confirmed',
    confidence = NULL,
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

-- name: GetCoreItem :one
SELECT * FROM core_items WHERE id = ?;

-- name: InsertCoreSubject :exec
INSERT INTO core_subjects (id, name, slug, focus, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetCoreSubject :one
SELECT * FROM core_subjects WHERE id = ?;

-- name: GetCoreSubjectBySlug :one
SELECT * FROM core_subjects WHERE slug = ?;

-- name: UpdateCoreSubject :execresult
UPDATE core_subjects SET name = ?, slug = ?, focus = ? WHERE id = ?;

-- name: DeleteCoreSubject :execresult
DELETE FROM core_subjects WHERE id = ?;

-- The explicit half of the focus: the subjects a person flagged. Ordered by
-- slug so two calls answer in the same order.
-- name: ListFocusCoreSubjects :many
SELECT * FROM core_subjects WHERE focus = 1 ORDER BY slug, id;

-- A spelling that means an existing subject. Nothing in this delivery writes
-- one; the classifier and the import that will are what this exists for, and
-- the search already reads it.
-- name: InsertCoreSubjectAlias :exec
INSERT INTO core_subject_aliases (alias_slug, subject_id) VALUES (?, ?);

-- What is linked to a subject by a confirmed `about` link, counted per owning
-- module and item type. The core does not know any module's types, so the
-- grouping is by whatever is in the registry rather than by a fixed list.
-- name: CountCoreSubjectItemsByType :many
SELECT core_items.module, core_items.type, COUNT(*) AS count
FROM core_links
JOIN core_items ON core_items.id = core_links.src_id
WHERE core_links.dst_id = ? AND core_links.kind = 'about' AND core_links.status = 'confirmed'
GROUP BY core_items.module, core_items.type
ORDER BY core_items.module, core_items.type;

-- Every link the registry cascade would remove with this item, in either
-- direction and whatever its status. The delete confirmation shows this
-- figure, so a suggested link counts: it is a row that would disappear too.
-- name: CountCoreLinksTouching :one
SELECT COUNT(*) FROM core_links WHERE src_id = ? OR dst_id = ?;

-- name: GetCoreLink :one
SELECT * FROM core_links WHERE id = ?;

-- name: GetCoreLinkByTriple :one
SELECT * FROM core_links WHERE src_id = ? AND dst_id = ? AND kind = ?;

-- Accept or reject a suggestion. The status is the caller's; decided_at is set
-- either way, because rejecting is a decision as much as accepting is. Only a
-- suggestion can be decided: a confirmed link is a person's own assertion, and
-- a rejected one their recorded refusal, and neither is the model's to overturn.
-- name: DecideCoreLink :execresult
UPDATE core_links SET status = ?, decided_at = ? WHERE id = ? AND status = 'suggested';

-- A link with both of its ends from the registry, in one read. The link
-- screens render every row with its two ends, so reading them one registry
-- row at a time costs two extra queries per link on screen.
-- name: GetCoreLinkResolved :one
SELECT
    sqlc.embed(core_links),
    sqlc.embed(src),
    sqlc.embed(dst)
FROM core_links
JOIN core_items AS src ON src.id = core_links.src_id
JOIN core_items AS dst ON dst.id = core_links.dst_id
WHERE core_links.id = ?;
