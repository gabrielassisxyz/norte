// Package library is the library module: saved links with canonical-URL
// dedupe, views, counts, full-text search and background article extraction.
package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
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
	mountLibraryAPI(router, deps.Logger, LibraryHandlers{service: newLibraryServiceFromDeps(deps)})
}

// Commands returns the module's subcommands: saving a link, and asking for its
// text to be extracted again.
func (*LibraryModule) Commands() []*cobra.Command {
	return []*cobra.Command{newLibrarySaveCommand(), newLibraryExtractCommand()}
}

// JobHandlers returns the kinds this module owns: the background extraction
// every save enqueues, the classification that follows it, and -- while a
// Telegram bot is configured -- the reply a terminal extraction asks for.
//
// The classify handler is registered whether or not an LLM is configured. It
// is the handler, not the registry, that knows what an absent endpoint means:
// a job queued while one was configured can be claimed after it is gone, and
// leaving that job unhandled would park it in the queue for ever instead of
// failing it with a reason.
//
// A configuration error is swallowed here and reported by Start, which is the
// one of the two that can fail the process. With no handler registered the
// notify_telegram jobs stay queued and untouched, which is what an
// unregistered kind is for; without Start's error, a bad chat id would leave
// the server running and answering nothing.
func (*LibraryModule) JobHandlers(deps app.Deps) map[string]core.JobHandler {
	handlers := map[string]core.JobHandler{
		LibraryExtractJobKind:  newLibraryExtractionFromDeps(deps).Handle,
		LibraryClassifyJobKind: newLibraryClassifyFromDeps(deps).Handle,
	}
	if notifier, err := newLibraryTelegramNotifier(deps); err == nil && notifier != nil {
		handlers[LibraryNotifyTelegramJobKind] = notifier.Handle
	}
	return handlers
}

// Start runs the Telegram poller while a token is set, and otherwise blocks
// until ctx ends. The extraction and the reply run on the core's one job
// worker; the poller is the only loop this module owns, because long polling
// is not work a queue can hold.
func (*LibraryModule) Start(ctx context.Context, deps app.Deps) error {
	adapter, err := newLibraryTelegramAdapter(deps)
	if err != nil {
		return err
	}
	if adapter == nil {
		<-ctx.Done()
		return nil
	}
	return adapter.Run(ctx)
}

// Text is the extracted article text of a saved link, which is what notes
// anchors its highlights against.
//
// Only a finished extraction answers: a pending one has no text yet and a
// failed one never will, and in both cases the second result is false so the
// core reports ErrNoText rather than anchoring a passage against an empty
// article.
func (*LibraryModule) Text(ctx context.Context, deps app.Deps, id string) (string, bool, error) {
	item, err := db.New(deps.Database.Reader()).GetLibraryItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("reading the library item %s: %w", id, err)
	}
	if item.ExtractStatus != "done" || !item.ContentText.Valid {
		return "", false, nil
	}
	return item.ContentText.String, true, nil
}

// FocusTargets reports nothing. "In progress" is each module's own idea, and
// the library has none: a saved link is not something being worked through,
// which is what the curriculum and the project are for.
func (*LibraryModule) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return nil, nil
}

// SearchEntries reports the saved items whose text matches, ranked by the
// module's own full-text index. The implementation is in search.go.
func (*LibraryModule) SearchEntries(ctx context.Context, deps app.Deps, q string, limit int) ([]core.SearchEntry, error) {
	return librarySearchEntries(ctx, deps.Database, q, limit)
}

// newLibraryServiceFromDeps wires the service over what the registry handed the
// module.
func newLibraryServiceFromDeps(deps app.Deps) *LibraryService {
	service := NewLibraryService(deps.Database, deps.Files, deps.Jobs, deps.Clock)
	// Checked rather than passed through: a nil *core.FocusAPI stored in an
	// interface field is not a nil interface, so the service would believe it
	// has a focus and call through it.
	if deps.Focus != nil {
		service = service.WithFocus(deps.Focus)
	}
	return service
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
		LLMConfigured: deps.LLM.Configured(),
	})
}

// newLibraryClassifyFromDeps wires the classify handler over the LLM client
// and the candidate set the registry injected.
func newLibraryClassifyFromDeps(deps app.Deps) *LibraryClassify {
	return NewLibraryClassify(LibraryClassifyOptions{
		Database:   deps.Database,
		Clock:      deps.Clock,
		Logger:     deps.Logger,
		LLM:        deps.LLM,
		Candidates: deps.LinkCandidates,
	})
}
