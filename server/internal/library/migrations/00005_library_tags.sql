-- Tags: the many, automatic vocabulary for finding things, set apart from
-- subjects, which are few and curated and drive what the person is studying.
--
-- Three tables:
--
--   library_tags              one row per tag in use. The name is the
--                             normalized form, and its PRIMARY KEY is the
--                             uniqueness of the vocabulary: "llm" and
--                             "large language model" can only stay separate
--                             if the normalization let them.
--   library_item_tags         which item carries which tag, and who put it
--                             there: the tagger (auto) or the person (manual).
--                             The tag job rewrites only the auto rows, so a
--                             hand-add outlives every re-extraction.
--   library_item_removed_tags  tags the person took off an item by hand. The
--                             tag job reads them and drops the names from
--                             every later answer for that item, which is what
--                             makes a hand removal stick -- the same rule the
--                             library already gives an edited title and the
--                             reviewer a rejected suggestion.
--
-- The vocabulary holds only tags in use: every path that deletes item-tag
-- rows also retires tag rows nothing carries any more, so the tag list and
-- the model's "prefer existing tags" can never disagree about what exists.
--
-- +goose Up

CREATE TABLE library_tags (
    name       TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE library_item_tags (
    item_id    TEXT NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    tag_name   TEXT NOT NULL,
    origin     TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_name)
);

-- The list filter and the tag counts read by tag first, so the index is the
-- reverse of the table's own primary key.
CREATE INDEX library_item_tags_by_tag ON library_item_tags (tag_name, item_id);

CREATE TABLE library_item_removed_tags (
    item_id    TEXT NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    tag_name   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_name)
);

-- +goose Down

DROP TABLE library_item_removed_tags;
DROP TABLE library_item_tags;
DROP TABLE library_tags;