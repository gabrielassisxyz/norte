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
    published_at, lead_image, reason, selection, location, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at,
    location_source
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?
);

-- name: GetLibraryItemByID :one
SELECT
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, reason, selection, location, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at,
    location_source
FROM library_items WHERE id = ?;

-- name: GetLibraryItemByCanonical :one
SELECT
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, reason, selection, location, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at,
    location_source
FROM library_items WHERE canonical_url = ?;

-- A duplicate save applies the note and the selection that came with it, or
-- leaves what was there when nothing came.
-- name: UpdateLibraryItemNote :exec
UPDATE library_items SET reason = ?, selection = ?, updated_at = ? WHERE id = ?;

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
    (SELECT COUNT(*) FROM library_items WHERE location = 'inbox') AS inbox,
    (SELECT COUNT(*) FROM library_items WHERE location = 'up_next') AS up_next,
    (SELECT COUNT(*) FROM library_items WHERE location = 'later') AS later,
    (SELECT COUNT(*) FROM library_items WHERE location = 'archive') AS archive,
    (SELECT COUNT(*) FROM library_items WHERE location = 'stash') AS stash,
    -- Aliased all_items rather than all, which SQLite reserves; the count the
    -- contract calls all is this one.
    (SELECT COUNT(*) FROM library_items) AS all_items,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'article') AS kind_article,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'book') AS kind_book,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'paper') AS kind_paper,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'video') AS kind_video,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'podcast') AS kind_podcast,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'newsletter') AS kind_newsletter,
    (SELECT COUNT(*) FROM library_items WHERE kind = 'course') AS kind_course,
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

-- The vocabulary, and what serves it.

-- Every tag in use with its item count, most used first and equal counts in
-- alphabetical order. The LEFT JOIN is deliberate: a tag row without a single
-- item is a broken invariant, and the endpoint reporting it at zero is the
-- symptom a person can see, rather than a silently hidden row.
-- name: ListLibraryTags :many
SELECT t.name AS name, COUNT(it.item_id) AS item_count
  FROM library_tags t
  LEFT JOIN library_item_tags it ON it.tag_name = t.name
 GROUP BY t.name
 ORDER BY item_count DESC, t.name ASC;

-- The automatic tagger's "prefer existing tags" list: every tag in use, most
-- used first, capped by the caller's limit.
-- name: ListLibraryVocabulary :many
SELECT t.name
  FROM library_tags t
  JOIN library_item_tags it ON it.tag_name = t.name
 GROUP BY t.name
 ORDER BY COUNT(it.item_id) DESC, t.name ASC
 LIMIT ?;

-- One tag row, or nothing: what the rename checks against.
-- name: GetLibraryTag :one
SELECT name FROM library_tags WHERE name = ?;

-- name: InsertLibraryTag :exec
INSERT OR IGNORE INTO library_tags (name, created_at) VALUES (?, ?);

-- Retires every tag nothing carries any more. Every path that deletes rows
-- from library_item_tags runs this in its transaction, so the vocabulary and
-- the item tags can never disagree about which tags exist.
-- name: PruneUnusedLibraryTags :exec
DELETE FROM library_tags
 WHERE name NOT IN (SELECT DISTINCT tag_name FROM library_item_tags);

-- One item's tags.

-- name: ListLibraryItemTagNames :many
SELECT tag_name FROM library_item_tags WHERE item_id = ? ORDER BY tag_name ASC;

-- The same rows with who put them there, which is what the tag job's diff
-- needs: it rewrites the rows it owns and never touches a manual one.
-- name: ListLibraryItemTagRows :many
SELECT tag_name, origin FROM library_item_tags WHERE item_id = ?;

-- The tagger's insert, which keeps whatever row is already there: an existing
-- manual row staying manual is the rule that a hand-add is never taken down
-- by a later automatic answer.
-- name: InsertLibraryItemTag :exec
INSERT OR IGNORE INTO library_item_tags (item_id, tag_name, origin, created_at)
VALUES (?, ?, ?, ?);

-- The person's own add, which makes the tag theirs even when the tagger had
-- it first: from here on the job must not remove it either.
-- name: UpsertLibraryItemTagManual :exec
INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
VALUES (?, ?, 'manual', ?)
  ON CONFLICT (item_id, tag_name) DO UPDATE SET origin = 'manual';

-- name: DeleteLibraryItemTag :exec
DELETE FROM library_item_tags WHERE item_id = ? AND tag_name = ?;

-- name: CountLibraryItemTagUses :one
SELECT COUNT(*) AS item_count FROM library_item_tags WHERE tag_name = ?;

