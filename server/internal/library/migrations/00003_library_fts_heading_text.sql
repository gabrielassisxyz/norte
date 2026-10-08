-- The headings column of library_fts held the JSON that library_items stores,
-- so the object keys (level, text, anchor) and every slug fragment of every
-- anchor were indexed words. Searching for "anchor" or "level" answered with
-- nearly the whole library, and the contract describes q as a query over the
-- title, the note and the extracted text -- not over a storage format.
--
-- The column keeps its name and its bm25 weight; only the value the triggers
-- put in it changes, to the heading titles joined by spaces. json_valid guards
-- the NULL and the garbage cases, because json_each raises on input it cannot
-- parse and a trigger that raises would make an item impossible to save.
--
-- The rebuild at the end is what corrects rows written before this migration:
-- library_fts is derived data in full, so deleting it and reinserting from
-- library_items costs nothing that is not recoverable from the table.
--
-- +goose Up

DROP TRIGGER library_items_fts_insert;
DROP TRIGGER library_items_fts_update;

-- +goose StatementBegin
CREATE TRIGGER library_items_fts_insert AFTER INSERT ON library_items BEGIN
    INSERT INTO library_fts (id, title, author, why, content_headings, content_text)
    VALUES (new.id, new.title, new.author, new.why,
            CASE WHEN json_valid(new.content_headings)
                 THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                         FROM json_each(new.content_headings))
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
                         FROM json_each(new.content_headings))
                 END,
        content_text = new.content_text
    WHERE id = old.id;
END;
-- +goose StatementEnd

DELETE FROM library_fts;

INSERT INTO library_fts (id, title, author, why, content_headings, content_text)
SELECT id, title, author, why,
       CASE WHEN json_valid(content_headings)
            THEN (SELECT group_concat(json_extract(value, '$.text'), ' ')
                    FROM json_each(library_items.content_headings))
            END,
       content_text
  FROM library_items;

-- +goose Down

DROP TRIGGER library_items_fts_insert;
DROP TRIGGER library_items_fts_update;

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

DELETE FROM library_fts;

INSERT INTO library_fts (id, title, author, why, content_headings, content_text)
SELECT id, title, author, why, content_headings, content_text FROM library_items;
