package core

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"

	"github.com/gabrielassisxyz/norte/server/internal/core/migrations"
)

// CoreMigrationTable records which of the core's migrations have run.
//
// Every owner gets its own version table -- goose_core here, goose_<module> for
// a module. One shared table would number migrations globally, so two modules
// developed in parallel would collide on the next number and the loser would
// silently never run. Separate tables also mean a module can be added to a
// binary that has been running for months and migrate from zero.
const CoreMigrationTable = "goose_core"

// MigrateCore applies the core's pending migrations and reports how many ran,
// so `norte migrate` can say it did nothing instead of claiming work.
func MigrateCore(ctx context.Context, writer *sql.DB) (int, error) {
	provider, err := goose.NewProvider(goose.DialectSQLite3, writer, migrations.FS,
		goose.WithTableName(CoreMigrationTable),
		// goose's global registry is a package-level variable shared by every
		// provider in the process. A module's provider must not find the core's
		// migrations in it, nor the core a module's.
		goose.WithDisableGlobalRegistry(true),
	)
	if err != nil {
		return 0, fmt.Errorf("preparing the core migrations: %w", err)
	}
	applied, err := provider.Up(ctx)
	if err != nil {
		return 0, fmt.Errorf("applying the core migrations: %w", err)
	}
	return len(applied), nil
}
