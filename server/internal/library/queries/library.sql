-- The library's own statements: every one of them reads only library_items,
-- because a module's queries must not compile against another module's tables.
-- Reads of the core (link targets, file references) are plain statements in
-- the service, next to the logic that decides them.
--
-- The list and its cursor pagination are built in Go rather than here: the
-- WHERE clause, the ORDER BY and the cursor predicate all change with the
-- view, the filters and the sort, and a fixed statement cannot say that.

-- name: InsertLibraryItem :exec
INSERT INTO library_items (
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, why, selection, status, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?
);

-- name: GetLibraryItemByID :one
SELECT
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, why, selection, status, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at
FROM library_items WHERE id = ?;

-- name: GetLibraryItemByCanonical :one
SELECT
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, why, selection, status, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at
FROM library_items WHERE canonical_url = ?;

-- A duplicate save applies the note and the selection that came with it, or
-- leaves what was there when nothing came.
-- name: UpdateLibraryItemNote :exec
UPDATE library_items SET why = ?, selection = ?, updated_at = ? WHERE id = ?;

-- A duplicate save that re-extracts replaces the snapshot: the new hash, who
-- captured it, a clean extraction state and the next generation, so the worker
-- can tell a superseded job from this one.
-- name: ReplaceLibrarySnapshot :exec
UPDATE library_items
SET html_hash = ?, meta = ?, extract_status = 'pending', extract_error = NULL,
    extract_generation = ?, updated_at = ?
WHERE id = ?;

-- A duplicate save that changes nothing but the note still moves updated_at,
-- so the row says when it was last touched.
-- name: TouchLibraryItem :exec
UPDATE library_items SET updated_at = ? WHERE id = ?;

-- Opening an item records when, and nothing else: opening is not reading.
-- name: MarkLibraryItemOpened :execresult
UPDATE library_items SET last_opened_at = ?, updated_at = ? WHERE id = ?;

-- Every count the library screen shows, in the one query the counts endpoint
-- answers with, so a list call never recomputes them.
-- name: CountLibraryItems :one
SELECT
    (SELECT COUNT(*) FROM library_items WHERE status = 'inbox') AS inbox,
    (SELECT COUNT(*) FROM library_items WHERE status = 'depois') AS depois,
    (SELECT COUNT(*) FROM library_items WHERE status = 'arquivo') AS arquivo,
    (SELECT COUNT(*) FROM library_items) AS tudo,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'post') AS kind_post,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'livro') AS kind_livro,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'paper') AS kind_paper,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'video') AS kind_video,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'podcast') AS kind_podcast,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'newsletter') AS kind_newsletter,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'curso') AS kind_curso,
    (SELECT COUNT(*) FROM library_items WHERE unread = 1) AS unread;

-- The extraction writes everything one pass produced in one statement, so no
-- consumer can ever read an item whose text and whose metadata came from
-- different runs.
-- name: WriteLibraryExtraction :exec
UPDATE library_items
SET title = ?, author = ?, site = ?, published_at = ?, lead_image = ?,
    html_hash = ?, content_html = ?, content_text = ?, content_headings = ?,
    minutes = ?, read_position = ?, meta = ?, extract_status = 'done',
    extract_error = NULL, extracted_at = ?, updated_at = ?
WHERE id = ?;

-- The extraction's last attempt, or a permanent failure: the reason stays on
-- the row so the library screen can show it with a retry button.
-- name: MarkLibraryExtractionFailed :execrows
UPDATE library_items
SET extract_status = 'failed', extract_error = ?, updated_at = ?
WHERE id = ? AND extract_generation = ?;

-- An attempt that will be retried records why it failed without giving up the
-- pending state, which is what the screen reads as "still working".
-- name: RecordLibraryExtractionError :execrows
UPDATE library_items SET extract_error = ?, updated_at = ?
WHERE id = ? AND extract_generation = ?;

-- A retry asked for from the API or the command line. The generation advances
-- so the new job gets a dedupe key of its own and any run still in flight is
-- recognised as superseded and writes nothing.
-- name: ResetLibraryExtraction :exec
UPDATE library_items
SET extract_status = 'pending', extract_error = NULL,
    extract_generation = extract_generation + 1, updated_at = ?
WHERE id = ?;

-- Read inside the writer transaction, right before the extraction commits, to
-- find out whether a newer request has superseded this run.
-- name: GetLibraryExtractGeneration :one
SELECT extract_generation FROM library_items WHERE id = ?;
