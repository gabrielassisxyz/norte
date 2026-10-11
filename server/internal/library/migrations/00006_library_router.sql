-- The router: where a newly saved link lands, and what said so.
--
--   library_domain_rules  the person's own standing answer for a host:
--                         "pinterest.com goes to the stash". Only the two
--                         locations the router may choose between are
--                         storable, because a rule is read at save time and
--                         the other three locations are moves the person
--                         makes afterwards. The domain is the PRIMARY KEY, so
--                         one host cannot carry two answers; a rule matches
--                         its subdomains in Go, where the longest match wins.
--
--   location_source       which of the three deciders placed the item: a
--                         rule, the Laya decider, or the default. The two
--                         remaining values are the ones nothing automatic may
--                         override -- a move the person made by hand (user)
--                         and an import's own destination (import).
--
-- ADD COLUMN and not a rebuild: library_item_tags and library_item_removed_tags
-- reference library_items (id) ON DELETE CASCADE and the store opens SQLite
-- with foreign keys on, so the create-copy-drop-rename 00004 used would
-- cascade-delete every tag and every hand-removal record on the way past.
-- The CHECK travels with the column, which is why this is one statement and
-- not a column plus a trigger.
--
-- +goose Up

CREATE TABLE library_domain_rules (
    domain     TEXT PRIMARY KEY,
    location   TEXT NOT NULL CHECK (location IN ('inbox', 'stash')),
    created_at TEXT NOT NULL
);

ALTER TABLE library_items
    ADD COLUMN location_source TEXT NOT NULL DEFAULT 'default'
    CHECK (location_source IN ('rule', 'decider', 'default', 'user', 'import'));

-- +goose Down

-- Every row already in the table keeps the location it has: the down step
-- forgets who chose it, which is what the column is, and never moves an item.
ALTER TABLE library_items DROP COLUMN location_source;

DROP TABLE library_domain_rules;
