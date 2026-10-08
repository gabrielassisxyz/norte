package core_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
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

// openWriteLockProbe is a third handle on the same file, used only to ask
// whether somebody else is holding the write lock right now. Its own
// busy_timeout is deliberately tiny: the core's five seconds would turn every
// answer of "yes, it is held" into a five-second pause.
func openWriteLockProbe(t *testing.T, path string) *sql.DB {
	t.Helper()
	probe, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(200)&_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("opening a probe handle on %s: %v", path, err)
	}
	probe.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := probe.Close(); err != nil {
			t.Errorf("closing the probe handle: %v", err)
		}
	})
	return probe
}

// writeOneSetting is the smallest write the core's schema allows, used as the
// thing contention is observed on.
func writeOneSetting(ctx context.Context, handle interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, key string) error {
	_, err := handle.ExecContext(ctx,
		`INSERT INTO core_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		key, "x", core.FormatTime(time.Now()))
	return err
}

// TestTheWriterTakesTheWriteLockAtBegin is the whole point of the immediate
// mode: the lock is held from BEGIN, before the transaction's first statement,
// so a save that reads and then writes cannot have another process commit
// underneath it. The probe's failure is what proves the lock is held, and the
// probe's success right after the rollback is what proves the failure was the
// lock rather than something permanently wrong with the probe.
func TestTheWriterTakesTheWriteLockAtBegin(t *testing.T) {
	ctx := context.Background()
	database := newMigratedCoreDatabase(t)
	probe := openWriteLockProbe(t, database.Path())

	tx, err := database.Writer().BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("beginning a write transaction: %v", err)
	}
	// Not one statement has run on tx. Under a deferred BEGIN no lock exists
	// yet and the probe gets through.
	if err := writeOneSetting(ctx, probe, "probe_during"); err == nil {
		_ = tx.Rollback()
		t.Fatal("the probe wrote while a write transaction was open, so BEGIN took no write lock")
	}

	if err := tx.Rollback(); err != nil {
		t.Fatalf("rolling the write transaction back: %v", err)
	}
	if err := writeOneSetting(ctx, probe, "probe_after"); err != nil {
		t.Fatalf("the probe cannot write even with no transaction open, so the check above proved nothing: %v", err)
	}
}

// TestTheReaderDoesNotTakeTheWriteLock is the other half of the criterion: the
// read path is unchanged. A query transaction on the reader pool must not keep
// a writer out, which is exactly what applying the immediate mode to both
// handles would do.
func TestTheReaderDoesNotTakeTheWriteLock(t *testing.T) {
	ctx := context.Background()
	database := newMigratedCoreDatabase(t)
	probe := openWriteLockProbe(t, database.Path())

	tx, err := database.Reader().BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("beginning a read transaction: %v", err)
	}
	defer func() {
		if err := tx.Rollback(); err != nil {
			t.Errorf("rolling the read transaction back: %v", err)
		}
	}()
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM core_settings`).Scan(&count); err != nil {
		t.Fatalf("reading inside the read transaction: %v", err)
	}

	if err := writeOneSetting(ctx, probe, "probe_during_read"); err != nil {
		t.Fatalf("a read transaction on the reader pool kept a writer out: %v", err)
	}
}

// TestInterleavedReadThenWriteTransactionsAcrossHandlesNeverGoBusy is the
// defect as the person meets it: `norte save` on the command line and the
// running server both saving, each transaction reading before it writes. Two
// independent handles on one file behave as two processes do -- a connection is
// a connection, whoever opened it -- and a deferred BEGIN here returns
// SQLITE_BUSY_SNAPSHOT instead of waiting, because the snapshot the read took
// is already stale by the time the write asks for the lock.
func TestInterleavedReadThenWriteTransactionsAcrossHandlesNeverGoBusy(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	first := newEmptyCoreDatabase(t, dataDir)
	if _, err := core.MigrateCore(ctx, first.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	second := newEmptyCoreDatabase(t, dataDir)

	// 100 each, so 200 writes land in all.
	const roundsPerHandle = 100
	handles := map[string]*core.Database{"first": first, "second": second}

	var waiting sync.WaitGroup
	failures := make(chan error, 2*roundsPerHandle)
	for name, handle := range handles {
		waiting.Add(1)
		go func(name string, handle *core.Database) {
			defer waiting.Done()
			for round := range roundsPerHandle {
				if err := readThenWrite(ctx, handle, fmt.Sprintf("%s_%d", name, round)); err != nil {
					failures <- fmt.Errorf("%s round %d: %w", name, round, err)
				}
			}
		}(name, handle)
	}
	waiting.Wait()
	close(failures)

	failed := 0
	for err := range failures {
		failed++
		if failed <= 3 {
			t.Errorf("%v", err)
		}
	}
	if failed > 0 {
		t.Fatalf("%d of %d transactions failed", failed, 2*roundsPerHandle)
	}

	var written int
	if err := first.Reader().QueryRowContext(ctx, `SELECT count(*) FROM core_settings`).Scan(&written); err != nil {
		t.Fatalf("counting what was written: %v", err)
	}
	if written != 2*roundsPerHandle {
		t.Errorf("%d rows were written, want %d", written, 2*roundsPerHandle)
	}
}

// readThenWrite is the shape of a save: a lookup, then an insert, in one
// transaction. The read is what makes a deferred transaction take a snapshot it
// then has to write against.
func readThenWrite(ctx context.Context, database *core.Database, key string) error {
	tx, err := database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning: %w", err)
	}
	var existing int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM core_settings WHERE key = ?`, key).Scan(&existing); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("reading: %w", err)
	}
	if err := writeOneSetting(ctx, tx, key); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("writing: %w", err)
	}
	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("committing: %w", err)
	}
	return nil
}
