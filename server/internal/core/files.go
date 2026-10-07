package core

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// File reference kinds: what a blob is to the item that owns it. A snapshot is a
// page's raw HTML, kept so a saved article survives the site it came from; the
// other two arrive with the deliveries that need them. The distinction decides
// what a later file endpoint will serve, and a snapshot is never served to a
// browser -- it is someone else's HTML, with their scripts in it.
const (
	FileRefSnapshot     = "snapshot"
	FileRefMaterialFile = "material_file"
	FileRefCover        = "cover"
)

// UnreferencedBlobGrace is how long a blob with no reference is left alone.
//
// Store writes the blob before the caller's transaction records the reference,
// so a blob that looks unreferenced may belong to a save that has not committed
// yet. An hour is far longer than any save takes and short enough that an
// abandoned download does not sit on the disk for a day.
const UnreferencedBlobGrace = time.Hour

// shardPrefixLength is how many hex characters of the hash name the directory a
// blob lives in. Two gives 256 directories, which keeps any one of them small
// enough that listing it stays cheap on every filesystem Norte might sit on.
const shardPrefixLength = 2

// stagingPrefix names a blob that is still being written. The leading dot keeps
// it out of the way, and the name is distinct so a crash leaves something
// recognisable rather than a file that looks like a hash.
const stagingPrefix = ".incoming-"

// Files is the content-addressed blob store under NORTE_DATA/files. The name of
// a blob is the SHA-256 of its contents, so storing the same bytes twice is one
// file and one row, with no comparison and no decision to make.
type Files struct {
	root   string
	writer *sql.DB
	clock  Clock
}

// NewFiles returns the store rooted in dataDir. It creates nothing: the
// directory appears the first time something is stored.
func NewFiles(dataDir string, writer *sql.DB, clock Clock) *Files {
	return &Files{root: filepath.Join(dataDir, FileStoreDirName), writer: writer, clock: clock}
}

// StoredBlob is what Store wrote: the hash the caller puts in its own
// core_file_refs row, and the size it read.
type StoredBlob struct {
	Hash string
	Size int64
}

// Store writes content to disk and records it in core_files, leaving the caller
// to insert the core_file_refs row inside its own transaction.
//
// The order matters and is deliberate. The blob exists before any reference to
// it does, so a crash in between leaves a file nothing points at -- which
// CollectGarbage clears up an hour later. The other order would leave a row
// pointing at a file that is not there, and nothing can repair that.
func (f *Files) Store(ctx context.Context, content io.Reader, mediaType string) (StoredBlob, error) {
	if err := ensurePrivateDir(f.root); err != nil {
		return StoredBlob{}, err
	}

	blob, staged, err := f.stage(content)
	if err != nil {
		return StoredBlob{}, err
	}
	// Removing the staging file is a no-op once it has been renamed into place.
	defer func() { _ = os.Remove(staged) }()

	if err := f.settle(blob.Hash, staged); err != nil {
		return StoredBlob{}, err
	}

	// DO NOTHING rather than an update: the row describes bytes that cannot have
	// changed, and created_at is what the grace period in CollectGarbage reads,
	// so refreshing it would keep a blob alive for an hour per re-save.
	_, err = f.writer.ExecContext(ctx,
		`INSERT INTO core_files (hash, media_type, size, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (hash) DO NOTHING`,
		blob.Hash, mediaType, blob.Size, FormatTime(f.clock.Now()))
	if err != nil {
		return StoredBlob{}, fmt.Errorf("recording blob %s: %w", blob.Hash, err)
	}
	return blob, nil
}

// stage writes content to a temporary file beside the store and hashes it on the
// way through, because the name it has to be given is not known until the last
// byte has been read.
func (f *Files) stage(content io.Reader) (StoredBlob, string, error) {
	staging, err := os.CreateTemp(f.root, stagingPrefix+"*")
	if err != nil {
		return StoredBlob{}, "", fmt.Errorf("opening a staging file in %s: %w", f.root, err)
	}
	name := staging.Name()

	digest := sha256.New()
	size, err := io.Copy(io.MultiWriter(staging, digest), content)
	if err != nil {
		_ = staging.Close()
		_ = os.Remove(name)
		return StoredBlob{}, "", fmt.Errorf("writing %s: %w", name, err)
	}
	// CreateTemp asks for 0600 and the umask may have taken some of it away.
	if err := os.Chmod(name, dataFileMode); err != nil {
		_ = staging.Close()
		_ = os.Remove(name)
		return StoredBlob{}, "", fmt.Errorf("restricting %s: %w", name, err)
	}
	if err := staging.Close(); err != nil {
		_ = os.Remove(name)
		return StoredBlob{}, "", fmt.Errorf("closing %s: %w", name, err)
	}
	return StoredBlob{Hash: hex.EncodeToString(digest.Sum(nil)), Size: size}, name, nil
}

