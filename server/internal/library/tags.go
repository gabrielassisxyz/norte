// The library's tag vocabulary: reading it back, and the endpoints that edit
// it by hand -- add and remove one item's tag, rename or merge a tag across
// the library, and list the vocabulary itself.
package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	libraryapi "github.com/gabrielassisxyz/norte/server/gen/api/library"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// libraryTagNameForWrite runs the one normalizer over a name that is about to
// be written through the API, and refuses what normalization leaves with
// nothing: a hand edit cannot mint a name the job's answers would never carry,
// or the hand vocabulary would fork from the automatic one.
func libraryTagNameForWrite(raw, field string) (string, error) {
	name := libraryNormalizeTagName(raw)
	if name == "" {
		return "", libraryBadRequest("invalid_request", "the tag is empty", field)
	}
	if utf8.RuneCountInString(name) > libraryTagMaxNameRunes {
		return "", libraryBadRequest("invalid_request",
			fmt.Sprintf("the tag is longer than %d characters", libraryTagMaxNameRunes), field)
	}
	return name, nil
}

// libraryNormalizedTagInput normalizes a name that only filters and reads, so
// a query in whatever casing finds the tag the vocabulary holds.
func libraryNormalizedTagInput(raw, field string) (string, error) {
	name := libraryNormalizeTagName(raw)
	if name == "" {
		return "", libraryBadRequest("invalid_request", "the tag is empty", field)
	}
	return name, nil
}

// ItemTags reads one item's tags, sorted, empty when it carries none.
func (s *LibraryService) ItemTags(ctx context.Context, itemID string) ([]string, error) {
	names, err := db.New(s.database.Reader()).ListLibraryItemTagNames(ctx, itemID)
	if err != nil {
		return nil, fmt.Errorf("reading the tags of %s: %w", itemID, err)
	}
	return names, nil
}

// TagsForItems reads the tags of many items in one query, grouped by item, so
// a page of summaries costs one lookup and not one per row. An id in the
// answer never appears with a nil slice: the mapping turns absence into an
// empty list, which is what the contract names.
func (s *LibraryService) TagsForItems(ctx context.Context, ids []string) (map[string][]string, error) {
	index := make(map[string][]string, len(ids))
	distinct := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		distinct = append(distinct, id)
	}
	if len(distinct) == 0 {
		return index, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(distinct)), ",")
	query := `SELECT item_id, tag_name FROM library_item_tags
	          WHERE item_id IN (` + placeholders + `) ORDER BY tag_name ASC`
	rows, err := s.database.Reader().QueryContext(ctx, query, libraryInArgs(distinct)...)
	if err != nil {
		return nil, fmt.Errorf("reading the tags of a page: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var itemID, name string
		if err := rows.Scan(&itemID, &name); err != nil {
			return nil, fmt.Errorf("reading a tag row: %w", err)
		}
		index[itemID] = append(index[itemID], name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading the tags of a page: %w", err)
	}
	return index, nil
}

// libraryInArgs copies ids into the []any the IN list binds.
func libraryInArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// Tags reads the whole vocabulary, most used first and equal counts in
// alphabetical order, which is the order the contract names.
func (s *LibraryService) Tags(ctx context.Context) ([]libraryapi.LibraryTag, error) {
	rows, err := db.New(s.database.Reader()).ListLibraryTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing the tags: %w", err)
	}
	tags := make([]libraryapi.LibraryTag, 0, len(rows))
	for _, row := range rows {
		tags = append(tags, libraryapi.LibraryTag{Name: row.Name, Count: int(row.ItemCount)})
	}
	return tags, nil
}

