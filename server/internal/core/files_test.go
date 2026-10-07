package core_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

// newCoreFileStore returns a store over a migrated database, with the clock the
// test will move, and the data directory both share.
func newCoreFileStore(t *testing.T, clock *clocktest.Clock) (*core.Files, *core.Database, string) {
	t.Helper()
	dataDir := t.TempDir()
	database := newEmptyCoreDatabase(t, dataDir)
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	return core.NewFiles(dataDir, database.Writer(), clock), database, dataDir
}

func storeTestBlob(t *testing.T, store *core.Files, content string) core.StoredBlob {
	t.Helper()
	blob, err := store.Store(context.Background(), strings.NewReader(content), "text/html")
	if err != nil {
		t.Fatalf("storing %q: %v", content, err)
	}
	if want := hex.EncodeToString(sha256Sum(content)); blob.Hash != want {
		t.Fatalf("Store returned hash %s, want the SHA-256 of the content, %s", blob.Hash, want)
	}
	return blob
}

func sha256Sum(content string) []byte {
	sum := sha256.Sum256([]byte(content))
	return sum[:]
}

func TestStoringTheSameBytesTwiceIsOneFileAndOneRow(t *testing.T) {
	store, database, dataDir := newCoreFileStore(t, clocktest.New(fixedInstant))

	const content = "<html><body>the same page, saved twice</body></html>"
	first := storeTestBlob(t, store, content)
	second := storeTestBlob(t, store, content)

	if second.Hash != first.Hash {
		t.Fatalf("the same bytes hashed to %s and %s", first.Hash, second.Hash)
	}
	if got := countRows(t, database, `SELECT count(*) FROM core_files`); got != 1 {
		t.Errorf("%d core_files rows, want 1", got)
	}
	if got := countBlobFiles(t, filepath.Join(dataDir, core.FileStoreDirName)); got != 1 {
		t.Errorf("%d files under the store, want 1", got)
	}
	if got := fileSize(t, store.Path(first.Hash)); got != int64(len(content)) {
		t.Errorf("the stored blob is %d bytes, want %d", got, len(content))
	}
}

// TestAStoredBlobAndItsShardAreReadableOnlyByTheOwner covers the shard directory
// as well as the file: the directory is created by the store rather than by the
// data-directory setup, so it is the one place a 0700 could be missed.
func TestAStoredBlobAndItsShardAreReadableOnlyByTheOwner(t *testing.T) {
	store, _, dataDir := newCoreFileStore(t, clocktest.New(fixedInstant))

	blob := storeTestBlob(t, store, "<html>private</html>")

	assertMode(t, filepath.Join(dataDir, core.FileStoreDirName), 0o700)
	assertMode(t, filepath.Dir(store.Path(blob.Hash)), 0o700)
	assertMode(t, store.Path(blob.Hash), 0o600)
}

func TestTheStoredPathShardsOnTheFirstTwoHexDigits(t *testing.T) {
	store, _, dataDir := newCoreFileStore(t, clocktest.New(fixedInstant))

	blob := storeTestBlob(t, store, "<html>sharded</html>")

	want := filepath.Join(dataDir, core.FileStoreDirName, blob.Hash[:2], blob.Hash)
	if got := store.Path(blob.Hash); got != want {
		t.Errorf("Path(%s) = %s, want %s", blob.Hash, got, want)
	}
	if _, err := os.Stat(want); err != nil {
		t.Errorf("nothing at %s: %v", want, err)
	}
}

