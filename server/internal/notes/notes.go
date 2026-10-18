package notes

import (
	"context"
	"fmt"
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

// notesLibraryItemDeletedEvent is the event the library publishes after a
// delete commits.
//
// It is a literal rather than an import of the library's constant for the same
// reason the extraction event is: a module that imported another module's
// package would be compiled against a product that can be switched off, and
// the name of an event is the whole contract between the two. A rename on the
// publishing side is caught by TestDeletingALibraryItemTakesItsNotesWithIt,
// which deletes through the library's own HTTP route and so publishes with
// whatever name the library holds.
const notesLibraryItemDeletedEvent = "library.item_deleted"

// Start installs the module's subscriptions and then blocks until ctx ends.
//
// The extraction subscription is the whole reaction: the callback enqueues a
// job and returns, so what survives a crash is the queue's row rather than
// this process's memory. Nothing is replayed for a subscriber that was not
// registered, which is why an item re-extracted while notes is switched off
// keeps the passage it had -- a deliberate gap, written down in the bead.
//
// The delete subscription does its work inside the callback instead, because
// the item is already gone: a job would describe work against a row nothing
// can read any more, and the publisher returns the error either way.
func (*NotesModule) Start(ctx context.Context, deps app.Deps) error {
	(&NotesModule{}).Subscribe(deps)
	<-ctx.Done()
	return nil
}

// Subscribe installs this module's reactions on the bus. It is separate from
// Start because a one-shot command -- `norte rm`, which deletes a library item
// in a process with no server in it -- has no Start to run and still has to
// react to what it publishes.
func (*NotesModule) Subscribe(deps app.Deps) {
	notesSubscribeToExtractions(deps)
	notesSubscribeToDeletions(deps)
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

// notesSubscribeToDeletions takes the notes of a deleted library item with it.
//
// The reaction runs inside the callback rather than through a job: the item is
// already gone, so there is nothing a later run could read, and an error comes
// back to the publisher, which reports it rather than answering a delete that
// left the notes behind.
func notesSubscribeToDeletions(deps app.Deps) {
	if deps.Events == nil {
		return
	}
	service := newNotesServiceFromDeps(deps)
	deps.Events.Subscribe(notesLibraryItemDeletedEvent, func(ctx context.Context, event core.Event) error {
		itemID := event.Payload["item_id"]
		if itemID == "" {
			return fmt.Errorf("%s carries no item_id", event.Name)
		}
		return service.ForgetItem(ctx, itemID)
	})
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
