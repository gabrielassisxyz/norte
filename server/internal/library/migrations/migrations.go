// Package migrations holds the library's SQL migrations, embedded so the
// binary carries its own schema. The first is the stub's throwaway table; the
// second drops it and creates the real tables.
package migrations

import "embed"

// FS is what the library's goose provider reads. Only the library's
// migrations are in here: every owner is versioned in its own table.
//
//go:embed *.sql
var FS embed.FS
