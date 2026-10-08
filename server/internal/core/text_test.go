package core_test

import (
	"context"
	"errors"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// textProviderStub stands in for a module: it answers for the ids it was given
// and reports "not mine" for anything else.
type textProviderStub struct {
	texts map[string]string
	err   error
	calls int
}

func (s *textProviderStub) Text(_ context.Context, id string) (string, bool, error) {
	s.calls++
	if s.err != nil {
		return "", false, s.err
	}
	text, ok := s.texts[id]
	return text, ok, nil
}

// TestTheTextOfAnItemComesFromTheModuleThatOwnsIt is the whole point of the
// resolver: the asker knows an id and nothing else, and the registry says which
// module to ask.
func TestTheTextOfAnItemComesFromTheModuleThatOwnsIt(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := registerTestItem(t, database, "um-artigo")
	provider := &textProviderStub{texts: map[string]string{id: "o texto extraído"}}
	texts := core.NewTexts(database.Reader(), map[string]core.TextProvider{"library": provider})

	text, err := texts.Text(context.Background(), id)
	if err != nil {
		t.Fatalf("Text: %v", err)
	}
	if text != "o texto extraído" {
		t.Fatalf("the text came back as %q", text)
	}
	if provider.calls != 1 {
		t.Fatalf("the owning module was asked %d times, want once", provider.calls)
	}
}

// TestTheTextOfAnItemWhoseModuleIsDisabled is why ErrNoText exists at all. The
// registry row survives a module being switched off, and the caller must be
// able to tell that it has nothing to read without concluding that the item is
// gone.
func TestTheTextOfAnItemWhoseModuleIsDisabled(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := registerTestItem(t, database, "um-artigo")
	// Nobody is registered for "library": that is what a disabled module is.
	texts := core.NewTexts(database.Reader(), map[string]core.TextProvider{})

	if _, err := texts.Text(context.Background(), id); !errors.Is(err, core.ErrNoText) {
		t.Fatalf("the error was %v, want ErrNoText", err)
	}
}

// TestTheTextOfAnItemTheModuleHasNoneFor folds the two remaining ways there is
// nothing to read into the same answer, because a caller does the same thing
// with all of them: keep what it has and do not re-anchor.
func TestTheTextOfAnItemTheModuleHasNoneFor(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := registerTestItem(t, database, "um-artigo")

	for _, testCase := range []struct {
		name     string
		provider core.TextProvider
		id       string
	}{
		{
			name:     "the module owns the item but has no text for it yet",
			provider: &textProviderStub{texts: map[string]string{}},
			id:       id,
		},
		{
			name:     "the module has text but under a different id",
			provider: &textProviderStub{texts: map[string]string{"outro": "texto"}},
			id:       id,
		},
		{
			name:     "the id is in no registry at all",
			provider: &textProviderStub{texts: map[string]string{id: "texto"}},
			id:       "nao-registrado",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			texts := core.NewTexts(database.Reader(),
				map[string]core.TextProvider{"library": testCase.provider})
			if _, err := texts.Text(context.Background(), testCase.id); !errors.Is(err, core.ErrNoText) {
				t.Fatalf("the error was %v, want ErrNoText", err)
			}
		})
	}
}

// TestAModuleFailingToReadItsOwnTextIsNotErrNoText keeps a real failure from
// being read as an absence: a database error while reading an article must not
// orphan every highlight on it.
func TestAModuleFailingToReadItsOwnTextIsNotErrNoText(t *testing.T) {
	database := newMigratedCoreDatabase(t)
	id := registerTestItem(t, database, "um-artigo")
	broken := errors.New("o banco recusou a leitura")
	texts := core.NewTexts(database.Reader(),
		map[string]core.TextProvider{"library": &textProviderStub{err: broken}})

	_, err := texts.Text(context.Background(), id)
	if errors.Is(err, core.ErrNoText) {
		t.Fatalf("a read failure came back as ErrNoText")
	}
	if !errors.Is(err, broken) {
		t.Fatalf("the module's own error was lost: %v", err)
	}
}
