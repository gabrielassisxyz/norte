package app_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// runNorte drives the real command line in this process against a data
// directory of the test's own. The environment is pinned so the command cannot
// reach the config file or the data directory of whoever is running the suite.
func runNorte(t *testing.T, dataDir string, args ...string) (stdout string, err error) {
	t.Helper()
	t.Setenv("NORTE_DATA", dataDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(t.TempDir(), "config"))
	t.Setenv("HOME", t.TempDir())

	var out, errOut bytes.Buffer
	root := app.NewRootCommand()
	root.SetArgs(args)
	root.SetOut(&out)
	root.SetErr(&errOut)
	if err := root.ExecuteContext(context.Background()); err != nil {
		return out.String(), err
	}
	return out.String(), nil
}

// emptyDataDirPath returns a path inside the test's temporary directory that
// does not exist yet, which is the case `norte migrate` has to handle on a fresh
// machine.
func emptyDataDirPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "share", "norte")
}

// TestMigrateCreatesThePrivateDataDirectoryAndIsIdempotent is the acceptance
// path of this command: a fresh machine, then the same command again on the next
// upgrade that happens to carry no new migration.
func TestMigrateCreatesThePrivateDataDirectoryAndIsIdempotent(t *testing.T) {
	dataDir := emptyDataDirPath(t)

	first, err := runNorte(t, dataDir, "migrate")
	if err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, first)
	}
	if !strings.Contains(first, "applied 1 core migration") {
		t.Errorf("the first run said %q, want it to report the migration it applied", strings.TrimSpace(first))
	}

	databasePath := filepath.Join(dataDir, core.DatabaseFileName)
	assertPerm(t, dataDir, 0o700)
	assertPerm(t, databasePath, 0o600)

	tables := tableNames(t, databasePath)
	for _, want := range []string{
		"core_file_refs", "core_files", "core_items", "core_jobs",
		"core_links", "core_settings", "core_subject_aliases", "core_subjects",
	} {
		if !strings.Contains(" "+strings.Join(tables, " ")+" ", " "+want+" ") {
			t.Errorf("norte migrate created no %s; it created %v", want, tables)
		}
	}

	second, err := runNorte(t, dataDir, "migrate")
	if err != nil {
		t.Fatalf("the second norte migrate failed: %v\n%s", err, second)
	}
	if strings.Contains(second, "applied") {
		t.Errorf("the second run said %q, want it to report nothing pending", strings.TrimSpace(second))
	}
	if !strings.Contains(second, "up to date") {
		t.Errorf("the second run said %q, want it to say the database is up to date", strings.TrimSpace(second))
	}
}

// TestVersionAndConfigNeverTouchTheDatabase is what makes those two answerable
// on a machine that has never been set up -- and keeps a read-only question from
// writing a file as a side effect.
func TestVersionAndConfigNeverTouchTheDatabase(t *testing.T) {
	for _, command := range []string{"version", "config"} {
		t.Run(command, func(t *testing.T) {
			dataDir := emptyDataDirPath(t)

			if out, err := runNorte(t, dataDir, command); err != nil {
				t.Fatalf("norte %s: %v\n%s", command, err, out)
			}

			if _, err := os.Stat(filepath.Join(dataDir, core.DatabaseFileName)); !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("norte %s created %s (stat: %v)", command, core.DatabaseFileName, err)
			}
			if _, err := os.Stat(dataDir); !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("norte %s created the data directory %s (stat: %v)", command, dataDir, err)
			}
		})
	}
}

// TestFilesGCDeletesAnOldUnreferencedBlob exercises the subcommand's wiring: the
// three-case behaviour is proved against a manual clock in the core's own tests,
// and what is left to show here is that this command reaches it with the real
// data directory and the real database.
func TestFilesGCDeletesAnOldUnreferencedBlob(t *testing.T) {
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}

	// Written straight to disk and to core_files, back-dated past the grace
	// period: the store's clock is the system one in a real run, so a blob this
	// command should collect is one that was stored over an hour ago.
	hash := writeBackdatedBlob(t, dataDir, "<html>nobody's page</html>", -2*time.Hour)

	out, err := runNorte(t, dataDir, "files", "gc")
	if err != nil {
		t.Fatalf("norte files gc: %v\n%s", err, out)
	}
	if !strings.Contains(out, "deleted 1 unreferenced blob") {
		t.Errorf("norte files gc said %q, want it to report the one blob it deleted", strings.TrimSpace(out))
	}

	blobPath := filepath.Join(dataDir, core.FileStoreDirName, hash[:2], hash)
	if _, err := os.Stat(blobPath); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("%s survived norte files gc (stat: %v)", blobPath, err)
	}
}

// TestServeAppliesTheCoreMigrationsBeforeAnsweringHealth starts the real binary
// against a data directory that does not exist. /api/health answering at all
// means the listener opened, and the listener opens after the migrations run, so
// the tables being there when health answers is the ordering under test.
func TestServeAppliesTheCoreMigrationsBeforeAnsweringHealth(t *testing.T) {
	if testing.Short() {
		t.Skip("builds and starts the binary")
	}

	dataDir := filepath.Join(t.TempDir(), "share", "norte")
	server := startNorteServeWithData(t, buildNorteBinary(t), dataDir)

	response, err := http.Get(server.baseURL + "/api/health")
	if err != nil {
		t.Fatalf("GET /api/health: %v\n%s", err, server.log())
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/health = %d, want 200\n%s", response.StatusCode, server.log())
	}

	tables := tableNames(t, filepath.Join(dataDir, core.DatabaseFileName))
	for _, want := range []string{"core_items", "core_links", "core_files"} {
		if !strings.Contains(" "+strings.Join(tables, " ")+" ", " "+want+" ") {
			t.Errorf("health answered before %s existed; the database holds %v", want, tables)
		}
	}
}

// writeBackdatedBlob puts a blob in the store the way core.Files would, with a
// created_at the test chooses relative to now.
func writeBackdatedBlob(t *testing.T, dataDir, content string, age time.Duration) string {
	t.Helper()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	defer func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	}()

	store := core.NewFiles(dataDir, database.Writer(), core.SystemClock())
	blob, err := store.Store(context.Background(), strings.NewReader(content), "text/html")
	if err != nil {
		t.Fatalf("storing the blob: %v", err)
	}
	if _, err := database.Writer().Exec(
		`UPDATE core_files SET created_at = ? WHERE hash = ?`,
		core.FormatTime(time.Now().Add(age)), blob.Hash); err != nil {
		t.Fatalf("back-dating the blob: %v", err)
	}
	if _, err := hex.DecodeString(blob.Hash); err != nil {
		t.Fatalf("the hash %q is not hex: %v", blob.Hash, err)
	}
	return blob.Hash
}

// tableNames reads the schema with a connection of its own, so it reports what
// is on disk rather than what some handle the test still holds believes.
func tableNames(t *testing.T, databasePath string) []string {
	t.Helper()
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatalf("opening %s: %v", databasePath, err)
	}
	defer func() { _ = database.Close() }()

	rows, err := database.Query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
	if err != nil {
		t.Fatalf("reading the schema of %s: %v", databasePath, err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("reading a table name: %v", err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading the schema of %s: %v", databasePath, err)
	}
	return names
}

func assertPerm(t *testing.T, path string, want fs.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Errorf("%s has mode %04o, want %04o", path, got, want)
	}
}