-- The rename and the merge, one shape for both: the target row of the item
-- tags absorbs the source's rows, manual origin beating automatic, and the
-- tag's row moves when nothing held the target name already. Items whose
-- person removed the target tag by hand are never re-tagged: a merge follows
-- the removals rather than overriding them.
-- name: MoveLibraryItemTags :exec
INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
SELECT item_id, ?, origin, created_at
  FROM library_item_tags
 WHERE library_item_tags.tag_name = ?
   AND item_id NOT IN (SELECT item_id FROM library_item_removed_tags
                        WHERE library_item_removed_tags.tag_name = ?)
ON CONFLICT (item_id, tag_name) DO UPDATE SET origin =
    CASE WHEN library_item_tags.origin = 'manual' OR excluded.origin = 'manual'
         THEN 'manual' ELSE 'auto' END;

-- The source's rows are gone once they are absorbed, under either spelling.
-- name: DeleteLibraryTagItemRows :exec
DELETE FROM library_item_tags WHERE tag_name = ?;

-- The rename carries the removed-by-hand records with the tag, so a refusal
-- the person made keeps refusing under the new name.
-- name: MoveLibraryRemovedItemTags :exec
INSERT OR IGNORE INTO library_item_removed_tags (item_id, tag_name, created_at)
SELECT item_id, ?, created_at
  FROM library_item_removed_tags
 WHERE library_item_removed_tags.tag_name = ?;

-- name: DeleteLibraryRemovedItemTagRows :exec
DELETE FROM library_item_removed_tags WHERE tag_name = ?;

-- name: RenameLibraryTag :exec
UPDATE OR IGNORE library_tags SET name = ? WHERE name = ?;

-- What the person removed from one item by hand.

-- name: ListLibraryRemovedItemTagNames :many
SELECT tag_name FROM library_item_removed_tags WHERE item_id = ?;

-- name: RecordLibraryRemovedItemTag :exec
INSERT OR IGNORE INTO library_item_removed_tags (item_id, tag_name, created_at)
VALUES (?, ?, ?);

-- Handing the tag back: the person re-added what they once removed, and the
-- record that keeps the tagger from re-adding it must not outlive that.
-- name: DropLibraryRemovedItemTag :exec
DELETE FROM library_item_removed_tags WHERE item_id = ? AND tag_name = ?;

-- Every count the library screen shows, over only the items carrying one tag,
-- which is what the counts endpoint answers while a tag is selected.
-- name: CountLibraryItemsByTag :one
WITH tagged AS (
    SELECT id, kind, location, unread
      FROM library_items
     WHERE id IN (SELECT item_id FROM library_item_tags WHERE tag_name = ?)
)
SELECT
    (SELECT COUNT(*) FROM tagged WHERE location = 'inbox') AS inbox,
    (SELECT COUNT(*) FROM tagged WHERE location = 'up_next') AS up_next,
    (SELECT COUNT(*) FROM tagged WHERE location = 'later') AS later,
    (SELECT COUNT(*) FROM tagged WHERE location = 'archive') AS archive,
    (SELECT COUNT(*) FROM tagged WHERE location = 'stash') AS stash,
    (SELECT COUNT(*) FROM tagged) AS all_items,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'article') AS kind_article,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'book') AS kind_book,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'paper') AS kind_paper,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'video') AS kind_video,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'podcast') AS kind_podcast,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'newsletter') AS kind_newsletter,
    (SELECT COUNT(*) FROM tagged WHERE kind = 'course') AS kind_course,
    (SELECT COUNT(*) FROM tagged WHERE unread = 1) AS unread;

-- The router: the rules it reads, and the two guarded writes the decider makes.

-- Every domain rule the person set. The whole table is read and matched in Go
-- because a rule covers its subdomains and the longest match wins, which no
-- single SQLite predicate says; the rules are the person's own handful, not a
-- corpus to scan.
-- name: ListLibraryDomainRules :many
SELECT domain, location FROM library_domain_rules ORDER BY domain ASC;

-- The decider's move, guarded by both halves of "nobody has touched this":
-- the source is still the default the save wrote, and the location is still
-- the one the save left. A row failing either predicate belongs to the person
-- or to a rule, and :execrows is how the handler learns it changed nothing.
-- name: MoveLibraryItemByDecider :execrows
UPDATE library_items
SET location = ?, location_source = 'decider', updated_at = ?
WHERE id = ? AND location = ? AND location_source = 'default';

-- The decider's kind, guarded by the kind the save wrote. A column reading
-- anything else was set by the only other writer there is -- the person's
-- PATCH -- and an answer from a model does not overrule that.
-- name: SetLibraryItemKindByDecider :execrows
UPDATE library_items SET kind = ?, updated_at = ? WHERE id = ? AND kind = ?;
