package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	libraryapi "github.com/gabrielassisxyz/norte/server/gen/api/library"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// Get returns one item by id. A read never writes.
func (s *LibraryService) Get(ctx context.Context, id string) (db.LibraryItem, error) {
	row, err := db.New(s.database.Reader()).GetLibraryItemByID(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return db.LibraryItem{}, libraryNotFound(id)
		}
		return db.LibraryItem{}, fmt.Errorf("reading the library item: %w", err)
	}
	return row, nil
}

// PatchInput carries the fields a PATCH may change; a nil field is left alone.
type PatchInput struct {
	Location     *string
	Unread       *bool
	Reason       *string
	Kind         *string
	Title        *string
	ReadPosition *string
}

// valid patch values, checked here as well as by the contract.
var (
	libraryValidLocations = map[string]bool{
		"inbox": true, "up_next": true, "later": true, "archive": true, "stash": true,
	}
	libraryValidKinds = map[string]bool{
		"article": true, "book": true, "paper": true, "video": true,
		"podcast": true, "newsletter": true, "course": true,
	}
)

// Patch applies the fields present and returns the item after the change.
// Setting unread records the read event, or clears it; retitling marks the
// title as the person's own and follows the registry row; retyping follows
// the registry type.
func (s *LibraryService) Patch(ctx context.Context, id string, in PatchInput) (db.LibraryItem, error) {
	if in.Location != nil && !libraryValidLocations[*in.Location] {
		return db.LibraryItem{}, libraryBadRequest("invalid_request", fmt.Sprintf("unknown location %q", *in.Location), "location")
	}
	if in.Kind != nil && !libraryValidKinds[*in.Kind] {
		return db.LibraryItem{}, libraryBadRequest("invalid_request", fmt.Sprintf("unknown kind %q", *in.Kind), "kind")
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.LibraryItem{}, libraryBadRequest("invalid_request", "the title is empty", "title")
	}
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return db.LibraryItem{}, fmt.Errorf("beginning the patch transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	existing, err := queries.GetLibraryItemByID(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return db.LibraryItem{}, libraryNotFound(id)
		}
		return db.LibraryItem{}, fmt.Errorf("reading the library item: %w", err)
	}
	now := s.clock.Now()
	stamp := core.FormatTime(now)
	set := []string{"updated_at = ?"}
	args := []any{stamp}
	newTitle, newKind := existing.Title, existing.Kind
	if in.Location != nil {
		// The person naming a location is the one placement nothing
		// automatic may undo, so the move and the record of who made it are
		// one write. It is recorded even when the location they named is the
		// one the item already has: they have said where it belongs, and the
		// decider asking again would be asking a question already answered.
		set = append(set, "location = ?", "location_source = ?")
		args = append(args, *in.Location, libraryLocationSourceUser)
	}
	if in.Unread != nil {
		if *in.Unread {
			set = append(set, "unread = 1", "read_at = NULL")
		} else {
			set = append(set, "unread = 0", "read_at = ?")
			args = append(args, stamp)
		}
	}
	if in.Reason != nil {
		set = append(set, "reason = ?")
		args = append(args, sql.NullString{String: *in.Reason, Valid: *in.Reason != ""})
	}
	if in.Kind != nil {
		set = append(set, "kind = ?")
		args = append(args, *in.Kind)
		newKind = *in.Kind
	}
	if in.Title != nil {
		set = append(set, "title = ?", "title_edited = 1")
		args = append(args, *in.Title)
		newTitle = *in.Title
	}
	if in.ReadPosition != nil {
		set = append(set, "read_position = ?")
		args = append(args, sql.NullString{String: *in.ReadPosition, Valid: *in.ReadPosition != ""})
	}
	args = append(args, id)
	if _, err := tx.ExecContext(ctx,
		`UPDATE library_items SET `+joinLibrarySet(set)+` WHERE id = ?`, args...); err != nil {
		return db.LibraryItem{}, fmt.Errorf("patching the library item: %w", err)
	}
	if newTitle != existing.Title || newKind != existing.Kind {
		if err := core.UpdateItem(ctx, tx, id, newTitle, newKind); err != nil {
			return db.LibraryItem{}, err
		}
	}
	updated, err := queries.GetLibraryItemByID(ctx, id)
	if err != nil {
		return db.LibraryItem{}, fmt.Errorf("reading the patched item: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return db.LibraryItem{}, fmt.Errorf("committing the patch: %w", err)
	}
	return updated, nil
}

