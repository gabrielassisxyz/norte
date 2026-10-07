package core_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

func TestRegisterItemStoresWhatALinkNeedsToRenderIt(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := core.NewID()

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.RegisterItem(context.Background(), tx, core.ItemRegistration{
			ID:        id,
			Module:    "library",
			Type:      "article",
			Title:     "A page worth keeping",
			URL:       "https://example.invalid/page",
			CreatedAt: fixedInstant,
		})
	})

	var module, itemType, title, url, createdAt string
	if err := database.Reader().QueryRow(
		`SELECT module, type, title, url, created_at FROM core_items WHERE id = ?`, id).
		Scan(&module, &itemType, &title, &url, &createdAt); err != nil {
		t.Fatalf("reading the registered item: %v", err)
	}
	if module != "library" || itemType != "article" || title != "A page worth keeping" {
		t.Errorf("stored %q/%q/%q, want library/article/A page worth keeping", module, itemType, title)
	}
	if url != "https://example.invalid/page" {
		t.Errorf("url = %q", url)
	}
	if want := core.FormatTime(fixedInstant); createdAt != want {
		t.Errorf("created_at = %q, want %q", createdAt, want)
	}
}

// TestRegisterItemStoresAnAbsentURLAsNULL keeps "this item cannot be opened in a
// browser" as one value in the column instead of two a query has to test for.
func TestRegisterItemStoresAnAbsentURLAsNULL(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := core.NewID()

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.RegisterItem(context.Background(), tx, core.ItemRegistration{
			ID: id, Module: "projects", Type: "project", Title: "No url", CreatedAt: fixedInstant,
		})
	})

	var url sql.NullString
	if err := database.Reader().QueryRow(`SELECT url FROM core_items WHERE id = ?`, id).Scan(&url); err != nil {
		t.Fatalf("reading the registered item: %v", err)
	}
	if url.Valid {
		t.Errorf("url = %q, want NULL", url.String)
	}
}

func TestUpdateItemFollowsARenameAndARetype(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := registerTestItem(t, database, "before")

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.UpdateItem(context.Background(), tx, id, "after", "note")
	})

	var title, itemType string
	if err := database.Reader().QueryRow(
		`SELECT title, type FROM core_items WHERE id = ?`, id).Scan(&title, &itemType); err != nil {
		t.Fatalf("reading the item: %v", err)
	}
	if title != "after" || itemType != "note" {
		t.Errorf("the item is %q/%q, want after/note", title, itemType)
	}
}

// TestUpdateItemAndUnregisterItemRefuseAnUnknownID turns "the statement ran and
// matched nothing" into an error. Without it a module that renamed an item some
// other path had already deleted would carry on as though the registry agreed
// with it.
func TestUpdateItemAndUnregisterItemRefuseAnUnknownID(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	missing := core.NewID()

	tx, err := database.Writer().Begin()
	if err != nil {
		t.Fatalf("beginning a transaction: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := core.UpdateItem(context.Background(), tx, missing, "whatever", "note"); err == nil {
		t.Error("UpdateItem on an unknown id returned no error")
	}
	if err := core.UnregisterItem(context.Background(), tx, missing); err == nil {
		t.Error("UnregisterItem on an unknown id returned no error")
	}
}

// TestUnregisterItemCascadesToItsFileReferences is the cascade that lets a blob
// become collectable: `norte files gc` reads core_file_refs and nothing else, so
// a reference that outlived its owner would keep a blob alive forever. The other
// item's reference is there to show the delete is targeted.
func TestUnregisterItemCascadesToItsFileReferences(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	doomed := registerTestItem(t, database, "doomed")
	keeper := registerTestItem(t, database, "keeper")

	const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if _, err := database.Writer().Exec(
		`INSERT INTO core_files (hash, media_type, size, created_at) VALUES (?, 'text/html', 0, ?)`,
		hash, core.FormatTime(fixedInstant)); err != nil {
		t.Fatalf("recording the blob: %v", err)
	}
	for _, owner := range []string{doomed, keeper} {
		if _, err := database.Writer().Exec(
			`INSERT INTO core_file_refs (hash, owner_id, kind) VALUES (?, ?, ?)`,
			hash, owner, core.FileRefSnapshot); err != nil {
			t.Fatalf("referencing the blob from %s: %v", owner, err)
		}
	}

	inCoreTransaction(t, database, func(tx *sql.Tx) error {
		return core.UnregisterItem(context.Background(), tx, doomed)
	})

	if got := countRows(t, database,
		`SELECT count(*) FROM core_file_refs WHERE owner_id = ?`, doomed); got != 0 {
		t.Errorf("%d file references to the deleted item survived", got)
	}
	if got := countRows(t, database,
		`SELECT count(*) FROM core_file_refs WHERE owner_id = ?`, keeper); got != 1 {
		t.Errorf("the other item's reference count is %d, want 1", got)
	}
	// The blob itself stays: only `norte files gc` deletes one, an hour later.
	if got := countRows(t, database, `SELECT count(*) FROM core_files`); got != 1 {
		t.Errorf("%d core_files rows remain, want 1", got)
	}
}
