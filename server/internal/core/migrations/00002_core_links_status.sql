-- The suggestion queue reads core_links by status alone, newest first. The two
-- indexes from the first migration both lead with an item id, so neither can
-- serve a query that names no item: without this one, emptying the queue scans
-- every link in the database and sorts the result.

-- +goose Up
CREATE INDEX core_links_by_status ON core_links (status, created_at);

-- +goose Down
DROP INDEX core_links_by_status;
