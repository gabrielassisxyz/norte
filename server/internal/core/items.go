package core

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ItemRegistration is what a module tells the core about something it has just
// created, so that something else can link to it.
//
// It is only what is needed to *open* the item -- its type, its title, the url
// to follow -- and nothing needed to read it. See core_items in the core
// migration for why.
type ItemRegistration struct {
	ID        string
	Module    string
	Type      string
	Title     string
	URL       string
	CreatedAt time.Time
}

// RegisterItem records an item in the cross-module registry.
//
// It takes the caller's transaction rather than opening its own, so the registry
// row and the module's own row land together or not at all. A module row with no
// registry entry is invisible to every link; a registry entry with no module row
// renders a link to something that is not there.
func RegisterItem(ctx context.Context, tx *sql.Tx, item ItemRegistration) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO core_items (id, module, type, title, url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		item.ID, item.Module, item.Type, item.Title, nullableText(item.URL), FormatTime(item.CreatedAt))
	if err != nil {
		return fmt.Errorf("registering item %s: %w", item.ID, err)
	}
	return nil
}

// UpdateItem follows a rename or a retype in the owning module. Only the two
// fields a link renders can change: the module and the url identify the item,
// and changing either would make this a different item under the same id.
func UpdateItem(ctx context.Context, tx *sql.Tx, id, title, itemType string) error {
	result, err := tx.ExecContext(ctx,
		`UPDATE core_items SET title = ?, type = ? WHERE id = ?`, title, itemType, id)
	if err != nil {
		return fmt.Errorf("updating item %s: %w", id, err)
	}
	return requireOneRow(result, "item", id)
}

// UnregisterItem removes an item and, by cascade, every link touching it and
// every file reference it owned. The blobs those references held are left on
// disk for `norte files gc`, which is the only thing that deletes a blob.
func UnregisterItem(ctx context.Context, tx *sql.Tx, id string) error {
	result, err := tx.ExecContext(ctx, `DELETE FROM core_items WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("unregistering item %s: %w", id, err)
	}
	return requireOneRow(result, "item", id)
}

// requireOneRow turns "the statement ran and matched nothing" into an error.
// Without it a caller that updates an item some other path already deleted
// carries on as though the registry agreed with it.
func requireOneRow(result sql.Result, what, id string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("reading the number of affected rows for %s %s: %w", what, id, err)
	}
	if affected == 0 {
		return fmt.Errorf("no such %s: %s", what, id)
	}
	return nil
}

// nullableText stores an absent string as NULL, so "this item has no url" is one
// value in the column rather than two.
func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}
