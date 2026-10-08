package notes

import (
	"context"
	"io/fs"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/notes/migrations"
)

func init() {
	app.RegisterNorteModule(ModuleName, NewNotesModule)
}

// ModuleName is the name NORTE_MODULES spells this module with.
const ModuleName = "notes"

// NotesQuestionSetItemType is the registry type a question set is recorded
// under, so a subject can be linked to one evening's curiosity about a topic.
const NotesQuestionSetItemType = "question_set"

// NotesModule implements app.Module: the notes tables, routes and the
// re-anchoring job.
type NotesModule struct{}

// NewNotesModule instantiates the module. It is the factory main's blank
// import registers.
func NewNotesModule() app.Module { return &NotesModule{} }

// Name reports "notes".
func (*NotesModule) Name() string { return ModuleName }

// Migrations returns the embedded migrations.
func (*NotesModule) Migrations() fs.FS { return migrations.FS }

// Register mounts the notes routes under /api/notes/.
func (*NotesModule) Register(router *app.Router, deps app.Deps) {
	mountNotesAPI(router, deps.Logger, NotesHandlers{service: newNotesServiceFromDeps(deps)})
}

// Commands returns nothing: a note is written while reading, not from a shell.
func (*NotesModule) Commands() []*cobra.Command { return nil }

// JobHandlers returns the one kind this module owns: the re-anchoring a
// re-extraction asks for. Without it registered the jobs stay queued and
// untouched, which is what an unregistered kind is for.
func (*NotesModule) JobHandlers(deps app.Deps) map[string]core.JobHandler {
	return map[string]core.JobHandler{
		NotesReanchorJobKind: newNotesReanchorFromDeps(deps).Handle,
	}
}

// Start subscribes to the extraction event and then blocks until ctx ends.
//
// The subscription is the whole reaction: the callback enqueues a job and
// returns, so what survives a crash is the queue's row rather than this
// process's memory. Nothing is replayed for a subscriber that was not
// registered, which is why an item re-extracted while notes is switched off
// keeps the passage it had -- a deliberate gap, written down in the bead.
func (*NotesModule) Start(ctx context.Context, deps app.Deps) error {
	notesSubscribeToExtractions(deps)
	<-ctx.Done()
	return nil
}

// notesSubscribeToExtractions is the subscription itself, separate from the
// blocking Start so a test can wire the reaction the way production does
// without running an adapter it then has to shut down.
func notesSubscribeToExtractions(deps app.Deps) {
	if deps.Events == nil {
		return
	}
	deps.Events.Subscribe(notesLibraryItemExtractedEvent,
		newNotesReanchorFromDeps(deps).OnItemExtracted)
}

// Text reports no readable text: the items this module owns are question sets,
// which are a topic and the questions under it rather than something to read.
func (*NotesModule) Text(context.Context, app.Deps, string) (string, bool, error) {
	return "", false, nil
}

// FocusTargets reports nothing: what the person is working on is the subjects
// module's answer, not a note's.
func (*NotesModule) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return nil, nil
}

// SearchEntries reports the person's own writing whose text matches. The
// implementation is in search.go.
func (*NotesModule) SearchEntries(ctx context.Context, deps app.Deps, q string, limit int) ([]core.SearchEntry, error) {
	return notesSearchEntries(ctx, deps.Database, q, limit)
}

// newNotesServiceFromDeps wires the service over what the registry handed the
// module.
func newNotesServiceFromDeps(deps app.Deps) *NotesService {
	return NewNotesService(deps.Database, deps.Jobs, deps.Clock, deps.Texts)
}