// AddItemTag records one hand add. The row it writes is whatever the item
// already carries: automatic becomes manual, manual stays manual, and a
// removal the person once made is taken back, because the record's whole
// purpose was keeping the tag away and the person has now brought it back.
func (s *LibraryService) AddItemTag(ctx context.Context, itemID, raw string) ([]string, error) {
	name, err := libraryTagNameForWrite(raw, "name")
	if err != nil {
		return nil, err
	}
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("beginning the tag add transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	if _, err := queries.GetLibraryItemByID(ctx, itemID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, libraryNotFound(itemID)
		}
		return nil, fmt.Errorf("reading the library item to tag: %w", err)
	}
	stamp := core.FormatTime(s.clock.Now())
	if err := queries.UpsertLibraryItemTagManual(ctx, db.UpsertLibraryItemTagManualParams{
		ItemID: itemID, TagName: name, CreatedAt: stamp,
	}); err != nil {
		return nil, fmt.Errorf("adding the tag %s: %w", name, err)
	}
	if err := queries.InsertLibraryTag(ctx, db.InsertLibraryTagParams{Name: name, CreatedAt: stamp}); err != nil {
		return nil, fmt.Errorf("recording the tag %s: %w", name, err)
	}
	if err := queries.DropLibraryRemovedItemTag(ctx, db.DropLibraryRemovedItemTagParams{
		ItemID: itemID, TagName: name,
	}); err != nil {
		return nil, fmt.Errorf("forgiving the removal of %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("committing the tag add: %w", err)
	}
	return s.ItemTags(ctx, itemID)
}

// RemoveItemTag takes one tag off an item and records the removal, so the
// tagger's every later answer for the item is short that name. The tag row
// itself is retired the moment its last item is gone, by the same prune the
// tagger writes run.
func (s *LibraryService) RemoveItemTag(ctx context.Context, itemID, raw string) ([]string, error) {
	name, err := libraryTagNameForWrite(raw, "name")
	if err != nil {
		return nil, err
	}
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("beginning the tag removal transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	if _, err := queries.GetLibraryItemByID(ctx, itemID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, libraryNotFound(itemID)
		}
		return nil, fmt.Errorf("reading the library item to untag: %w", err)
	}
	rows, err := queries.ListLibraryItemTagRows(ctx, itemID)
	if err != nil {
		return nil, fmt.Errorf("reading the tags of %s: %w", itemID, err)
	}
	carries := false
	for _, row := range rows {
		if row.TagName == name {
			carries = true
			break
		}
	}
	if !carries {
		return nil, &LibraryError{
			Status:  404,
			Code:    "not_found",
			Message: fmt.Sprintf("the item %s does not carry the tag %q", itemID, name),
		}
	}
	stamp := core.FormatTime(s.clock.Now())
	if err := queries.DeleteLibraryItemTag(ctx, db.DeleteLibraryItemTagParams{
		ItemID: itemID, TagName: name,
	}); err != nil {
		return nil, fmt.Errorf("removing the tag %s: %w", name, err)
	}
	if err := queries.RecordLibraryRemovedItemTag(ctx, db.RecordLibraryRemovedItemTagParams{
		ItemID: itemID, TagName: name, CreatedAt: stamp,
	}); err != nil {
		return nil, fmt.Errorf("recording the removal of %s: %w", name, err)
	}
	if err := queries.PruneUnusedLibraryTags(ctx); err != nil {
		return nil, fmt.Errorf("retiring tags nothing carries: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("committing the tag removal: %w", err)
	}
	return s.ItemTags(ctx, itemID)
}

