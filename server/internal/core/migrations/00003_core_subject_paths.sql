-- The subject screen answers at /subjects/<slug>, and a subject's registry
-- url is written into core_items.url when the subject is created, so rows an
-- older build made carry /assuntos/<slug>. The registry url is stored, not
-- derived when a link is rendered, so the stored paths move with the route
-- here rather than pointing at a page the new build no longer serves. Only
-- the core's own registry rows move: another module that ever registered a
-- row under a subject-shaped url keeps it, and the down step mirrors the
-- rewrite exactly.

-- +goose Up
UPDATE core_items
SET url = '/subjects/' || substr(url, length('/assuntos/') + 1)
WHERE module = 'core' AND url LIKE '/assuntos/%';

-- +goose Down
UPDATE core_items
SET url = '/assuntos/' || substr(url, length('/subjects/') + 1)
WHERE module = 'core' AND url LIKE '/subjects/%';