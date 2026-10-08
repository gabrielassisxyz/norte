package library

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// LibraryExtractJobKind is the kind a save enqueues for the background
// extraction, and the kind LibraryExtraction is registered under.
const LibraryExtractJobKind = "library.extract"

// librarySnapshotMediaType is what a captured page is stored as.
const librarySnapshotMediaType = "text/html"

// Library item sources: where a save came from. The adapter owns this, never
// the request: the HTTP handler maps an absent source to app and accepts only
// extension, while norte save passes cli.
const (
	LibrarySourceApp       = "app"
	LibrarySourceExtension = "extension"
	LibrarySourceCLI       = "cli"
	LibrarySourceTelegram  = "telegram"
	LibrarySourceImport    = "import"
)

// LibraryError is a domain failure with the status the handler answers with.
// Anything that is not one is a bug, and answers 500 without its message.
type LibraryError struct {
	Status  int
	Code    string
	Message string
	Field   string
}

func (e *LibraryError) Error() string { return e.Message }

func libraryBadRequest(code, message, field string) *LibraryError {
	return &LibraryError{Status: 400, Code: code, Message: message, Field: field}
}

func libraryNotFound(id string) *LibraryError {
	return &LibraryError{Status: 404, Code: "not_found", Message: fmt.Sprintf("no library item %s", id)}
}

// errLibraryCanonicalRace reports that an insert lost to a concurrent save of
// the same canonical URL. It is internal: Save retries once as a duplicate,
// and a caller running inside its own transaction sees the winner on its retry.
var errLibraryCanonicalRace = errors.New("a concurrent save won the canonical URL")

// LibraryService is the library's domain: saving with dedupe, reading,
// patching and opening. The HTTP handler and norte save both call it, and the
// curriculum import of a later delivery runs PreparedSave inside its own
// transaction; no logic lives in an adapter.
type LibraryService struct {
	database *core.Database
	files    *core.Files
	jobs     *core.Jobs
	clock    core.Clock
	// libraryExtractKind is the job kind saves enqueue. A test sets it empty
	// to prove the save rolls back when the enqueue fails.
	libraryExtractKind string
	// focus is what the focus-ranked view and the weighted draw rank by, or
	// nil in a process assembled without it -- both then refuse rather than
	// answering an unranked list under a ranked name.
	focus libraryFocusReader
}

// WithFocus hands the service the focus the now view and the serendipity draw
// rank by. It is set apart from the constructor because every other caller of
// the service -- norte save, the extraction worker, the Telegram adapter --
// has no use for it, and a constructor argument none of them can fill is a nil
// each of them has to pass.
func (s *LibraryService) WithFocus(focus libraryFocusReader) *LibraryService {
	s.focus = focus
	return s
}

// NewLibraryService returns the service over the module's dependencies.
func NewLibraryService(database *core.Database, files *core.Files, jobs *core.Jobs, clock core.Clock) *LibraryService {
	return &LibraryService{
		database:           database,
		files:              files,
		jobs:               jobs,
		clock:              clock,
		libraryExtractKind: LibraryExtractJobKind,
	}
}

// SaveInput is everything a save carries, plus the adapter-owned source.
type SaveInput struct {
	URL       string
	Title     string
	HTML      []byte
	Selection *string
	Why       string
	LinkTo    []string
	Source    string
}

// SaveOutcome is what a save reports: the item, and whether this call created
// it. The handler answers 201 on a creation and 200 on a duplicate.
type SaveOutcome struct {
	ID      string
	Created bool
}

// PreparedSave is a save validated with its snapshot stored, ready to run
// inside any transaction. Preparing outside the transaction is what keeps a
// later import from deadlocking the single writer connection: the blob store
// writes through that same connection, so storing inside an open transaction
// would wait on itself.
type PreparedSave struct {
	input     SaveInput
	parsed    *url.URL
	canonical string
	blobHash  string
	hasBlob   bool
}

// libraryValidSources are the sources an adapter may claim.
var libraryValidSources = map[string]bool{
	LibrarySourceApp:       true,
	LibrarySourceExtension: true,
	LibrarySourceCLI:       true,
	LibrarySourceTelegram:  true,
	LibrarySourceImport:    true,
}

