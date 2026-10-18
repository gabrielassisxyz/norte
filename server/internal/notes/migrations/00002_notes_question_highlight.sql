-- A question can point at the passage it was asked about, so the reader's
-- selection toolbar can turn a selection straight into a question without
-- writing a margin note nobody asked for in between.
--
-- ON DELETE SET NULL for the same reason as annotation_id and set_id: the
-- question is the person's own sentence, and deleting the passage it was asked
-- about is not a reason to lose it.
--
-- +goose Up

ALTER TABLE notes_questions ADD COLUMN highlight_id TEXT REFERENCES notes_highlights (id) ON DELETE SET NULL;

CREATE INDEX notes_questions_by_highlight ON notes_questions (highlight_id) WHERE highlight_id IS NOT NULL;

-- +goose Down

DROP INDEX notes_questions_by_highlight;

ALTER TABLE notes_questions DROP COLUMN highlight_id;
