-- The core's tables: the part of Norte that is always on, whatever modules a
-- binary was built with or a setting switched off.
--
-- Conventions every table here and in every module follows:
--   * id TEXT PRIMARY KEY holding a UUIDv7 string (see core.NewID)
--   * created_at / updated_at as fixed-width UTC text (see core.TimeLayout)
--   * the owner's prefix on the table name -- core_ here
--   * foreign keys only between tables of the same owner
--   * a CHECK on every column with a closed set of values
--
-- module and type carry no CHECK on purpose: their values are owned by whatever
-- modules this binary was built with, and a CHECK here would have to be edited
-- by a migration in another owner's package every time one is added.

-- +goose Up

-- The registry of everything that can be one end of a link. A module inserts a
-- row whenever it creates something linkable, and holds only what is needed to
-- *open* the thing -- its type, its title, the url to follow. Nothing needed to
-- read it: no author, no cover, no publication date. That is deliberate. The
-- registry exists so a link stays renderable when the module owning the other
-- end is switched off, and a second copy of data a module already owns would be
-- a second source of truth going stale in the dark.
CREATE TABLE core_items (
    id         TEXT PRIMARY KEY,
    module     TEXT NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    url        TEXT,
    created_at TEXT NOT NULL
);

-- The only relation mechanism between modules. Both ends are core_items rows,
-- so the foreign keys stay inside the core and no module's table references
-- another module's -- the rule that lets a module be switched off without
-- leaving dangling references behind it.
CREATE TABLE core_links (
    id         TEXT PRIMARY KEY,
    src_id     TEXT NOT NULL REFERENCES core_items (id) ON DELETE CASCADE,
    dst_id     TEXT NOT NULL REFERENCES core_items (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('about', 'material_of', 'derived_from', 'blocks')),
    source     TEXT NOT NULL CHECK (source IN ('manual', 'llm')),
    status     TEXT NOT NULL CHECK (status IN ('confirmed', 'suggested', 'rejected')),
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    created_at TEXT NOT NULL,
    decided_at TEXT
);

-- One row per (src, dst, kind). Suggesting a link that is already confirmed has
-- to update the row that is there rather than add a second one, and this index
-- is what makes that an upsert instead of a read followed by a guess.
CREATE UNIQUE INDEX core_links_triple ON core_links (src_id, dst_id, kind);

-- The two directions a link is read in: what points at this item, and what this
-- item points at -- each filtered by status, because a screen shows confirmed
-- links and a review queue shows suggested ones.
CREATE INDEX core_links_by_dst ON core_links (dst_id, status);
CREATE INDEX core_links_by_src ON core_links (src_id, status);

-- The stable vocabulary the library groups by. focus marks the handful a person
-- is working on now.
CREATE TABLE core_subjects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    focus      INTEGER NOT NULL DEFAULT 0 CHECK (focus IN (0, 1)),
    created_at TEXT NOT NULL
);

-- Spellings that mean an existing subject, so "ML" and "machine-learning" do
-- not become two vocabulary entries.
CREATE TABLE core_subject_aliases (
    alias_slug TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES core_subjects (id) ON DELETE CASCADE
);

-- The durable work queue. The worker that leases and runs these is its own
-- bead; this is the table it will lease from.
CREATE TABLE core_jobs (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    payload      TEXT NOT NULL DEFAULT '{}',
    dedupe_key   TEXT,
    status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_until  TEXT,
    lease_owner  TEXT,
    last_error   TEXT,
    created_at   TEXT NOT NULL,
    started_at   TEXT,
    finished_at  TEXT
);

-- What the worker asks for: the next job that is due.
CREATE INDEX core_jobs_runnable ON core_jobs (status, available_at);

-- Enqueueing the same work twice while it is still outstanding is one job. The
-- index is partial because a finished job must not block the next one with the
-- same key: "fetch this page" is meant to be enqueueable again tomorrow.
CREATE UNIQUE INDEX core_jobs_dedupe ON core_jobs (dedupe_key) WHERE status IN ('queued', 'running');

-- The content-addressed blob store's index. The hash is the primary key, so the
-- same bytes stored twice are one row and one file.
CREATE TABLE core_files (
    hash       TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- Who needs a blob, and what it is to them. kind decides what may be served
-- later: a snapshot is a page's raw HTML and is never sent to a browser, while
-- material_file and cover are. The cascade on owner_id is what makes deleting an
-- item release its blobs for `norte files gc`; hash has no cascade, so a blob
-- cannot be dropped out from under a reference.
CREATE TABLE core_file_refs (
    hash     TEXT NOT NULL REFERENCES core_files (hash),
    owner_id TEXT NOT NULL REFERENCES core_items (id) ON DELETE CASCADE,
    kind     TEXT NOT NULL CHECK (kind IN ('snapshot', 'material_file', 'cover')),
    PRIMARY KEY (hash, owner_id, kind)
);

-- Preferences and cursors the server itself has to know, as opposed to the
-- settings that arrive through the environment and the config file.
CREATE TABLE core_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- +goose Down
DROP TABLE core_settings;
DROP TABLE core_file_refs;
DROP TABLE core_files;
DROP TABLE core_jobs;
DROP TABLE core_subject_aliases;
DROP TABLE core_subjects;
DROP TABLE core_links;
DROP TABLE core_items;
