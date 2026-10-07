package core_test

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// newMigratedCoreDatabase opens a migrated database in a directory of this
// test's own, and closes it through the shutdown path when the test ends.
func newMigratedCoreDatabase(t *testing.T) *core.Database {
	t.Helper()
	database := newEmptyCoreDatabase(t, t.TempDir())
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	return database
}

func newEmptyCoreDatabase(t *testing.T, dataDir string) *core.Database {
	t.Helper()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil && !errors.Is(err, sql.ErrConnDone) {
			t.Errorf("closing the database: %v", err)
		}
	})
	return database
}

func assertMode(t *testing.T, path string, want fs.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Errorf("%s has mode %04o, want %04o", path, got, want)
	}
}

func TestOpenDatabaseCreatesAPrivateDirectoryAndAPrivateFile(t *testing.T) {
	// Several levels deep and none of them there yet: `norte migrate` on a fresh
	// machine is the case this is for.
	dataDir := filepath.Join(t.TempDir(), "share", "norte")
	database := newEmptyCoreDatabase(t, dataDir)

	assertMode(t, dataDir, 0o700)
	assertMode(t, database.Path(), 0o600)
}

// TestTheWriterPoolHoldsExactlyOneConnection is the whole reason there are two
// handles. With more than one, two concurrent writes reach SQLite together and
// one comes back SQLITE_BUSY for the caller to deal with.
func TestTheWriterPoolHoldsExactlyOneConnection(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	if got := database.Writer().Stats().MaxOpenConnections; got != 1 {
		t.Errorf("the writer pool allows %d connections, want 1", got)
	}
}

// TestBothHandlesCarryEveryPragma covers the trap in modernc.org/sqlite: a
// pragma is per connection, and a pool opens connections whenever it likes. A
// PRAGMA run once after sql.Open would hold on whichever connection happened to
// serve it and be absent from the next -- so this asks both pools, and asks
// through the pool rather than through a connection it configured itself.
func TestBothHandlesCarryEveryPragma(t *testing.T) {
	database := newMigratedCoreDatabase(t)

	handles := []struct {
		name string
		db   *sql.DB
	}{
		{"writer", database.Writer()},
		{"reader", database.Reader()},
	}
	wanted := []struct {
		pragma string
		value  string
	}{
		{"journal_mode", "wal"},
		{"foreign_keys", "1"},
		{"busy_timeout", "5000"},
		// NORMAL. SQLite answers this one as a number.
		{"synchronous", "1"},
	}

	for _, handle := range handles {
		for _, want := range wanted {
			var got string
			if err := handle.db.QueryRow("PRAGMA " + want.pragma).Scan(&got); err != nil {
				t.Fatalf("reading PRAGMA %s on the %s: %v", want.pragma, handle.name, err)
			}
			if got != want.value {
				t.Errorf("%s: PRAGMA %s = %q, want %q", handle.name, want.pragma, got, want.value)
			}
		}
	}
}

// TestClosingTheDatabaseLeavesNoWriteAheadLogBehind is what makes `cp -r` on the
// data directory a backup. The assertion is preceded by a check that there was a
// log to fold back in: without it the test would pass just as happily against a
// database nothing had ever written to.
func TestClosingTheDatabaseLeavesNoWriteAheadLogBehind(t *testing.T) {
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	if _, err := database.Writer().Exec(
		`INSERT INTO core_settings (key, value, updated_at) VALUES (?, ?, ?)`,
		"stats_hidden", "false", core.FormatTime(time.Now())); err != nil {
		t.Fatalf("writing a row: %v", err)
	}

	log := database.Path() + "-wal"
	if info, err := os.Stat(log); err != nil || info.Size() == 0 {
		t.Fatalf("there is no write-ahead log to checkpoint, so this test would prove nothing: stat %s = %v, %v",
			log, info, err)
	}

	if err := database.Close(context.Background()); err != nil {
		t.Fatalf("closing the database: %v", err)
	}

	info, err := os.Stat(log)
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		t.Fatalf("stat %s after shutdown: %v", log, err)
	case info.Size() != 0:
		t.Errorf("%s is %d bytes after shutdown, want absent or empty", log, info.Size())
	}
}
