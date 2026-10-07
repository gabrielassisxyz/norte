-- The library's real tables: the stub's placeholder goes away in this same
-- migration, which applied migrations are never edited makes the only safe
-- place for that.
--
-- Conventions shared by every table in Norte:
--   * id TEXT PRIMARY KEY holding a UUIDv7 string (see core.NewID)
--   * created_at / updated_at as fixed-width UTC text (see core.TimeLayout)
--   * the owner's prefix on the table name -- library_ here
--   * foreign keys only between tables of the same owner: the library owns no
--     foreign key at all, because everything it points at (the registry, the
--     file references, the links, the jobs) belongs to the core
--   * a CHECK on every column with a closed set of values
--   * per-type variable data in a meta TEXT JSON column rather than sparse columns
--
-- unread is independent of status: "only unread" is a filter over any view, and
-- "read" is an event (read_at), not a place. selection is JSON
-- {exact, prefix, suffix} captured by the extension, or null. read_position is
-- JSON {v: 1, anchor, percent}. html_hash points at the HTML snapshot in the
-- file store. meta carries per-source data (Telegram messages, an extracted
-- title the person overrode, and snapshot_source -- extension|cli|server_fetch|
-- import, written whenever html_hash changes and independent of the item's own
-- source). The extraction columns are written by the extraction job; a save
-- only ever sets extract_status to pending.
--
-- library_fts is a standard (not external-content) FTS5 table: external content
-- keys on rowid, and a TEXT primary key's rowid can change under VACUUM. The
-- three triggers keep it in sync with library_items.
--
-- +goose Up

CREATE TABLE library_items (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('post', 'livro', 'paper', 'video', 'podcast', 'newsletter', 'curso')),
    url                TEXT NOT NULL,
    canonical_url      TEXT NOT NULL UNIQUE,
    title              TEXT NOT NULL,
    title_edited       INTEGER NOT NULL DEFAULT 0 CHECK (title_edited IN (0, 1)),
    author             TEXT,
    site               TEXT,
    published_at       TEXT,
    lead_image         TEXT,
    why                TEXT,
    selection          TEXT,
    status             TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'depois', 'arquivo')),
    unread             INTEGER NOT NULL DEFAULT 1 CHECK (unread IN (0, 1)),
    saved_at           TEXT NOT NULL,
    read_at            TEXT,
    last_opened_at     TEXT,
    read_position      TEXT,
    source             TEXT NOT NULL CHECK (source IN ('app', 'extension', 'cli', 'telegram', 'import')),
    html_hash          TEXT,
    content_html       TEXT,
    content_text       TEXT,
    content_headings   TEXT,
    extract_status     TEXT NOT NULL DEFAULT 'pending' CHECK (extract_status IN ('pending', 'done', 'failed')),
    extract_generation INTEGER NOT NULL DEFAULT 1,
    extracted_at       TEXT,
    extract_error      TEXT,
    minutes            INTEGER,
    meta               TEXT NOT NULL DEFAULT '{}',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

-- Every list sort is a total order with the id breaking ties, and each of
-- these is the index one of those orders reads.
CREATE INDEX library_items_by_status_saved ON library_items (status, saved_at, id);
CREATE INDEX library_items_by_saved ON library_items (saved_at, id);
CREATE INDEX library_items_by_title ON library_items (title, id);
CREATE INDEX library_items_by_opened ON library_items (last_opened_at, id) WHERE last_opened_at IS NOT NULL;

-- Ranked title > headings > why > author > content_text; see the search query
-- for the bm25 weights in the same column order.
CREATE VIRTUAL TABLE library_fts USING fts5(
    id UNINDEXED,
    title,
    author,
    why,
    content_headings,
    content_text
);

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_insert AFTER INSERT ON library_items BEGIN
    INSERT INTO library_fts (id, title, author, why, content_headings, content_text)
    VALUES (new.id, new.title, new.author, new.why, new.content_headings, new.content_text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_update AFTER UPDATE ON library_items BEGIN
    UPDATE library_fts
    SET title = new.title,
        author = new.author,
        why = new.why,
        content_headings = new.content_headings,
        content_text = new.content_text
    WHERE id = old.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_delete AFTER DELETE ON library_items BEGIN
    DELETE FROM library_fts WHERE id = old.id;
END;
-- +goose StatementEnd

DROP TABLE library_meta;

-- +goose Down

DROP TRIGGER library_items_fts_delete;
DROP TRIGGER library_items_fts_update;
DROP TRIGGER library_items_fts_insert;
DROP TABLE library_fts;
DROP TABLE library_items;

CREATE TABLE library_meta (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);
