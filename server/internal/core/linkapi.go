package core

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

const (
	linkDefaultListLimit = 50
	linkMaxListLimit     = 200
)

// LinkRecord is a link with both of its ends resolved from the item registry,
// which is what lets a client render one without asking the owning module
// anything.
type LinkRecord struct {
	Row db.CoreLink
	Src db.CoreItem
	Dst db.CoreItem
}

// LinkPage is one page of links, with the cursor for the next one or "" when
// this page is the last.
type LinkPage struct {
	Items      []LinkRecord
	NextCursor string
}

// LinkListInput is what GET /api/core/links filters by. Every field is
// optional; status on its own is the suggestion queue.
type LinkListInput struct {
	SrcID  string
	DstID  string
	Kind   string
	Status string
	Cursor string
	Limit  int
}

// LinkAPI is the service behind the core's link endpoints: creating a manual
// link, reading the queue, and deciding a suggestion.
type LinkAPI struct {
	database *Database
	clock    Clock
}

// NewLinkAPI wires the service over the database and the clock.
func NewLinkAPI(database *Database, clock Clock) *LinkAPI {
	return &LinkAPI{database: database, clock: clock}
}

var validLinkKinds = map[string]bool{
	LinkKindAbout:       true,
	LinkKindMaterialOf:  true,
	LinkKindDerivedFrom: true,
	LinkKindBlocks:      true,
}

var validLinkStatuses = map[string]bool{
	LinkStatusConfirmed: true,
	LinkStatusSuggested: true,
	LinkStatusRejected:  true,
}

// Create asserts a manual link. An end that is not in the registry is refused
// before anything is written, because a link to an unregistered id renders as
// a row pointing at nothing.
func (s *LinkAPI) Create(ctx context.Context, srcID, dstID, kind string) (LinkRecord, error) {
	if kind == "" {
		kind = LinkKindAbout
	}
	if !validLinkKinds[kind] {
		return LinkRecord{}, apiBadRequest("invalid_request", fmt.Sprintf("unknown link kind %q", kind), "kind")
	}
	if srcID == dstID {
		return LinkRecord{}, apiBadRequest("invalid_request", "a link joins two different items", "dst_id")
	}
	err := s.inWriteTx(ctx, func(tx *sql.Tx) error {
		queries := db.New(tx)
		// Checked in a fixed order, so a request with both ends unknown always
		// names the same one and the message does not change between runs.
		for _, end := range []struct{ field, id string }{{"src_id", srcID}, {"dst_id", dstID}} {
			id := end.id
			field := end.field
			if _, err := queries.GetCoreItem(ctx, id); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return apiBadRequest("unknown_item",
						fmt.Sprintf("%s is not in the item registry", id), field)
				}
				return fmt.Errorf("reading the registry item %s: %w", id, err)
			}
		}
		return Links.Confirm(ctx, tx, s.clock.Now(), srcID, dstID, kind)
	})
	if err != nil {
		return LinkRecord{}, err
	}
	row, err := db.New(s.database.Reader()).GetCoreLinkByTriple(ctx, db.GetCoreLinkByTripleParams{
		SrcID: srcID,
		DstID: dstID,
		Kind:  kind,
	})
	if err != nil {
		return LinkRecord{}, fmt.Errorf("reading the link that was just confirmed: %w", err)
	}
	return s.resolve(ctx, row.ID)
}

// Decide accepts or rejects a suggestion. A rejected row stays as the record
// that the pair was rejected, so the same suggestion does not come back.
//
// Only a suggested link can be decided. A confirmed one may be a person's own
// assertion and a rejected one their recorded refusal, so deciding either again
// is a 409 rather than a silent overwrite of what they decided.
func (s *LinkAPI) Decide(ctx context.Context, id, decision string) (LinkRecord, error) {
	var status string
	switch decision {
	case "accept":
		status = LinkStatusConfirmed
	case "reject":
		status = LinkStatusRejected
	default:
		return LinkRecord{}, apiBadRequest("invalid_request",
			fmt.Sprintf("unknown decision %q", decision), "decision")
	}
	result, err := db.New(s.database.Writer()).DecideCoreLink(ctx, db.DecideCoreLinkParams{
		Status:    status,
		DecidedAt: sql.NullString{String: FormatTime(s.clock.Now()), Valid: true},
		ID:        id,
	})
	if err != nil {
		return LinkRecord{}, fmt.Errorf("deciding the link %s: %w", id, err)
	}
	if err := requireOneRow(result, "link", id); err != nil {
		return LinkRecord{}, s.explainUndecidable(ctx, id)
	}
	return s.resolve(ctx, id)
}

// explainUndecidable says why a decision changed no row: there is no such
// link, or there is one that is not a suggestion any more.
func (s *LinkAPI) explainUndecidable(ctx context.Context, id string) error {
	row, err := db.New(s.database.Writer()).GetCoreLink(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return apiNotFound("link", id)
	}
	if err != nil {
		return fmt.Errorf("reading the link %s that was not decided: %w", id, err)
	}
	return apiConflict("not_suggested",
		fmt.Sprintf("the link %s is %s, and only a suggestion can be decided", id, row.Status), "id")
}