// settle moves a staged blob to the name its hash gives it. A blob that is
// already there is left alone rather than overwritten: the contents are the same
// by definition, and replacing the file would disturb anything reading it.
func (f *Files) settle(hash, staged string) error {
	shard := filepath.Join(f.root, hash[:shardPrefixLength])
	if err := ensurePrivateDir(shard); err != nil {
		return err
	}
	final := f.Path(hash)
	if _, err := os.Stat(final); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("inspecting %s: %w", final, err)
	}
	if err := os.Rename(staged, final); err != nil {
		return fmt.Errorf("moving the staged blob to %s: %w", final, err)
	}
	return nil
}

// Path is where a blob with this hash lives. It does not check that it is there.
func (f *Files) Path(hash string) string {
	if len(hash) < shardPrefixLength {
		return ""
	}
	return filepath.Join(f.root, hash[:shardPrefixLength], hash)
}

// FilesGCResult is what `norte files gc` reports.
type FilesGCResult struct {
	Removed int
	Bytes   int64
}

// CollectGarbage deletes the blobs nothing references and that are older than
// UnreferencedBlobGrace, with their core_files rows. It looks at core_files and
// core_file_refs and nowhere else: a module's tables are not the core's to read,
// and a module records what it owns through core_file_refs precisely so that
// this does not have to know the module exists.
func (f *Files) CollectGarbage(ctx context.Context) (FilesGCResult, error) {
	cutoff := FormatTime(f.clock.Now().Add(-UnreferencedBlobGrace))
	collectable, err := f.collectable(ctx, cutoff)
	if err != nil {
		return FilesGCResult{}, err
	}

	var result FilesGCResult
	for _, blob := range collectable {
		// The row goes before the file. A crash in between then costs disk
		// space, which this command reclaims on its next run; the other order
		// leaves a row for a file that is gone, and a read of it cannot tell
		// that apart from a corrupt store.
		removed, err := f.forget(ctx, blob.Hash)
		if err != nil {
			return result, err
		}
		if !removed {
			// Something referenced the blob between the query and now.
			continue
		}
		if err := os.Remove(f.Path(blob.Hash)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return result, fmt.Errorf("deleting %s: %w", f.Path(blob.Hash), err)
		}
		result.Removed++
		result.Bytes += blob.Size
	}
	return result, nil
}

// collectable lists the blobs that may go. created_at is compared as text,
// which is a comparison of instants because every timestamp Norte writes is the
// same fixed width -- see TimeLayout.
func (f *Files) collectable(ctx context.Context, cutoff string) ([]StoredBlob, error) {
	rows, err := f.writer.QueryContext(ctx,
		`SELECT hash, size FROM core_files
		 WHERE created_at < ?
		   AND NOT EXISTS (SELECT 1 FROM core_file_refs WHERE core_file_refs.hash = core_files.hash)
		 ORDER BY hash`, cutoff)
	if err != nil {
		return nil, fmt.Errorf("listing unreferenced blobs: %w", err)
	}
	defer rows.Close()

	var collectable []StoredBlob
	for rows.Next() {
		var blob StoredBlob
		if err := rows.Scan(&blob.Hash, &blob.Size); err != nil {
			return nil, fmt.Errorf("reading an unreferenced blob: %w", err)
		}
		collectable = append(collectable, blob)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("listing unreferenced blobs: %w", err)
	}
	return collectable, nil
}

// forget deletes the core_files row, repeating the no-references condition in
// the statement so that a reference written since the listing wins.
func (f *Files) forget(ctx context.Context, hash string) (bool, error) {
	result, err := f.writer.ExecContext(ctx,
		`DELETE FROM core_files WHERE hash = ?
		 AND NOT EXISTS (SELECT 1 FROM core_file_refs WHERE core_file_refs.hash = ?)`, hash, hash)
	if err != nil {
		return false, fmt.Errorf("forgetting blob %s: %w", hash, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("reading the number of affected rows for blob %s: %w", hash, err)
	}
	return affected > 0, nil
}