// LibraryItemDeletedEvent is published after a delete commits. The notes
// module subscribes to it to take the highlights, margin notes and note of
// the item with it; the library knows nothing about those tables and must not.
const LibraryItemDeletedEvent = "library.item_deleted"

// Delete removes an item and everything that belongs only to it, then tells
// the rest of the process it is gone.
//
// One transaction carries the row, the registry entry and the shared tag
// vocabulary: the item's own tag rows follow the row by cascade and the
// full-text row by trigger, but the vocabulary does not, and the tag
// migration's header requires every path that deletes item-tag rows to retire
// the tags no item carries any more. The registry row has no foreign key to
// this table, so UnregisterItem is what takes the cross-module links, the
// suggestions and the snapshot's file reference with it; the blob itself stays
// on disk until `norte files gc` runs, which is the only thing that deletes a
// blob.
//
// The event is published after the commit rather than inside it, because a
// subscriber writes its own tables and a reaction to a delete that was rolled
// back would delete what is still there. The error comes back to the caller:
// a failed reaction leaves rows pointing at an item that is gone, and the
// person has to be told rather than shown a quiet success.
func (s *LibraryService) Delete(ctx context.Context, id string) error {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the delete transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	result, err := queries.DeleteLibraryItem(ctx, id)
	if err != nil {
		return fmt.Errorf("deleting the library item %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("reading the deleted rows of %s: %w", id, err)
	}
	if affected == 0 {
		return libraryNotFound(id)
	}
	if err := queries.PruneUnusedLibraryTags(ctx); err != nil {
		return fmt.Errorf("retiring the tags of %s: %w", id, err)
	}
	if err := core.UnregisterItem(ctx, tx, id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the delete of %s: %w", id, err)
	}
	if s.events == nil {
		return nil
	}
	if err := s.events.Publish(ctx, core.Event{
		Name:    LibraryItemDeletedEvent,
		Payload: map[string]string{"item_id": id},
	}); err != nil {
		return fmt.Errorf("publishing %s for %s: %w", LibraryItemDeletedEvent, id, err)
	}
	return nil
}

// Open records that an item was opened. Opening is not reading: unread and
// read_at are left exactly as they were.
func (s *LibraryService) Open(ctx context.Context, id string) (db.LibraryItem, error) {
	stamp := core.FormatTime(s.clock.Now())
	result, err := db.New(s.database.Writer()).MarkLibraryItemOpened(ctx, db.MarkLibraryItemOpenedParams{
		LastOpenedAt: sql.NullString{String: stamp, Valid: true},
		UpdatedAt:    stamp,
		ID:           id,
	})
	if err != nil {
		return db.LibraryItem{}, fmt.Errorf("recording the opening: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return db.LibraryItem{}, fmt.Errorf("reading the opened rows: %w", err)
	}
	if affected == 0 {
		return db.LibraryItem{}, libraryNotFound(id)
	}
	return s.Get(ctx, id)
}

// Counts is in tags.go, beside the tag-filtered variant the same endpoint
// answers: both count the library, and separating them would make the
// untagged read look like a different thing.

func joinLibrarySet(set []string) string {
	out := ""
	for i, clause := range set {
		if i > 0 {
			out += ", "
		}
		out += clause
	}
	return out
}

// libraryNullString maps a NULL column to an absent field.
func libraryNullString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	out := value.String
	return &out
}

// libraryNullInt maps a NULL column to an absent field.
func libraryNullInt(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	out := int(value.Int64)
	return &out
}

// libraryMapSelection decodes the stored {exact, prefix, suffix} JSON.
func libraryMapSelection(value sql.NullString) *libraryapi.TextSelection {
	if !value.Valid || value.String == "" {
		return nil
	}
	var decoded libraryapi.TextSelection
	if err := json.Unmarshal([]byte(value.String), &decoded); err != nil {
		return nil
	}
	return &decoded
}

// libraryMapReadPosition decodes the stored {v, anchor, percent} JSON.
func libraryMapReadPosition(value sql.NullString) *libraryapi.ReadPosition {
	if !value.Valid || value.String == "" {
		return nil
	}
	var raw struct {
		V       *int     `json:"v"`
		Anchor  *string  `json:"anchor"`
		Percent *float64 `json:"percent"`
	}
	if err := json.Unmarshal([]byte(value.String), &raw); err != nil {
		return nil
	}
	mapped := &libraryapi.ReadPosition{V: raw.V, Anchor: raw.Anchor}
	if raw.Percent != nil {
		percent := float32(*raw.Percent)
		mapped.Percent = &percent
	}
	return mapped
}

// libraryMapItem renders the whole record for the detail, patch and open
// answers. The item's tags arrive from the caller, which reads them beside
// the row so a detail read costs one query and not one embedded in the scan;
// absence is an empty list, which is what the contract names.
func libraryMapItem(row db.LibraryItem, tags []string) libraryapi.LibraryItem {
	return libraryapi.LibraryItem{
		Id:                row.ID,
		Kind:              libraryapi.ItemKind(row.Kind),
		Url:               row.Url,
		CanonicalUrl:      row.CanonicalUrl,
		Title:             row.Title,
		TitleEdited:       row.TitleEdited == 1,
		Author:            libraryNullString(row.Author),
		Site:              libraryNullString(row.Site),
		PublishedAt:       libraryNullString(row.PublishedAt),
		LeadImage:         libraryNullString(row.LeadImage),
		Reason:            libraryNullString(row.Reason),
		Selection:         libraryMapSelection(row.Selection),
		Location:          libraryapi.ItemLocation(row.Location),
		Unread:            row.Unread == 1,
		SavedAt:           row.SavedAt,
		ReadAt:            libraryNullString(row.ReadAt),
		LastOpenedAt:      libraryNullString(row.LastOpenedAt),
		ReadPosition:      libraryMapReadPosition(row.ReadPosition),
		Source:            libraryapi.ItemSource(row.Source),
		HtmlHash:          libraryNullString(row.HtmlHash),
		ContentHtml:       libraryNullString(row.ContentHtml),
		ContentText:       libraryNullString(row.ContentText),
		ContentHeadings:   libraryNullString(row.ContentHeadings),
		ExtractStatus:     libraryapi.ExtractStatus(row.ExtractStatus),
		ExtractGeneration: int(row.ExtractGeneration),
		ExtractedAt:       libraryNullString(row.ExtractedAt),
		ExtractError:      libraryNullString(row.ExtractError),
		Minutes:           libraryNullInt(row.Minutes),
		Tags:              librarySortedTags(tags),
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
}

// librarySortedTags is the list the contract names: the schema's tags is
// optional only so older clients can ignore it and the mappers set it always
// -- a non-nil pointer, empty when the item carries none, in the order its
// query produced, which is alphabetical.
func librarySortedTags(tags []string) *[]string {
	if tags == nil {
		empty := []string{}
		return &empty
	}
	return &tags
}

// libraryMapSummary renders a list row: everything but the extracted HTML and
// text, which never leave the server inside a list answer.
func libraryMapSummary(row db.LibraryItem, tags []string) libraryapi.LibraryItemSummary {
	return libraryapi.LibraryItemSummary{
		Id:                row.ID,
		Kind:              libraryapi.ItemKind(row.Kind),
		Url:               row.Url,
		CanonicalUrl:      row.CanonicalUrl,
		Title:             row.Title,
		TitleEdited:       row.TitleEdited == 1,
		Author:            libraryNullString(row.Author),
		Site:              libraryNullString(row.Site),
		PublishedAt:       libraryNullString(row.PublishedAt),
		LeadImage:         libraryNullString(row.LeadImage),
		Reason:            libraryNullString(row.Reason),
		Selection:         libraryMapSelection(row.Selection),
		Location:          libraryapi.ItemLocation(row.Location),
		Unread:            row.Unread == 1,
		SavedAt:           row.SavedAt,
		ReadAt:            libraryNullString(row.ReadAt),
		LastOpenedAt:      libraryNullString(row.LastOpenedAt),
		ReadPosition:      libraryMapReadPosition(row.ReadPosition),
		Source:            libraryapi.ItemSource(row.Source),
		HtmlHash:          libraryNullString(row.HtmlHash),
		ContentHeadings:   libraryNullString(row.ContentHeadings),
		ExtractStatus:     libraryapi.ExtractStatus(row.ExtractStatus),
		ExtractGeneration: int(row.ExtractGeneration),
		ExtractedAt:       libraryNullString(row.ExtractedAt),
		ExtractError:      libraryNullString(row.ExtractError),
		Minutes:           libraryNullInt(row.Minutes),
		Tags:              librarySortedTags(tags),
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
}
