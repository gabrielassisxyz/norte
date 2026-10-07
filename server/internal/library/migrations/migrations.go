// Package migrations holds the library stub's SQL migrations, embedded so
// the binary carries its own schema. The stub owns one throwaway table;
// the real library bead adds its tables as the next migration.
package migrations

import "embed"

// FS is what the library's goose provider reads. Only the library's
// migrations are in here: every owner is versioned in its own table.
//
//go:embed *.sql
var FS embed.FS
