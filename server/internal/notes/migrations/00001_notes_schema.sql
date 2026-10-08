-- The notes module's tables: highlights anchored by text, margin annotations,
-- the one freeform note an item carries, questions, and question sets.
--
-- Conventions shared by every table in Norte:
--   * id TEXT PRIMARY KEY holding a UUIDv7 string (see core.NewID)
--   * created_at / updated_at as fixed-width UTC text (see core.TimeLayout)
--   * the owner's prefix on the table name -- notes_ here
--   * a CHECK on every column with a closed set of values
--   * foreign keys only between tables of the same owner
--
-- item_id is a registry id and deliberately carries no foreign key: it points
-- at an item another module owns, and a foreign key across that line would
-- make a highlight disappear when the library is switched off. What the screen
-- needs instead -- the title to render -- comes from core_items, which the core
-- owns and every module may read.
--
-- A highlight stores the passage and its context rather than an offset, because
-- re-extracting an article changes every offset in it while the words stay the
-- same. position_hint is the code-point offset the passage was found at, and it
-- only orders the search between several candidate occurrences; section_ref and
-- location_label are for the PDF and EPUB pages of a later delivery and are
-- null for an article.
--
-- +goose Up

CREATE TABLE notes_highlights (
    id             TEXT PRIMARY KEY,
    item_id        TEXT NOT NULL,
    section_ref    TEXT,
    location_label TEXT,
    exact          TEXT NOT NULL,
    prefix         TEXT NOT NULL DEFAULT '',
    suffix         TEXT NOT NULL DEFAULT '',
    position_hint  INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'anchored' CHECK (status IN ('anchored', 'orphaned')),
    created_at     TEXT NOT NULL
);

CREATE INDEX notes_highlights_by_item ON notes_highlights (item_id, created_at, id);
CREATE INDEX notes_highlights_by_created ON notes_highlights (created_at, id);

CREATE TABLE notes_annotations (
    id           TEXT PRIMARY KEY,
    item_id      TEXT NOT NULL,
    highlight_id TEXT REFERENCES notes_highlights (id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX notes_annotations_by_item ON notes_annotations (item_id, created_at, id);
CREATE INDEX notes_annotations_by_created ON notes_annotations (created_at, id);
CREATE INDEX notes_annotations_by_highlight ON notes_annotations (highlight_id) WHERE highlight_id IS NOT NULL;

-- One note per item, which the UNIQUE is: the reader's "Nota" tab is a single
-- box, and a second row would make "the note" ambiguous.
CREATE TABLE notes_notes (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL UNIQUE,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- A set is one evening's curiosity about a topic; a subject is stable
-- vocabulary. They are not merged, so a set is its own row and is registered in
-- core_items as a question_set to be linkable to a subject.
CREATE TABLE notes_question_sets (
    id         TEXT PRIMARY KEY,
    topic      TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX notes_question_sets_by_created ON notes_question_sets (created_at, id);

-- kind is NULL for a question written on its own and for one turned from an
-- annotation; it names a prompt only for a question written from a set.
--
-- The annotation and the set are ON DELETE SET NULL rather than CASCADE: the
-- question is the person's own sentence, and deleting the margin note it came
-- from is not a reason to lose it.
CREATE TABLE notes_questions (
    id            TEXT PRIMARY KEY,
    item_id       TEXT,
    annotation_id TEXT REFERENCES notes_annotations (id) ON DELETE SET NULL,
    set_id        TEXT REFERENCES notes_question_sets (id) ON DELETE SET NULL,
    kind          TEXT CHECK (kind IS NULL OR kind IN ('what', 'why', 'who', 'when', 'where', 'how')),
    text          TEXT NOT NULL,
    answer        TEXT,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dropped')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX notes_questions_by_item ON notes_questions (item_id, created_at, id);
CREATE INDEX notes_questions_by_created ON notes_questions (created_at, id);
CREATE INDEX notes_questions_by_set ON notes_questions (set_id, created_at, id) WHERE set_id IS NOT NULL;

-- +goose Down

DROP TABLE notes_questions;
DROP TABLE notes_question_sets;
DROP TABLE notes_notes;
DROP TABLE notes_annotations;
DROP TABLE notes_highlights;
