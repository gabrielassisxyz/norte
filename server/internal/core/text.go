package core

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// ErrNoText reports that an id has no readable text to offer: the module that
// owns it is switched off, the module has no text for it yet, or the id is in
// no registry at all.
//
// The three are one error on purpose. A caller that reads text -- the notes
// module's anchoring -- does the same thing in all three cases: it keeps the
// passage exactly as the person marked it and does not re-anchor. Telling them
// apart would invite a caller to treat "the library is off tonight" as "this
// highlight is lost".
var ErrNoText = errors.New("no readable text for this item")

// Texts answers "what does this item say?" for an id from any module, without
// the asker knowing which module owns it.
//
// It reads core_items for the owning module's name and asks that module's
// TextProvider. The providers are injected by the module registry at startup,
// because the core must never import the registry: the registry already names
// core.TextProvider, and an import the other way would close a cycle.
type Texts struct {
	reader *sql.DB
	// mu guards providers because SetProviders runs at startup while the job
	// worker and the HTTP handlers are already reading through Text.
	mu        sync.RWMutex
	providers map[string]TextProvider
}

// NewTexts returns the resolver over the enabled providers, keyed by module
// name. A module that is switched off is simply absent from the map, which is
// what makes its items answer ErrNoText.
func NewTexts(reader *sql.DB, providers map[string]TextProvider) *Texts {
	texts := &Texts{reader: reader}
	texts.SetProviders(providers)
	return texts
}

// SetProviders replaces the provider map.
//
// It exists because the providers are a module's method over the very
// dependencies this resolver is one of: startup creates the resolver, puts it
// in those dependencies, and only then can hand the modules over. A resolver
// with no providers answers ErrNoText, which is the right answer for the window
// before they arrive.
func (t *Texts) SetProviders(providers map[string]TextProvider) {
	copied := make(map[string]TextProvider, len(providers))
	for name, provider := range providers {
		if provider == nil {
			continue
		}
		copied[name] = provider
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.providers = copied
}

func (t *Texts) providerFor(module string) (TextProvider, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	provider, ok := t.providers[module]
	return provider, ok
}

// Text returns the readable text of the item id names.
//
// It answers ErrNoText when the id is in no registry, when the module that owns
// it is not enabled, and when the owning module has no text for it. Any other
// error is the owning module's own failure and comes back wrapped.
func (t *Texts) Text(ctx context.Context, id string) (string, error) {
	if t == nil || t.reader == nil {
		return "", ErrNoText
	}
	item, err := db.New(t.reader).GetCoreItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNoText
		}
		return "", fmt.Errorf("reading the registry row of %s: %w", id, err)
	}
	provider, ok := t.providerFor(item.Module)
	if !ok {
		return "", ErrNoText
	}
	text, ok, err := provider.Text(ctx, id)
	if err != nil {
		return "", fmt.Errorf("reading the text of %s from %s: %w", id, item.Module, err)
	}
	if !ok || text == "" {
		return "", ErrNoText
	}
	return text, nil
}
