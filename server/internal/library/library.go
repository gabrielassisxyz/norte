// Package library is the library module: saved links with canonical-URL
// dedupe, views, counts, full-text search and background article extraction.
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
	mountLibraryAPI(router, LibraryHandlers{service: newLibraryServiceFromDeps(deps)})
}

// Commands returns the module's subcommands: saving a link, and asking for its
// text to be extracted again.
func (*LibraryModule) Commands() []*cobra.Command {
	return []*cobra.Command{newLibrarySaveCommand(), newLibraryExtractCommand()}
}

// JobHandlers returns the one kind this module owns: the background extraction
// every save enqueues.
func (*LibraryModule) JobHandlers(deps app.Deps) map[string]core.JobHandler {
	return map[string]core.JobHandler{
		LibraryExtractJobKind: newLibraryExtractionFromDeps(deps).Handle,
	}
}

// Start blocks until ctx ends, then reports a clean stop. The extraction runs
// on the core's one job worker, so this module has no loop of its own.
func (*LibraryModule) Start(ctx context.Context) error {
	<-ctx.Done()
	return nil
}

// Text owns no readable text yet: the reader bead adds the provider that
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

// newLibraryServiceFromDeps wires the service over what the registry handed the
// module.
func newLibraryServiceFromDeps(deps app.Deps) *LibraryService {
	return NewLibraryService(deps.Database, deps.Files, deps.Jobs, deps.Clock)
}

// newLibraryExtractionFromDeps wires the extraction handler, with the fetcher
// built from the configured byte cap and the real resolver and dialer.
func newLibraryExtractionFromDeps(deps app.Deps) *LibraryExtraction {
	return NewLibraryExtraction(LibraryExtractionOptions{
		Database:      deps.Database,
		Files:         deps.Files,
		Jobs:          deps.Jobs,
		Clock:         deps.Clock,
		Events:        deps.Events,
		Logger:        deps.Logger,
		Fetcher:       newLibraryFetcher(LibraryFetchOptions{MaxBytes: deps.FetchMaxBytes}),
		LLMConfigured: deps.LLMURL != "",
	})
}