// RenameTag points one tag's name elsewhere across the library. When the new
// name is already a tag, the two become one: the item rows are unioned with a
// manual origin beating an automatic one on a collision, and a person's
// removal of the target tag is not overridden -- an item that removed it by
// hand keeps neither tag, which is the merge reading the removals rather than
// steamrolling them.
//
// The removed-by-hand records follow the rename, so a refusal made under the
// old name keeps refusing under the new one, and a merge is undone by nothing
// the tagger might later answer.
func (s *LibraryService) RenameTag(ctx context.Context, rawFrom, rawTo string) (libraryapi.LibraryTag, error) {
	oldName, err := libraryNormalizedTagInput(rawFrom, "name")
	if err != nil {
		return libraryapi.LibraryTag{}, err
	}
	newName, err := libraryTagNameForWrite(rawTo, "name")
	if err != nil {
		return libraryapi.LibraryTag{}, err
	}
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return libraryapi.LibraryTag{}, fmt.Errorf("beginning the tag rename transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	if _, err := queries.GetLibraryTag(ctx, oldName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return libraryapi.LibraryTag{}, libraryNotFoundTag(oldName)
		}
		return libraryapi.LibraryTag{}, fmt.Errorf("reading the tag %s: %w", oldName, err)
	}
	if oldName != newName {
		if err := queries.MoveLibraryItemTags(ctx, db.MoveLibraryItemTagsParams{
			TagName: newName, TagName_2: oldName, TagName_3: newName,
		}); err != nil {
			return libraryapi.LibraryTag{}, fmt.Errorf("moving the items of %s onto %s: %w", oldName, newName, err)
		}
		if err := queries.MoveLibraryRemovedItemTags(ctx, db.MoveLibraryRemovedItemTagsParams{
			TagName: newName, TagName_2: oldName,
		}); err != nil {
			return libraryapi.LibraryTag{}, fmt.Errorf("moving the removals of %s onto %s: %w", oldName, newName, err)
		}
		if err := queries.DeleteLibraryRemovedItemTagRows(ctx, oldName); err != nil {
			return libraryapi.LibraryTag{}, fmt.Errorf("forgetting %s's own removal rows: %w", oldName, err)
		}
		if err := queries.DeleteLibraryTagItemRows(ctx, oldName); err != nil {
			return libraryapi.LibraryTag{}, fmt.Errorf("forgetting %s's item rows: %w", oldName, err)
		}
		if err := queries.RenameLibraryTag(ctx, db.RenameLibraryTagParams{
			Name: newName, Name_2: oldName,
		}); err != nil {
			return libraryapi.LibraryTag{}, fmt.Errorf("renaming %s to %s: %w", oldName, newName, err)
		}
		if err := queries.PruneUnusedLibraryTags(ctx); err != nil {
			return libraryapi.LibraryTag{}, fmt.Errorf("retiring tags nothing carries: %w", err)
		}
	}
	count, err := queries.CountLibraryItemTagUses(ctx, newName)
	if err != nil {
		return libraryapi.LibraryTag{}, fmt.Errorf("counting the items of %s: %w", newName, err)
	}
	if err := tx.Commit(); err != nil {
		return libraryapi.LibraryTag{}, fmt.Errorf("committing the tag rename: %w", err)
	}
	return libraryapi.LibraryTag{Name: newName, Count: int(count)}, nil
}

// libraryNotFoundTag is not found, but for a tag: the envelope is the item's.
func libraryNotFoundTag(name string) *LibraryError {
	return &LibraryError{Status: 404, Code: "not_found", Message: fmt.Sprintf("no tag %q", name)}
}

// Counts answers every count the library screen shows, over the whole library
// or over only the items carrying the asked-for tag, from the one query that
// computes them all, so a list call never recomputes them.
func (s *LibraryService) Counts(ctx context.Context, tag string) (libraryapi.LibraryCounts, error) {
	filtered := ""
	if strings.TrimSpace(tag) != "" {
		name, err := libraryNormalizedTagInput(tag, "tag")
		if err != nil {
			return libraryapi.LibraryCounts{}, err
		}
		filtered = name
	}
	if filtered == "" {
		row, err := db.New(s.database.Reader()).CountLibraryItems(ctx)
		if err != nil {
			return libraryapi.LibraryCounts{}, fmt.Errorf("counting the library: %w", err)
		}
		return libraryMapCounts(row.Inbox, row.UpNext, row.Later, row.Archive, row.Stash,
			row.AllItems, row.KindArticle, row.KindBook, row.KindPaper, row.KindVideo,
			row.KindPodcast, row.KindNewsletter, row.KindCourse, row.Unread), nil
	}
	row, err := db.New(s.database.Reader()).CountLibraryItemsByTag(ctx, filtered)
	if err != nil {
		return libraryapi.LibraryCounts{}, fmt.Errorf("counting the library by tag: %w", err)
	}
	return libraryMapCounts(row.Inbox, row.UpNext, row.Later, row.Archive, row.Stash,
		row.AllItems, row.KindArticle, row.KindBook, row.KindPaper, row.KindVideo,
		row.KindPodcast, row.KindNewsletter, row.KindCourse, row.Unread), nil
}

func libraryMapCounts(inbox, upNext, later, archive, stash, all, kindArticle, kindBook, kindPaper,
	kindVideo, kindPodcast, kindNewsletter, kindCourse, unread int64,
) libraryapi.LibraryCounts {
	var counts libraryapi.LibraryCounts
	counts.Views.Inbox = int(inbox)
	counts.Views.UpNext = int(upNext)
	counts.Views.Later = int(later)
	counts.Views.Archive = int(archive)
	counts.Views.Stash = int(stash)
	counts.Views.All = int(all)
	counts.Kinds.Article = int(kindArticle)
	counts.Kinds.Book = int(kindBook)
	counts.Kinds.Paper = int(kindPaper)
	counts.Kinds.Video = int(kindVideo)
	counts.Kinds.Podcast = int(kindPodcast)
	counts.Kinds.Newsletter = int(kindNewsletter)
	counts.Kinds.Course = int(kindCourse)
	counts.Unread = int(unread)
	return counts
}