// List reads one page of links, newest first with the id breaking ties.
func (s *LinkAPI) List(ctx context.Context, in LinkListInput) (LinkPage, error) {
	if in.Kind != "" && !validLinkKinds[in.Kind] {
		return LinkPage{}, apiBadRequest("invalid_request", fmt.Sprintf("unknown link kind %q", in.Kind), "kind")
	}
	if in.Status != "" && !validLinkStatuses[in.Status] {
		return LinkPage{}, apiBadRequest("invalid_request", fmt.Sprintf("unknown link status %q", in.Status), "status")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = linkDefaultListLimit
	}
	if limit > linkMaxListLimit {
		return LinkPage{}, apiBadRequest("invalid_request",
			fmt.Sprintf("the page holds at most %d links", linkMaxListLimit), "limit")
	}
	filterHash := linkFilterHash(in)
	var cursor linkCursor
	if in.Cursor != "" {
		decoded, err := decodeLinkCursor(in.Cursor)
		if err != nil {
			return LinkPage{}, apiBadRequest("invalid_cursor", "the cursor does not decode", "cursor")
		}
		if decoded.FilterHash != filterHash {
			return LinkPage{}, apiBadRequest("invalid_cursor",
				"the cursor belongs to another filter", "cursor")
		}
		cursor = decoded
	}

	where := []string{}
	args := []any{}
	if in.SrcID != "" {
		where = append(where, "core_links.src_id = ?")
		args = append(args, in.SrcID)
	}
	if in.DstID != "" {
		where = append(where, "core_links.dst_id = ?")
		args = append(args, in.DstID)
	}
	if in.Kind != "" {
		where = append(where, "core_links.kind = ?")
		args = append(args, in.Kind)
	}
	if in.Status != "" {
		where = append(where, "core_links.status = ?")
		args = append(args, in.Status)
	}
	if in.Cursor != "" {
		where = append(where, "(core_links.created_at < ? OR (core_links.created_at = ? AND core_links.id < ?))")
		args = append(args, cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
	}
	// Both ends come back in the same read: the page renders each link with
	// its two registry rows, and one lookup per end per row is up to 400
	// round trips for a page of 200.
	query := "SELECT" +
		" core_links.id, core_links.src_id, core_links.dst_id, core_links.kind, core_links.source," +
		" core_links.status, core_links.confidence, core_links.created_at, core_links.decided_at," +
		" src.id, src.module, src.type, src.title, src.url, src.created_at," +
		" dst.id, dst.module, dst.type, dst.title, dst.url, dst.created_at" +
		" FROM core_links" +
		" JOIN core_items AS src ON src.id = core_links.src_id" +
		" JOIN core_items AS dst ON dst.id = core_links.dst_id"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += fmt.Sprintf(" ORDER BY core_links.created_at DESC, core_links.id DESC LIMIT %d", limit+1)

	rows, err := s.database.Reader().QueryContext(ctx, query, args...)
	if err != nil {
		return LinkPage{}, fmt.Errorf("listing the links: %w", err)
	}
	defer rows.Close()
	found := []LinkRecord{}
	for rows.Next() {
		var record LinkRecord
		row, src, dst := &record.Row, &record.Src, &record.Dst
		if err := rows.Scan(&row.ID, &row.SrcID, &row.DstID, &row.Kind, &row.Source,
			&row.Status, &row.Confidence, &row.CreatedAt, &row.DecidedAt,
			&src.ID, &src.Module, &src.Type, &src.Title, &src.Url, &src.CreatedAt,
			&dst.ID, &dst.Module, &dst.Type, &dst.Title, &dst.Url, &dst.CreatedAt); err != nil {
			return LinkPage{}, fmt.Errorf("scanning a link row: %w", err)
		}
		found = append(found, record)
	}
	if err := rows.Err(); err != nil {
		return LinkPage{}, fmt.Errorf("listing the links: %w", err)
	}

	page := LinkPage{Items: []LinkRecord{}}
	if len(found) > limit {
		last := found[limit-1].Row
		page.NextCursor = encodeLinkCursor(linkCursor{
			FilterHash: filterHash,
			CreatedAt:  last.CreatedAt,
			ID:         last.ID,
		})
		found = found[:limit]
	}
	page.Items = append(page.Items, found...)
	return page, nil
}

// resolve reads a link and both of its ends out of the registry in one query.
func (s *LinkAPI) resolve(ctx context.Context, id string) (LinkRecord, error) {
	resolved, err := db.New(s.database.Reader()).GetCoreLinkResolved(ctx, id)
	if err != nil {
		return LinkRecord{}, fmt.Errorf("reading the link %s with its ends: %w", id, err)
	}
	return LinkRecord{Row: resolved.CoreLink, Src: resolved.CoreItem, Dst: resolved.CoreItem_2}, nil
}

func (s *LinkAPI) inWriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning the link transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing the link transaction: %w", err)
	}
	return nil
}

// linkCursor is the opaque page token: the position in the total order and a
// hash of the filters it was issued under.
type linkCursor struct {
	V          int    `json:"v"`
	FilterHash string `json:"fh"`
	CreatedAt  string `json:"c"`
	ID         string `json:"id"`
}

const linkCursorVersion = 1

func encodeLinkCursor(cursor linkCursor) string {
	cursor.V = linkCursorVersion
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeLinkCursor(raw string) (linkCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return linkCursor{}, err
	}
	var cursor linkCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return linkCursor{}, err
	}
	if cursor.V != linkCursorVersion || cursor.ID == "" {
		return linkCursor{}, fmt.Errorf("unknown cursor version")
	}
	return cursor, nil
}

// linkFilterHash binds a cursor to the filters that produced it, so a cursor
// reused with others is refused instead of silently paginating a different
// list.
func linkFilterHash(in LinkListInput) string {
	sum := sha256.Sum256([]byte(strings.Join(
		[]string{"links", in.SrcID, in.DstID, in.Kind, in.Status}, "\x00")))
	return fmt.Sprintf("%x", sum)
}