// PrepareSave validates the URL and the source and stores the snapshot, before
// any transaction opens. A crash after this leaves a blob nothing points at,
// which norte files gc clears up; the other order would leave a row pointing
// at a file that is not there, and nothing can repair that.
func (s *LibraryService) PrepareSave(ctx context.Context, in SaveInput) (*PreparedSave, error) {
	if !libraryValidSources[in.Source] {
		return nil, libraryBadRequest("invalid_request", fmt.Sprintf("unknown source %q", in.Source), "source")
	}
	parsed, err := ValidateItemURL(in.URL)
	if err != nil {
		return nil, libraryBadRequest("invalid_request", err.Error(), "url")
	}
	prepared := &PreparedSave{input: in, parsed: parsed, canonical: CanonicalizeItemURL(parsed)}
	if len(in.HTML) > 0 {
		blob, err := s.files.Store(ctx, bytes.NewReader(in.HTML), librarySnapshotMediaType)
		if err != nil {
			return nil, fmt.Errorf("storing the snapshot: %w", err)
		}
		prepared.blobHash = blob.Hash
		prepared.hasBlob = true
	}
	return prepared, nil
}

// Save validates, stores the snapshot and commits the item, its registry row,
// its file reference, its links and its extraction job together. Two
// concurrent saves of one URL resolve by the UNIQUE index: one inserts, the
// other reads the winner and returns it.
func (s *LibraryService) Save(ctx context.Context, in SaveInput) (SaveOutcome, error) {
	prepared, err := s.PrepareSave(ctx, in)
	if err != nil {
		return SaveOutcome{}, err
	}
	for {
		tx, err := s.database.Writer().BeginTx(ctx, nil)
		if err != nil {
			return SaveOutcome{}, fmt.Errorf("beginning the save transaction: %w", err)
		}
		outcome, err := s.savePreparedTx(ctx, tx, prepared)
		if err == nil {
			if commitErr := tx.Commit(); commitErr != nil {
				return SaveOutcome{}, fmt.Errorf("committing the save: %w", commitErr)
			}
			return outcome, nil
		}
		_ = tx.Rollback()
		if errors.Is(err, errLibraryCanonicalRace) {
			// The winner committed before this insert failed, so the retry
			// reads it as a duplicate.
			tx, err := s.database.Writer().BeginTx(ctx, nil)
			if err != nil {
				return SaveOutcome{}, fmt.Errorf("beginning the duplicate transaction: %w", err)
			}
			outcome, err := s.savePreparedTx(ctx, tx, prepared)
			if err != nil {
				_ = tx.Rollback()
				return SaveOutcome{}, err
			}
			if commitErr := tx.Commit(); commitErr != nil {
				return SaveOutcome{}, fmt.Errorf("committing the duplicate save: %w", commitErr)
			}
			return outcome, nil
		}
		return SaveOutcome{}, err
	}
}

// SavePrepared runs a prepared save inside the caller's transaction, so a
// later import can save many items atomically. A canonical race comes back as
// errLibraryCanonicalRace with the transaction still safe to roll back.
func (s *LibraryService) SavePrepared(ctx context.Context, tx *sql.Tx, prepared *PreparedSave) (SaveOutcome, error) {
	return s.savePreparedTx(ctx, tx, prepared)
}

// savePreparedTx inserts or applies a duplicate inside tx. It never commits or
// rolls back: the caller owns the transaction.
func (s *LibraryService) savePreparedTx(ctx context.Context, tx *sql.Tx, prepared *PreparedSave) (SaveOutcome, error) {
	in := prepared.input
	targets, err := s.libraryLinkTargets(ctx, tx, in.LinkTo)
	if err != nil {
		return SaveOutcome{}, err
	}
	queries := db.New(tx)
	existing, err := queries.GetLibraryItemByCanonical(ctx, prepared.canonical)
	if err == nil {
		return s.applyLibraryDuplicate(ctx, tx, queries, existing, prepared, targets)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SaveOutcome{}, fmt.Errorf("reading the canonical URL: %w", err)
	}
	outcome, err := s.insertLibraryItem(ctx, tx, queries, prepared, targets)
	if err != nil {
		if isLibraryUniqueViolation(err) {
			return SaveOutcome{}, errLibraryCanonicalRace
		}
		return SaveOutcome{}, err
	}
	return outcome, nil
}