// TestGarbageCollectionDeletesOnlyOldUnreferencedBlobs is the whole contract of
// `norte files gc` in one test, because each of the three blobs is kept or
// deleted for a different reason, and a collector that got any one of them wrong
// would be a data-loss bug rather than a leak.
func TestGarbageCollectionDeletesOnlyOldUnreferencedBlobs(t *testing.T) {
	clock := clocktest.New(fixedInstant)
	store, database, _ := newCoreFileStore(t, clock)
	owner := registerTestItem(t, database, "owner")

	// Stored now, and left unreferenced. By the time gc runs this one is 61
	// minutes old, past the grace period.
	old := storeTestBlob(t, store, "<html>orphaned by a crash</html>")

	// Also unreferenced, but stored two minutes later, so it is 59 minutes old
	// when gc runs: still inside the window where its transaction may be in
	// flight.
	clock.Advance(2 * time.Minute)
	young := storeTestBlob(t, store, "<html>a save still in flight</html>")

	// Referenced, and as old as the first one. Age alone must not be enough.
	referenced := storeTestBlob(t, store, "<html>a snapshot someone owns</html>")
	if _, err := database.Writer().Exec(
		`INSERT INTO core_file_refs (hash, owner_id, kind) VALUES (?, ?, ?)`,
		referenced.Hash, owner, core.FileRefSnapshot); err != nil {
		t.Fatalf("referencing the blob: %v", err)
	}

	clock.Advance(59 * time.Minute)

	collected, err := store.CollectGarbage(context.Background())
	if err != nil {
		t.Fatalf("collecting garbage: %v", err)
	}
	if collected.Removed != 1 {
		t.Errorf("gc deleted %d blobs, want 1", collected.Removed)
	}
	if collected.Bytes != old.Size {
		t.Errorf("gc reported %d bytes freed, want %d", collected.Bytes, old.Size)
	}

	assertBlobGone(t, database, store, old.Hash, "it is unreferenced and past the grace period")
	assertBlobKept(t, database, store, young.Hash, "it is only 59 minutes old")
	assertBlobKept(t, database, store, referenced.Hash, "an item references it")
}

// TestGarbageCollectionCollectsABlobOnceItsOwnerIsUnregistered is the pair of
// cascades working together: deleting the item removes the reference, and the
// next gc past the grace period removes the blob.
func TestGarbageCollectionCollectsABlobOnceItsOwnerIsUnregistered(t *testing.T) {
	clock := clocktest.New(fixedInstant)
	store, database, _ := newCoreFileStore(t, clock)
	owner := registerTestItem(t, database, "owner")

	blob := storeTestBlob(t, store, "<html>kept while its owner lives</html>")
	if _, err := database.Writer().Exec(
		`INSERT INTO core_file_refs (hash, owner_id, kind) VALUES (?, ?, ?)`,
		blob.Hash, owner, core.FileRefSnapshot); err != nil {
		t.Fatalf("referencing the blob: %v", err)
	}

	clock.Advance(2 * time.Hour)
	if collected, err := store.CollectGarbage(context.Background()); err != nil {
		t.Fatalf("collecting garbage: %v", err)
	} else if collected.Removed != 0 {
		t.Fatalf("gc deleted %d referenced blobs, want 0", collected.Removed)
	}

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.UnregisterItem(context.Background(), tx, owner)
	})

	if collected, err := store.CollectGarbage(context.Background()); err != nil {
		t.Fatalf("collecting garbage after unregistering: %v", err)
	} else if collected.Removed != 1 {
		t.Errorf("gc deleted %d blobs after the owner went, want 1", collected.Removed)
	}
	assertBlobGone(t, database, store, blob.Hash, "its only owner was unregistered")
}

func assertBlobGone(t *testing.T, database *core.Database, store *core.Files, hash, why string) {
	t.Helper()
	if got := countRows(t, database, `SELECT count(*) FROM core_files WHERE hash = ?`, hash); got != 0 {
		t.Errorf("the core_files row for %s survived, though %s", hash, why)
	}
	if _, err := os.Stat(store.Path(hash)); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("the file for %s survived (stat: %v), though %s", hash, err, why)
	}
}

func assertBlobKept(t *testing.T, database *core.Database, store *core.Files, hash, why string) {
	t.Helper()
	if got := countRows(t, database, `SELECT count(*) FROM core_files WHERE hash = ?`, hash); got != 1 {
		t.Errorf("the core_files row for %s is gone, though %s", hash, why)
	}
	if _, err := os.Stat(store.Path(hash)); err != nil {
		t.Errorf("the file for %s is gone (%v), though %s", hash, err, why)
	}
}

// countBlobFiles counts the regular files under the store, so a second copy of
// the same bytes under any name would be seen.
func countBlobFiles(t *testing.T, root string) int {
	t.Helper()
	count := 0
	if err := filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			count++
		}
		return nil
	}); err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}
	return count
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Size()
}
