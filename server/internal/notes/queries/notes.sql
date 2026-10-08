-- The notes module's own statements. Every one of them reads only notes_*
-- tables, because a module's queries must not compile against another module's
-- tables -- that rule is what lets a module be switched off.
--
-- The lists are built in Go instead: each one joins core_items for the source
-- title, which belongs to the core rather than to this module, and each one's
-- WHERE clause and cursor predicate change with the filters a fixed statement
-- cannot name.

-- name: InsertNotesHighlight :exec
INSERT INTO notes_highlights (
    id, item_id, section_ref, location_label, exact, prefix, suffix,
    position_hint, status, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetNotesHighlightByID :one
SELECT id, item_id, section_ref, location_label, exact, prefix, suffix,
       position_hint, status, created_at
FROM notes_highlights WHERE id = ?;

-- name: ListNotesHighlightsForItem :many
SELECT id, item_id, section_ref, location_label, exact, prefix, suffix,
       position_hint, status, created_at
FROM notes_highlights WHERE item_id = ? ORDER BY created_at, id;

-- name: ListNotesItemIDsWithHighlights :many
SELECT DISTINCT item_id FROM notes_highlights ORDER BY item_id;

-- Re-anchoring writes both columns at once: a status without the hint it was
-- computed from would order the next search from a stale position.
-- name: SetNotesHighlightAnchor :exec
UPDATE notes_highlights SET status = ?, position_hint = ? WHERE id = ?;

-- name: DeleteNotesHighlight :execresult
DELETE FROM notes_highlights WHERE id = ?;

-- name: CountNotesHighlights :one
SELECT COUNT(*) FROM notes_highlights;

-- name: InsertNotesAnnotation :exec
INSERT INTO notes_annotations (id, item_id, highlight_id, text, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: GetNotesAnnotationByID :one
SELECT id, item_id, highlight_id, text, created_at, updated_at
FROM notes_annotations WHERE id = ?;

-- name: UpdateNotesAnnotationText :execresult
UPDATE notes_annotations SET text = ?, updated_at = ? WHERE id = ?;

-- name: DeleteNotesAnnotation :execresult
DELETE FROM notes_annotations WHERE id = ?;

-- name: CountNotesAnnotations :one
SELECT COUNT(*) FROM notes_annotations;

-- name: GetNotesItemNote :one
SELECT id, item_id, text, created_at, updated_at FROM notes_notes WHERE item_id = ?;

-- The one note per item is written by id on conflict with the item: a PUT is a
-- replacement, and two writes of the same tab must not leave two rows.
-- name: UpsertNotesItemNote :exec
INSERT INTO notes_notes (id, item_id, text, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (item_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at;

-- name: DeleteNotesItemNote :execresult
DELETE FROM notes_notes WHERE item_id = ?;

-- name: InsertNotesQuestion :exec
INSERT INTO notes_questions (
    id, item_id, annotation_id, set_id, kind, text, answer, status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetNotesQuestionByID :one
SELECT id, item_id, annotation_id, set_id, kind, text, answer, status, created_at, updated_at
FROM notes_questions WHERE id = ?;

-- name: UpdateNotesQuestion :execresult
UPDATE notes_questions SET text = ?, answer = ?, status = ?, updated_at = ? WHERE id = ?;

-- name: CountNotesQuestions :one
SELECT COUNT(*) FROM notes_questions;

-- name: InsertNotesQuestionSet :exec
INSERT INTO notes_question_sets (id, topic, created_at) VALUES (?, ?, ?);

-- name: GetNotesQuestionSetByID :one
SELECT id, topic, created_at FROM notes_question_sets WHERE id = ?;

-- name: ListNotesQuestionsForSet :many
SELECT id, item_id, annotation_id, set_id, kind, text, answer, status, created_at, updated_at
FROM notes_questions WHERE set_id = ? ORDER BY created_at, id;

-- name: CountNotesQuestionsInSet :one
SELECT COUNT(*) FROM notes_questions WHERE set_id = ?;

-- name: CountNotesQuestionSets :one
SELECT COUNT(*) FROM notes_question_sets;
