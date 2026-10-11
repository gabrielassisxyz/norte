-- The library's Portuguese model becomes English, and the three-value shelf
-- becomes a five-value location.
--
--   status  -> location, with inbox | up_next | later | archive | stash
--              (inbox -> inbox, depois -> later, arquivo -> archive; nothing
--              maps to up_next or stash, so both start empty)
--   why     -> reason, in the column, in library_fts and in its three triggers
--   kind    -> post -> article, livro -> book, curso -> course
--
-- Why this is a rebuild rather than a set of ALTERs: SQLite cannot alter a
-- CHECK constraint, and an FTS5 column cannot be renamed. So the up step
-- creates the table afresh, copies every row through the value mapping, drops
-- the old one, renames, recreates the four indexes, and drops and recreates
-- library_fts with its three triggers -- which carry the shape 00003 gave
-- them, headings reduced to their text rather than their JSON, because
-- dropping library_items drops the triggers with it.
--
-- The bm25 weight order 00002 documented (title > headings > reason > author >
-- content_text, weights 0, 10, 2, 5, 7, 1 over id, title, author, reason,
-- content_headings, content_text) is unchanged: only the third indexed
-- column's name moves.
--
-- +goose Up

-- The down step writes the two locations the restored CHECK cannot hold into
-- this table, and this is where they are read back, which is what makes
-- down-then-up lossless for triage done after the cutover: the pre-cutover
-- backup predates those writes and cannot give them back. It is created here
-- rather than only in the down step because a statement naming a table that
-- does not exist fails at prepare time, so a first-ever up has to find it
-- empty rather than absent.
CREATE TABLE IF NOT EXISTS library_location_preserved (
    item_id  TEXT PRIMARY KEY,
    location TEXT NOT NULL
);

CREATE TABLE library_items_new (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('article', 'book', 'paper', 'video', 'podcast', 'newsletter', 'course')),
    url                TEXT NOT NULL,
    canonical_url      TEXT NOT NULL UNIQUE,
    title              TEXT NOT NULL,
    title_edited       INTEGER NOT NULL DEFAULT 0 CHECK (title_edited IN (0, 1)),
    author             TEXT,
    site               TEXT,
    published_at       TEXT,
    lead_image         TEXT,
    reason             TEXT,
    selection          TEXT,
    location           TEXT NOT NULL DEFAULT 'inbox' CHECK (location IN ('inbox', 'up_next', 'later', 'archive', 'stash')),
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

INSERT INTO library_items_new (
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, reason, selection, location, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at
)
SELECT id,
       CASE kind WHEN 'post' THEN 'article'
                 WHEN 'livro' THEN 'book'
                 WHEN 'curso' THEN 'course'
                 ELSE kind END,
       url, canonical_url, title, title_edited, author, site,
       published_at, lead_image, why, selection,
       CASE status WHEN 'depois' THEN 'later'
                   WHEN 'arquivo' THEN 'archive'
                   ELSE status END,
       unread, saved_at,
       read_at, last_opened_at, read_position, source, html_hash, content_html,
       content_text, content_headings, extract_status, extract_generation,
       extracted_at, extract_error, minutes, meta, created_at, updated_at
  FROM library_items;

DROP TABLE library_items;

ALTER TABLE library_items_new RENAME TO library_items;

-- Every list sort is a total order with the id breaking ties, and each of
-- these is the index one of those orders reads.
CREATE INDEX library_items_by_location_saved ON library_items (location, saved_at, id);
CREATE INDEX library_items_by_saved ON library_items (saved_at, id);
CREATE INDEX library_items_by_title ON library_items (title, id);
CREATE INDEX library_items_by_opened ON library_items (last_opened_at, id) WHERE last_opened_at IS NOT NULL;

DROP TABLE library_fts;

-- Ranked title > headings > reason > author > content_text; see the search
-- query for the bm25 weights in the same column order.
CREATE VIRTUAL TABLE library_fts USING fts5(
    id UNINDEXED,
    title,
    author,
    reason,
    content_headings,
    content_text
);

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_insert AFTER INSERT ON library_items BEGIN
    INSERT INTO library_fts (id, title, author, reason, content_headings, content_text)
    VALUES (new.id, new.title, new.author, new.reason,
            CASE WHEN json_valid(new.content_headings)
                 THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                         FROM json_each(new.content_headings) WHERE type = 'object')
                 END,
            new.content_text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_update AFTER UPDATE ON library_items BEGIN
    UPDATE library_fts
    SET title = new.title,
        author = new.author,
        reason = new.reason,
        content_headings = CASE WHEN json_valid(new.content_headings)
                 THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                         FROM json_each(new.content_headings) WHERE type = 'object')
                 END,
        content_text = new.content_text
    WHERE id = old.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_delete AFTER DELETE ON library_items BEGIN
    DELETE FROM library_fts WHERE id = old.id;
