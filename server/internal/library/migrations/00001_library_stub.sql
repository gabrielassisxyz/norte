-- The library stub's one throwaway table. It exists so the mounting, the
-- separate goose table and the enable/disable behaviour are exercised before
-- the real library lands. The real library bead drops this table in its own,
-- next migration; applied migrations are never edited.
--
-- +goose Up

CREATE TABLE library_meta (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

-- +goose Down

DROP TABLE library_meta;
