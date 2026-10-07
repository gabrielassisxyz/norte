// Package library is the library module: saved links with canonical-URL
// dedupe, views, counts and full-text search.
package library

import (
	"context"
	"io/fs"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/migrations"
)

func init() {
	app.RegisterNorteModule(ModuleName, NewLibraryModule)
}

// ModuleName is the name NORTE_MODULES spells this module with.
const ModuleName = "library"

// LibraryStubJobKind is the one job kind the stub ran, kept so the
// enable/disable claim behaviour has a handler until the extraction bead
// registers the real one. It succeeds at once.
const LibraryStubJobKind = "library.stub"

// LibraryModule implements app.Module: the library's tables, routes,
// subcommands and jobs.
type LibraryModule struct{}

// NewLibraryModule instantiates the module. It is the factory main's blank
// import registers.
func NewLibraryModule() app.Module { return &LibraryModule{} }

// Name reports "library".
func (*LibraryModule) Name() string { return ModuleName }

// Migrations returns the embedded migrations.
func (*LibraryModule) Migrations() fs.FS { return migrations.FS }

// Register mounts the library's routes under /api/library/.
func (*LibraryModule) Register(router *app.Router, deps app.Deps) {
	mountLibraryAPI(router, LibraryHandlers{
		service: NewLibraryService(deps.Database, deps.Files, deps.Jobs, deps.Clock),
	})
}

// Commands returns the module's subcommands: saving a link.
func (*LibraryModule) Commands() []*cobra.Command {
	return []*cobra.Command{newLibrarySaveCommand()}
}

// JobHandlers returns the stub's one kind, which succeeds at once. The
// extraction bead replaces it with the worker that drains the extract jobs
// saves enqueue.
func (*LibraryModule) JobHandlers() map[string]core.JobHandler {
	return map[string]core.JobHandler{
		LibraryStubJobKind: func(context.Context, core.Job) error { return nil },
	}
}

// Start blocks until ctx ends, then reports a clean stop. The extraction bead
// adds the adapter this module will run.
func (*LibraryModule) Start(ctx context.Context) error {
	<-ctx.Done()
	return nil
}

// Text owns no readable text yet: the extraction bead adds the provider that
// renders an item.
func (*LibraryModule) Text(context.Context, string) (string, bool, error) { return "", false, nil }

// FocusTargets reports nothing: the subjects bead adds what the person is
// working on.
func (*LibraryModule) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return nil, nil
}

// SearchEntries reports no hits: the search bead adds the provider.
func (*LibraryModule) SearchEntries(context.Context, string, int) ([]core.SearchEntry, error) {
	return nil, nil
}