END;
-- +goose StatementEnd

INSERT INTO library_fts (id, title, author, reason, content_headings, content_text)
SELECT id, title, author, reason,
       CASE WHEN json_valid(content_headings)
            THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                    FROM json_each(library_items.content_headings) WHERE type = 'object')
            END,
       content_text
  FROM library_items;

-- The library wrote the registry type for its own rows and core only stores
-- what a module hands it, so the library is what rewrites them. This is the
-- one place in the change where one module writes another's table, and it is
-- deliberate: a core migration that knew 'livro' meant a book would put the
-- knowledge in the module that never had it.
UPDATE core_items
   SET type = CASE type WHEN 'post' THEN 'article'
                        WHEN 'livro' THEN 'book'
                        WHEN 'curso' THEN 'course'
                        ELSE type END
 WHERE module = 'library';

-- Only the ids still present are restored; a row deleted while the rollback
-- was in force leaves its preserved location behind and the drop below takes
-- it with the table.
UPDATE library_items
   SET location = (SELECT location FROM library_location_preserved WHERE item_id = library_items.id)
 WHERE id IN (SELECT item_id FROM library_location_preserved);

DROP TABLE library_location_preserved;

-- +goose Down

CREATE TABLE library_location_preserved (
    item_id  TEXT PRIMARY KEY,
    location TEXT NOT NULL
);

INSERT INTO library_location_preserved (item_id, location)
SELECT id, location FROM library_items WHERE location IN ('up_next', 'stash');

CREATE TABLE library_items_old (
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

-- up_next is triage not yet started, which is what inbox means; stash is set
-- aside indefinitely, and arquivo is the closest the three-value column has.
INSERT INTO library_items_old (
    id, kind, url, canonical_url, title, title_edited, author, site,
    published_at, lead_image, why, selection, status, unread, saved_at,
    read_at, last_opened_at, read_position, source, html_hash, content_html,
    content_text, content_headings, extract_status, extract_generation,
    extracted_at, extract_error, minutes, meta, created_at, updated_at
)
SELECT id,
       CASE kind WHEN 'article' THEN 'post'
                 WHEN 'book' THEN 'livro'
                 WHEN 'course' THEN 'curso'
                 ELSE kind END,
       url, canonical_url, title, title_edited, author, site,
       published_at, lead_image, reason, selection,
       CASE location WHEN 'later' THEN 'depois'
                     WHEN 'archive' THEN 'arquivo'
                     WHEN 'up_next' THEN 'inbox'
                     WHEN 'stash' THEN 'arquivo'
                     ELSE location END,
       unread, saved_at,
       read_at, last_opened_at, read_position, source, html_hash, content_html,
       content_text, content_headings, extract_status, extract_generation,
       extracted_at, extract_error, minutes, meta, created_at, updated_at
  FROM library_items;

DROP TABLE library_items;

ALTER TABLE library_items_old RENAME TO library_items;

CREATE INDEX library_items_by_status_saved ON library_items (status, saved_at, id);
CREATE INDEX library_items_by_saved ON library_items (saved_at, id);
CREATE INDEX library_items_by_title ON library_items (title, id);
CREATE INDEX library_items_by_opened ON library_items (last_opened_at, id) WHERE last_opened_at IS NOT NULL;

-- DROP TABLE library_items took the three FTS triggers with it, so the search
-- index has to be rebuilt here and not only repopulated: a down step that
-- restored the rows and left the triggers behind would leave every later write
-- un-indexed, with no error and nothing failing.
DROP TABLE library_fts;

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
    VALUES (new.id, new.title, new.author, new.why,
            CASE WHEN json_valid(new.content_headings)
                 THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                         FROM json_each(new.content_headings) WHERE type = 'object')
                 END,
            new.content_text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_update AFTER UPDATE ON library_items BEGIN
    UPDATE library_fts
    SET title = new.title,
        author = new.author,
        why = new.why,
        content_headings = CASE WHEN json_valid(new.content_headings)
                 THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                         FROM json_each(new.content_headings) WHERE type = 'object')
                 END,
        content_text = new.content_text
    WHERE id = old.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_delete AFTER DELETE ON library_items BEGIN
    DELETE FROM library_fts WHERE id = old.id;
END;
-- +goose StatementEnd

INSERT INTO library_fts (id, title, author, why, content_headings, content_text)
SELECT id, title, author, why,
       CASE WHEN json_valid(content_headings)
            THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                    FROM json_each(library_items.content_headings) WHERE type = 'object')
            END,
       content_text
  FROM library_items;

UPDATE core_items
   SET type = CASE type WHEN 'article' THEN 'post'
                        WHEN 'book' THEN 'livro'
                        WHEN 'course' THEN 'curso'
                        ELSE type END
 WHERE module = 'library';
