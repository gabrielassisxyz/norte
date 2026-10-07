package core

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	// The SQLite driver is a pure-Go translation, which is what lets `norte` be
	// one static binary with CGO switched off.
	_ "modernc.org/sqlite"
)

// sqliteDriverName is the name modernc.org/sqlite registers itself under.
const sqliteDriverName = "sqlite"

// DatabaseFileName and FileStoreDirName are everything Norte puts in the data
// directory. Backing the installation up is copying that directory, and
// restoring it is putting the directory back, which only works while those two
// are the whole of it.
const (
	DatabaseFileName = "norte.db"
	FileStoreDirName = "files"
)

// The data directory holds every page the person saved and every note they
// wrote, on a machine that may have other accounts on it, so nothing in it is
// readable by anyone else.
const (
	dataDirMode  fs.FileMode = 0o700
	dataFileMode fs.FileMode = 0o600
)

// readerPoolSize bounds the connections serving queries. Norte has one user, so
// this is about a handful of concurrent requests, not about throughput.
const readerPoolSize = 4

// Database is Norte's two handles onto the one SQLite file.
//
// Writes go through a pool of exactly one connection. Two writes then queue
// inside this process, where queuing is free, instead of reaching SQLite
// together and coming back as SQLITE_BUSY for the caller to retry. Reads go
// through a separate pool, so a list query never waits behind an import.
type Database struct {
	writer *sql.DB
	reader *sql.DB
	path   string
}

// OpenDatabase creates the data directory and the database file if they are
// missing, and returns the handles onto it. It applies no migrations: `migrate`
// and `serve` do that, and `version` and `config` must be able to answer on a
// machine that has never been set up.
func OpenDatabase(ctx context.Context, dataDir string) (*Database, error) {
	if err := ensurePrivateDir(dataDir); err != nil {
		return nil, err
	}
	path := filepath.Join(dataDir, DatabaseFileName)
	if err := ensurePrivateFile(path); err != nil {
		return nil, err
	}

	writer, err := sql.Open(sqliteDriverName, databaseDSN(path))
	if err != nil {
		return nil, fmt.Errorf("opening %s for writing: %w", path, err)
	}
	writer.SetMaxOpenConns(1)
	writer.SetMaxIdleConns(1)

	reader, err := sql.Open(sqliteDriverName, databaseDSN(path))
	if err != nil {
		return nil, errors.Join(fmt.Errorf("opening %s for reading: %w", path, err), writer.Close())
	}
	reader.SetMaxOpenConns(readerPoolSize)
	reader.SetMaxIdleConns(readerPoolSize)

	database := &Database{writer: writer, reader: reader, path: path}
	// sql.Open is lazy and connects to nothing, so a path that cannot be opened
	// or a file that is not a database would otherwise surface much later, as a
	// failed request rather than a failed startup.
	if err := writer.PingContext(ctx); err != nil {
		return nil, errors.Join(fmt.Errorf("opening %s: %w", path, err), database.Close(ctx))
	}
	return database, nil
}

// Writer is the handle every write and the jobs worker use. One save or one
// import is one transaction on it.
func (d *Database) Writer() *sql.DB { return d.writer }

// Reader is the pool queries use.
func (d *Database) Reader() *sql.DB { return d.reader }

// Path is the database file.
func (d *Database) Path() string { return d.path }

// Close is the shutdown path: it folds the write-ahead log back into norte.db,
// empties it, and closes both handles. That is what leaves the data directory as
// one self-contained file, so copying it is a backup rather than two thirds of
// one.
//
// The reader pool goes first. A TRUNCATE checkpoint cannot finish while another
// connection holds a read lock, and an idle pooled connection today is one that
// a later release leaves mid-query.
func (d *Database) Close(ctx context.Context) error {
	var problems []error
	if err := d.reader.Close(); err != nil {
		problems = append(problems, fmt.Errorf("closing the reader pool: %w", err))
	}
	if err := checkpointWAL(ctx, d.writer); err != nil {
		problems = append(problems, err)
	}
	if err := d.writer.Close(); err != nil {
		problems = append(problems, fmt.Errorf("closing the writer: %w", err))
	}
	return errors.Join(problems...)
}

// checkpointWAL runs the checkpoint and reads its verdict. The pragma answers
// with a row rather than an error when it could not finish, so ignoring the row
// is how a database gets shut down with its log still beside it.
func checkpointWAL(ctx context.Context, writer *sql.DB) error {
	var busy, logPages, checkpointed int
	err := writer.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logPages, &checkpointed)
	if err != nil {
		return fmt.Errorf("checkpointing the write-ahead log: %w", err)
	}
	if busy != 0 {
		return fmt.Errorf("checkpointing the write-ahead log: another connection still holds a lock on %s", DatabaseFileName)
	}
	return nil
}

// databaseDSN carries the pragmas in the connection string because
// modernc.org/sqlite applies them per connection, and a pool opens a connection
// whenever it likes: a PRAGMA executed once after sql.Open would hold on that
// one connection and be absent from the next.
//
// The form is a plain path rather than a file: URI, so the path reaches SQLite
// verbatim. A URI would need every '#', '%' and space in it escaped, and a data
// directory is wherever the person put it.
func databaseDSN(path string) string {
	pragmas := []string{
		// A reader no longer blocks the writer, and a crash leaves a log to
		// replay rather than a half-written page.
		"_pragma=journal_mode(WAL)",
		// Five seconds of waiting rather than an immediate SQLITE_BUSY, which
		// covers a checkpoint or another process holding the file briefly.
		"_pragma=busy_timeout(5000)",
		// Off by default in SQLite, and every cascade in the core's schema
		// depends on it.
		"_pragma=foreign_keys(1)",
		// fsync at a checkpoint rather than at every commit. Under WAL this
		// risks the last transactions to a power cut, never a corrupt file.
		"_pragma=synchronous(NORMAL)",
	}
	return path + "?" + strings.Join(pragmas, "&")
}

// ensurePrivateDir creates dir, and its parents, private to the user.
//
// A directory that already exists keeps the mode it has: the person may have
// widened it deliberately, and narrowing it silently would break whatever
// relies on that without saying so.
func ensurePrivateDir(dir string) error {
	info, err := os.Stat(dir)
	switch {
	case err == nil && info.IsDir():
		return nil
	case err == nil:
		return fmt.Errorf("%s exists and is not a directory", dir)
	case !errors.Is(err, fs.ErrNotExist):
		return fmt.Errorf("inspecting %s: %w", dir, err)
	}
	if err := os.MkdirAll(dir, dataDirMode); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	// MkdirAll subtracts the process umask from the mode it is given, and the
	// umask of whoever starts this program is not ours to choose.
	if err := os.Chmod(dir, dataDirMode); err != nil {
		return fmt.Errorf("restricting %s: %w", dir, err)
	}
	return nil
}

// ensurePrivateFile creates path private to the user if it is not there yet.
//
// The database file is created here rather than left to SQLite for a reason that
// is not about this file: SQLite gives norte.db the process umask, and gives
// norte.db-wal and norte.db-shm the mode of the main file it finds. Creating an
// empty private file first -- which SQLite reads as an empty database -- is what
// keeps all three private.
func ensurePrivateFile(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, dataFileMode)
	if errors.Is(err, fs.ErrExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("creating %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("creating %s: %w", path, err)
	}
	if err := os.Chmod(path, dataFileMode); err != nil {
		return fmt.Errorf("restricting %s: %w", path, err)
	}
	return nil
}