// AddLibraryItemTag answers the hand add: the item's tags after it, sorted.
func (h LibraryHandlers) AddLibraryItemTag(ctx context.Context, request libraryapi.AddLibraryItemTagRequestObject) (libraryapi.AddLibraryItemTagResponseObject, error) {
	if request.Body == nil {
		return libraryAddTagDefault(http.StatusBadRequest, "invalid_request", "the add carries no body", "body", ctx), nil
	}
	tags, err := h.service.AddItemTag(ctx, request.Id, request.Body.Name)
	if err != nil {
		return libraryAddTagError(err, ctx)
	}
	return libraryapi.AddLibraryItemTag200JSONResponse(libraryapi.ItemTags{Tags: tags}), nil
}

// RemoveLibraryItemTag answers the hand removal: the item's tags after it,
// with the removal recorded where the tagger reads it.
func (h LibraryHandlers) RemoveLibraryItemTag(ctx context.Context, request libraryapi.RemoveLibraryItemTagRequestObject) (libraryapi.RemoveLibraryItemTagResponseObject, error) {
	tags, err := h.service.RemoveItemTag(ctx, request.Id, request.Name)
	if err != nil {
		return libraryRemoveTagError(err, ctx)
	}
	return libraryapi.RemoveLibraryItemTag200JSONResponse(libraryapi.ItemTags{Tags: tags}), nil
}

// ListLibraryTags answers the vocabulary, most used first.
func (h LibraryHandlers) ListLibraryTags(ctx context.Context, _ libraryapi.ListLibraryTagsRequestObject) (libraryapi.ListLibraryTagsResponseObject, error) {
	tags, err := h.service.Tags(ctx)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.ListLibraryTagsdefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return libraryapi.ListLibraryTags200JSONResponse(libraryapi.LibraryTagList{Tags: tags}), nil
}

// PatchLibraryTag answers the rename, or the merge it folds into: the tag as
// it stands afterwards, with the item count the rename left on it.
func (h LibraryHandlers) PatchLibraryTag(ctx context.Context, request libraryapi.PatchLibraryTagRequestObject) (libraryapi.PatchLibraryTagResponseObject, error) {
	if request.Body == nil {
		return libraryPatchTagDefault(http.StatusBadRequest, "invalid_request", "the patch carries no body", "body", ctx), nil
	}
	tag, err := h.service.RenameTag(ctx, request.Name, request.Body.Name)
	if err != nil {
		return libraryPatchTagError(err, ctx)
	}
	return libraryapi.PatchLibraryTag200JSONResponse(tag), nil
}

// The four error mappings, one per operation so the generated default type is
// the one the operation owns.
func libraryAddTagDefault(status int, code, message, field string, ctx context.Context) libraryapi.AddLibraryItemTagdefaultJSONResponse {
	return libraryapi.AddLibraryItemTagdefaultJSONResponse{
		Body:       libraryErrorBody(&LibraryError{Status: status, Code: code, Message: message, Field: field}, ctx),
		StatusCode: status,
	}
}

func libraryAddTagError(err error, ctx context.Context) (libraryapi.AddLibraryItemTagResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryAddTagDefault(domain.Status, domain.Code, domain.Message, domain.Field, ctx), nil
	}
	return nil, err
}

func libraryRemoveTagError(err error, ctx context.Context) (libraryapi.RemoveLibraryItemTagResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryapi.RemoveLibraryItemTagdefaultJSONResponse{
			Body:       libraryErrorBody(domain, ctx),
			StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}

func libraryPatchTagDefault(status int, code, message, field string, ctx context.Context) libraryapi.PatchLibraryTagdefaultJSONResponse {
	return libraryapi.PatchLibraryTagdefaultJSONResponse{
		Body:       libraryErrorBody(&LibraryError{Status: status, Code: code, Message: message, Field: field}, ctx),
		StatusCode: status,
	}
}

func libraryPatchTagError(err error, ctx context.Context) (libraryapi.PatchLibraryTagResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryPatchTagDefault(domain.Status, domain.Code, domain.Message, domain.Field, ctx), nil
	}
	return nil, err
}
