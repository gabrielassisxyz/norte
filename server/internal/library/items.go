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
		set = append(set, "location = ?")
		args = append(args, *in.Location)
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

// Counts answers every count the library screen shows, from the one query
// that computes them all, so a list call never recomputes them.
func (s *LibraryService) Counts(ctx context.Context) (libraryapi.LibraryCounts, error) {
	row, err := db.New(s.database.Reader()).CountLibraryItems(ctx)
	if err != nil {
		return libraryapi.LibraryCounts{}, fmt.Errorf("counting the library: %w", err)
	}
	var counts libraryapi.LibraryCounts
	counts.Views.Inbox = int(row.Inbox)
	counts.Views.UpNext = int(row.UpNext)
	counts.Views.Later = int(row.Later)
	counts.Views.Archive = int(row.Archive)
	counts.Views.Stash = int(row.Stash)
	counts.Views.All = int(row.AllItems)
	counts.Kinds.Article = int(row.KindArticle)
	counts.Kinds.Book = int(row.KindBook)
	counts.Kinds.Paper = int(row.KindPaper)
	counts.Kinds.Video = int(row.KindVideo)
	counts.Kinds.Podcast = int(row.KindPodcast)
	counts.Kinds.Newsletter = int(row.KindNewsletter)
	counts.Kinds.Course = int(row.KindCourse)
	counts.Unread = int(row.Unread)
	return counts, nil
}

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
// answers.
func libraryMapItem(row db.LibraryItem) libraryapi.LibraryItem {
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
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
}

// libraryMapSummary renders a list row: everything but the extracted HTML and
// text, which never leave the server inside a list answer.
func libraryMapSummary(row db.LibraryItem) libraryapi.LibraryItemSummary {
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
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
}