// insertLibraryItem records a new item and everything it owns in one
// transaction: the item, the registry row, the snapshot reference, the links
// and the extraction job.
func (s *LibraryService) insertLibraryItem(ctx context.Context, tx *sql.Tx, queries *db.Queries, prepared *PreparedSave, targets []string) (SaveOutcome, error) {
	in := prepared.input
	now := s.clock.Now()
	stamp := core.FormatTime(now)
	id := core.NewID()
	title := in.Title
	if title == "" {
		title = prepared.parsed.EscapedPath()
		if title == "" {
			title = "/"
		}
	}
	meta := "{}"
	var htmlHash sql.NullString
	if prepared.hasBlob {
		meta = librarySetSnapshotSource("{}", librarySnapshotSourceFor(in.Source))
		htmlHash = sql.NullString{String: prepared.blobHash, Valid: true}
	}
	var why, selection sql.NullString
	if in.Why != "" {
		why = sql.NullString{String: in.Why, Valid: true}
	}
	if in.Selection != nil {
		selection = sql.NullString{String: *in.Selection, Valid: true}
	}
	if err := queries.InsertLibraryItem(ctx, db.InsertLibraryItemParams{
		ID:                id,
		Kind:              "post",
		Url:               in.URL,
		CanonicalUrl:      prepared.canonical,
		Title:             title,
		TitleEdited:       0,
		Why:               why,
		Selection:         selection,
		Status:            "inbox",
		Unread:            1,
		SavedAt:           stamp,
		Source:            in.Source,
		HtmlHash:          htmlHash,
		ExtractStatus:     "pending",
		ExtractGeneration: 1,
		Meta:              meta,
		CreatedAt:         stamp,
		UpdatedAt:         stamp,
	}); err != nil {
		return SaveOutcome{}, fmt.Errorf("inserting the library item: %w", err)
	}
	if err := core.RegisterItem(ctx, tx, core.ItemRegistration{
		ID:        id,
		Module:    ModuleName,
		Type:      "post",
		Title:     title,
		URL:       in.URL,
		CreatedAt: now,
	}); err != nil {
		return SaveOutcome{}, err
	}
	if prepared.hasBlob {
		if err := insertLibraryFileRef(ctx, tx, prepared.blobHash, id); err != nil {
			return SaveOutcome{}, err
		}
	}
	for _, target := range targets {
		if err := core.Links.Confirm(ctx, tx, now, id, target, core.LinkKindAbout); err != nil {
			return SaveOutcome{}, err
		}
	}
	if err := s.enqueueLibraryExtract(ctx, tx, id, 1, false); err != nil {
		return SaveOutcome{}, err
	}
	return SaveOutcome{ID: id, Created: true}, nil
}

