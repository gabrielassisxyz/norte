// Package migrations holds the core's SQL migrations, embedded so the binary
// carries its own schema and needs no files installed beside it.
package migrations

import "embed"

// FS is what the core's goose provider reads. Only the core's migrations are in
// here: a module embeds its own, because the two are versioned separately.
//
//go:embed *.sql
var FS embed.FS
