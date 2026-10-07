// Package library is the library module's stub: enough of a Module to
// exercise the mounting, the separate goose table and the enable/disable
// behaviour before the real library lands. It owns one trivial table and no
// routes; the real library bead drops that table in its own, next migration.
package library

import (
	"context"
	"fmt"
	"io/fs"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/migrations"
)

func init() {
	app.RegisterNorteModule(ModuleName, NewLibraryStubModule)
}

// ModuleName is the name NORTE_MODULES spells this module with.
const ModuleName = "library"

// LibraryStubJobKind is the one job kind the stub runs, so the enable/disable
// claim behaviour has something to hold onto before the real jobs exist.
const LibraryStubJobKind = "library.stub"

// StubModule implements app.Module with one table and no routes.
type StubModule struct{}

// NewLibraryStubModule instantiates the stub. It is the factory main's blank
// import registers.
func NewLibraryStubModule() app.Module { return &StubModule{} }

// Name reports "library".
func (*StubModule) Name() string { return ModuleName }

// Migrations returns the stub's embedded migrations.
func (*StubModule) Migrations() fs.FS { return migrations.FS }

// Register mounts the stub's routes: there are none, so mounting the whole
// path is this no-op.
func (*StubModule) Register(_ *app.Router, _ app.Deps) {}

// Commands returns the stub's subcommands: one, so `norte --help` shows the
// module only when it is enabled.
func (*StubModule) Commands() []*cobra.Command {
	return []*cobra.Command{
		{
			Use:   "library",
			Short: "Library stub: exercises the module path before the real library lands",
			Args:  cobra.NoArgs,
			RunE: func(cmd *cobra.Command, _ []string) error {
				fmt.Fprintln(cmd.OutOrStdout(), "library stub: nothing to do yet")
				return nil
			},
		},
	}
}

// JobHandlers returns the stub's one kind, which succeeds at once.
func (*StubModule) JobHandlers() map[string]core.JobHandler {
	return map[string]core.JobHandler{
		LibraryStubJobKind: func(context.Context, core.Job) error { return nil },
	}
}

// Start blocks until ctx ends, then reports a clean stop. A failing adapter is
// exercised in tests with a fake module, not here.
func (*StubModule) Start(ctx context.Context) error {
	<-ctx.Done()
	return nil
}

// Text owns no item, so it always reports nobody known.
func (*StubModule) Text(context.Context, string) (string, bool, error) { return "", false, nil }

// FocusTargets reports nothing: the stub has nothing anyone is working on.
func (*StubModule) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return nil, nil
}

// SearchEntries reports no hits.
func (*StubModule) SearchEntries(context.Context, string, int) ([]core.SearchEntry, error) {
	return nil, nil
}