// applyLibraryDuplicate folds a second save into the existing item: its note
// and selection are applied, its links are created unless they exist, and its
// snapshot replaces the stored one only when the request carries HTML and the
// stored snapshot did not come from the extension or extraction failed.
func (s *LibraryService) applyLibraryDuplicate(ctx context.Context, tx *sql.Tx, queries *db.Queries, existing db.LibraryItem, prepared *PreparedSave, targets []string) (SaveOutcome, error) {
	in := prepared.input
	now := s.clock.Now()
	stamp := core.FormatTime(now)
	for _, target := range targets {
		if err := core.Links.Confirm(ctx, tx, now, existing.ID, target, core.LinkKindAbout); err != nil {
			return SaveOutcome{}, err
		}
	}
	why := existing.Why
	if in.Why != "" {
		why = sql.NullString{String: in.Why, Valid: true}
	}
	selection := existing.Selection
	if in.Selection != nil {
		selection = sql.NullString{String: *in.Selection, Valid: true}
	}
	if err := queries.UpdateLibraryItemNote(ctx, db.UpdateLibraryItemNoteParams{
		Why:       why,
		Selection: selection,
		UpdatedAt: stamp,
		ID:        existing.ID,
	}); err != nil {
		return SaveOutcome{}, fmt.Errorf("applying the duplicate note: %w", err)
	}
	if prepared.hasBlob && libraryShouldReplaceSnapshot(existing, true) {
		if err := s.replaceLibrarySnapshot(ctx, tx, queries, existing, prepared, stamp); err != nil {
			return SaveOutcome{}, err
		}
	} else if prepared.hasBlob && prepared.blobHash == existing.HtmlHash.String {
		// The same bytes: no reference churn and no new job, but the
		// capturer is still recorded, so a later save without HTML knows an
		// extension snapshot is already stored.
		if err := queries.TouchLibraryItem(ctx, db.TouchLibraryItemParams{
			UpdatedAt: stamp,
			ID:        existing.ID,
		}); err != nil {
			return SaveOutcome{}, fmt.Errorf("touching the duplicate item: %w", err)
		}
		if source := librarySnapshotSourceFor(in.Source); source != librarySnapshotSource(existing.Meta) {
			if _, err := tx.ExecContext(ctx,
				`UPDATE library_items SET meta = ?, updated_at = ? WHERE id = ?`,
				librarySetSnapshotSource(existing.Meta, source), stamp, existing.ID); err != nil {
				return SaveOutcome{}, fmt.Errorf("recording the snapshot source: %w", err)
			}
		}
	}
	return SaveOutcome{ID: existing.ID, Created: false}, nil
}

// libraryShouldReplaceSnapshot reports whether a duplicate save carrying HTML
// replaces the stored snapshot: always, unless the stored snapshot came from
// the extension and extraction did not fail.
func libraryShouldReplaceSnapshot(existing db.LibraryItem, hasHTML bool) bool {
	if !hasHTML {
		return false
	}
	if librarySnapshotSource(existing.Meta) == LibrarySourceExtension && existing.ExtractStatus != "failed" {
		return false
	}
	return true
}

// replaceLibrarySnapshot swaps the stored snapshot and re-enqueues extraction:
// the new reference is inserted and the previous one deleted in the same
// transaction, so the old blob becomes eligible for norte files gc, and the
// bumped generation lets the worker tell a superseded job from this one.
func (s *LibraryService) replaceLibrarySnapshot(ctx context.Context, tx *sql.Tx, queries *db.Queries, existing db.LibraryItem, prepared *PreparedSave, stamp string) error {
	in := prepared.input
	generation := existing.ExtractGeneration + 1
	meta := librarySetSnapshotSource(existing.Meta, librarySnapshotSourceFor(in.Source))
	if err := queries.ReplaceLibrarySnapshot(ctx, db.ReplaceLibrarySnapshotParams{
		HtmlHash:          sql.NullString{String: prepared.blobHash, Valid: true},
		Meta:              meta,
		ExtractGeneration: generation,
		UpdatedAt:         stamp,
		ID:                existing.ID,
	}); err != nil {
		return fmt.Errorf("replacing the snapshot: %w", err)
	}
	if existing.HtmlHash.Valid && existing.HtmlHash.String != "" && existing.HtmlHash.String != prepared.blobHash {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM core_file_refs WHERE hash = ? AND owner_id = ? AND kind = 'snapshot'`,
			existing.HtmlHash.String, existing.ID); err != nil {
			return fmt.Errorf("releasing the previous snapshot: %w", err)
		}
	}
	if !existing.HtmlHash.Valid || existing.HtmlHash.String != prepared.blobHash {
		if err := insertLibraryFileRef(ctx, tx, prepared.blobHash, existing.ID); err != nil {
			return fmt.Errorf("referencing the new snapshot: %w", err)
		}
	}
	// Not a refresh: the bytes this save carried are the ones to extract. A
	// refresh downloads the page instead, which throws away a capture the
	// server cannot make for itself -- anything behind a login or a paywall
	// then ends failed, and a public page is silently replaced by whatever the
	// server sees. Downloading again is the retry endpoint's explicit option,
	// never an implication of a save.
	if err := s.enqueueLibraryExtract(ctx, tx, existing.ID, generation, false); err != nil {
		return err
	}
	return nil
}

// insertLibraryFileRef records that an item owns a blob as its snapshot. The
// kind is what keeps a later file endpoint from ever serving unsanitized
// HTML from the app's own origin.
func insertLibraryFileRef(ctx context.Context, tx *sql.Tx, hash, owner string) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO core_file_refs (hash, owner_id, kind) VALUES (?, ?, 'snapshot')`,
		hash, owner); err != nil {
		return fmt.Errorf("referencing the snapshot blob: %w", err)
	}
	return nil
}

