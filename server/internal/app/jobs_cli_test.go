package app_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// insertJobsCLIJob puts one core_jobs row in place for the CLI tests, which
// exercise the command line rather than the queue's own Enqueue path.
func insertJobsCLIJob(t *testing.T, dataDir, id, kind, status string, attempts int, dedupe string) {
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
	stamp := core.FormatTime(time.Date(2026, 3, 9, 17, 0, 0, 0, time.UTC))
	dedupeParam := ""
	if dedupe != "" {
		dedupeParam = "'" + dedupe + "'"
	} else {
		dedupeParam = "NULL"
	}
	_ = dedupeParam
	var dedupeValue any
	if dedupe == "" {
		dedupeValue = nil
	} else {
		dedupeValue = dedupe
	}
	if _, err := database.Writer().Exec(
		`INSERT INTO core_jobs (id, kind, payload, dedupe_key, status, attempts, available_at, created_at, last_error)
		 VALUES (?, ?, '{}', ?, ?, ?, ?, ?, CASE WHEN ? = 'failed' THEN 'boom' ELSE NULL END)`,
		id, kind, dedupeValue, status, attempts, stamp, stamp, status); err != nil {
		t.Fatalf("inserting job %s: %v", id, err)
	}
}

func readJobsCLIStatus(t *testing.T, dataDir, id string) (string, int) {
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
	var status string
	var attempts int
	if err := database.Reader().QueryRow(
		`SELECT status, attempts FROM core_jobs WHERE id = ?`, id).Scan(&status, &attempts); err != nil {
		t.Fatalf("reading job %s: %v", id, err)
	}
	return status, attempts
}

func TestJobsListShowsJobs(t *testing.T) {
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	failedID := core.NewID()
	doneID := core.NewID()
	insertJobsCLIJob(t, dataDir, failedID, "fetch", "failed", 3, "")
	insertJobsCLIJob(t, dataDir, doneID, "extract", "done", 1, "")

	out, err := runNorte(t, dataDir, "jobs", "list")
	if err != nil {
		t.Fatalf("norte jobs list: %v\n%s", err, out)
	}
	for _, want := range []string{"id", "kind", "status", "attempts", "available_at", "last_error", failedID, doneID} {
		if !strings.Contains(out, want) {
			t.Errorf("norte jobs list output misses %q:\n%s", want, out)
		}
	}
}

func TestJobsRetryRequeuesFailedAndRefusesDone(t *testing.T) {
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	failedID := core.NewID()
	insertJobsCLIJob(t, dataDir, failedID, "fetch", "failed", 3, "")

	out, err := runNorte(t, dataDir, "jobs", "retry", failedID)
	if err != nil {
		t.Fatalf("norte jobs retry %s: %v\n%s", failedID, err, out)
	}
	if status, attempts := readJobsCLIStatus(t, dataDir, failedID); status != "queued" || attempts != 0 {
		t.Errorf("after retry status=%s attempts=%d, want queued and zero", status, attempts)
	}

	doneID := core.NewID()
	insertJobsCLIJob(t, dataDir, doneID, "fetch", "done", 1, "")
	out, err = runNorte(t, dataDir, "jobs", "retry", doneID)
	if err == nil {
		t.Fatalf("norte jobs retry on a done job succeeded, want a non-zero exit\n%s", out)
	}
	if status, attempts := readJobsCLIStatus(t, dataDir, doneID); status != "done" || attempts != 1 {
		t.Errorf("retrying a done job changed it to status=%s attempts=%d", status, attempts)
	}
}

func TestJobsRetryRefusesWhenDedupeKeyIsHeld(t *testing.T) {
	dataDir := emptyDataDirPath(t)
	if out, err := runNorte(t, dataDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	failedID := core.NewID()
	blockingID := core.NewID()
	insertJobsCLIJob(t, dataDir, failedID, "fetch", "failed", 3, "page:9")
	insertJobsCLIJob(t, dataDir, blockingID, "fetch", "queued", 0, "page:9")

	out, err := runNorte(t, dataDir, "jobs", "retry", failedID)
	if err == nil {
		t.Fatalf("norte jobs retry past a held key succeeded, want a refusal\n%s", out)
	}
	if status, _ := readJobsCLIStatus(t, dataDir, failedID); status != "failed" {
		t.Errorf("the failed job moved to %s, want it unchanged", status)
	}
	if status, _ := readJobsCLIStatus(t, dataDir, blockingID); status != "queued" {
		t.Errorf("the blocking job moved to %s, want it unchanged", status)
	}
}

// TestJobsListDoesNotRunMigrations is the gate on the command's blast radius:
// against a database from an older core version it must report what is there
// without bringing the schema forward, so goose_core is unchanged after it.
func TestJobsListDoesNotRunMigrations(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "share", "norte")
	// No migrate: the data directory has never been set up, so core_jobs does
	// not exist and list must fail without creating the version table.
	_, err := runNorte(t, dataDir, "jobs", "list")
	if err == nil {
		t.Fatal("norte jobs list on an unmigrated database succeeded, want it to fail without migrating")
	}
	after := tableNames(t, filepath.Join(dataDir, core.DatabaseFileName))
	for _, name := range after {
		if name == core.CoreMigrationTable {
			t.Fatalf("jobs list created %s on an unmigrated database, want no migration", core.CoreMigrationTable)
		}
	}
	// And on a migrated database the version is unchanged.
	migratedDir := emptyDataDirPath(t)
	if out, err := runNorte(t, migratedDir, "migrate"); err != nil {
		t.Fatalf("norte migrate: %v\n%s", err, out)
	}
	before := tableNames(t, filepath.Join(migratedDir, core.DatabaseFileName))
	hasGoose := false
	for _, name := range before {
		if name == core.CoreMigrationTable {
			hasGoose = true
		}
	}
	if !hasGoose {
		t.Fatalf("set-up created no %s; it created %v", core.CoreMigrationTable, before)
	}
	var versionBefore string
	{
		database, err := core.OpenDatabase(context.Background(), migratedDir)
		if err != nil {
			t.Fatalf("opening the database: %v", err)
		}
		if err := database.Reader().QueryRow(
			`SELECT version_id FROM goose_core ORDER BY version_id DESC LIMIT 1`).Scan(&versionBefore); err != nil {
			_ = database.Close(context.Background())
			t.Fatalf("reading the core version: %v", err)
		}
		if err := database.Close(context.Background()); err != nil {
			t.Fatalf("closing the database: %v", err)
		}
	}

	if out, err := runNorte(t, migratedDir, "jobs", "list"); err != nil {
		t.Fatalf("norte jobs list: %v\n%s", err, out)
	}

	database, err := core.OpenDatabase(context.Background(), migratedDir)
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	defer func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	}()
	var versionAfter string
	if err := database.Reader().QueryRow(
		`SELECT version_id FROM goose_core ORDER BY version_id DESC LIMIT 1`).Scan(&versionAfter); err != nil {
		t.Fatalf("reading the core version after jobs list: %v", err)
	}
	if versionAfter != versionBefore {
		t.Errorf("goose_core moved from %s to %s under jobs list, want it unchanged", versionBefore, versionAfter)
	}
}
