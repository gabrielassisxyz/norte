// Package migrations holds the notes module's SQL migrations, embedded so the
// binary carries its own schema. Only the notes migrations are in here: every
// owner is versioned in its own goose table.
package migrations

import "embed"

// FS is what the notes module's goose provider reads.
//
//go:embed *.sql
var FS embed.FS