// enqueueLibraryExtract queues the background extraction inside the save's
// transaction, so the item and its job commit together. The dedupe key carries
// the generation, so a request made while an older extraction still runs gets
// its own job instead of being absorbed by the old one.
func (s *LibraryService) enqueueLibraryExtract(ctx context.Context, tx *sql.Tx, id string, generation int64, refresh bool) error {
	_, err := s.enqueueLibraryExtractJob(ctx, tx, id, generation, refresh)
	return err
}

// enqueueLibraryExtractJob is enqueueLibraryExtract for a caller that reports
// the job it queued -- the retry endpoint, so a failure can be found in
// `norte jobs list` without guessing which row it is.
func (s *LibraryService) enqueueLibraryExtractJob(ctx context.Context, tx *sql.Tx, id string, generation int64, refresh bool) (string, error) {
	payload, err := json.Marshal(map[string]any{
		"item_id":    id,
		"generation": generation,
		"refresh":    refresh,
	})
	if err != nil {
		return "", fmt.Errorf("encoding the extract job: %w", err)
	}
	jobID, err := s.jobs.Enqueue(ctx, tx, s.libraryExtractKind, string(payload),
		fmt.Sprintf("extract:%s:%d", id, generation))
	if err != nil {
		return "", fmt.Errorf("enqueueing the extract job: %w", err)
	}
	return jobID, nil
}

// libraryLinkTargets collapses duplicate link ids and refuses unknown ones,
// before anything is written, so a bad link leaves no item behind.
func (s *LibraryService) libraryLinkTargets(ctx context.Context, tx *sql.Tx, ids []string) ([]string, error) {
	seen := map[string]bool{}
	targets := []string{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		targets = append(targets, id)
	}
	if len(targets) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(targets))
	args := make([]any, len(targets))
	for i, id := range targets {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM core_items WHERE id IN (`+strings.Join(placeholders, ", ")+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("reading the link targets: %w", err)
	}
	defer rows.Close()
	known := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("reading the link targets: %w", err)
		}
		known[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading the link targets: %w", err)
	}
	for _, id := range targets {
		if !known[id] {
			return nil, libraryBadRequest("invalid_request",
				fmt.Sprintf("unknown link target %q", id), "link_to")
		}
	}
	return targets, nil
}

// librarySnapshotSourceFor maps who saved to how the snapshot bytes were
// captured. The dialog and Telegram carry no capturer of their own, so their
// snapshots are recorded as fetched by the server.
func librarySnapshotSourceFor(source string) string {
	switch source {
	case LibrarySourceExtension:
		return LibrarySourceExtension
	case LibrarySourceCLI:
		return LibrarySourceCLI
	case LibrarySourceImport:
		return LibrarySourceImport
	default:
		return "server_fetch"
	}
}

// librarySnapshotSource reads who captured the stored snapshot from the
// item's meta, or "" when no snapshot was ever stored.
func librarySnapshotSource(meta string) string {
	var decoded map[string]any
	if err := json.Unmarshal([]byte(meta), &decoded); err != nil {
		return ""
	}
	source, _ := decoded["snapshot_source"].(string)
	return source
}

// librarySetSnapshotSource returns meta with snapshot_source set, keeping
// whatever else the meta carried.
func librarySetSnapshotSource(meta, source string) string {
	decoded := map[string]any{}
	_ = json.Unmarshal([]byte(meta), &decoded)
	decoded["snapshot_source"] = source
	encoded, err := json.Marshal(decoded)
	if err != nil {
		return `{"snapshot_source":"` + source + `"}`
	}
	return string(encoded)
}

// isLibraryUniqueViolation reports a UNIQUE constraint failure, which is how
// two concurrent saves of one canonical URL resolve: the loser reads the
// winner instead of failing.
func isLibraryUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
