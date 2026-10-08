package app_test

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	_ "github.com/gabrielassisxyz/norte/server/internal/library"
)

// envLookupFromMap builds the loader's lookup view of the environment, so a
// test can set NORTE_MODULES to an explicitly empty value without touching
// the process.
func envLookupFromMap(values map[string]string) func(string) (string, bool) {
	return func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}
}

func loadNorteConfigForModules(t *testing.T, modules *string) *app.Config {
	t.Helper()
	values := map[string]string{}
	if modules != nil {
		values["NORTE_MODULES"] = *modules
	}
	cfg, _, err := app.Load(app.LoadOptions{
		LookupEnv: envLookupFromMap(values),
		Home:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return cfg
}

func norteModulesValue(raw string) *string { return &raw }

func TestNorteModulesDefaultIsEveryCompiledModule(t *testing.T) {
	cfg, _, err := app.Load(app.LoadOptions{LookupEnv: envLookupFromMap(nil), Home: t.TempDir()})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Modules) != 1 || cfg.Modules[0] != "library" {
		t.Errorf("default Modules = %v, want [library]", cfg.Modules)
	}
}

func TestNorteModulesExplicitEmptyIsCoreOnly(t *testing.T) {
	cfg := loadNorteConfigForModules(t, norteModulesValue(""))
	if len(cfg.Modules) != 0 {
		t.Errorf("explicit empty Modules = %v, want []", cfg.Modules)
	}
	if cfg.Modules == nil {
		t.Error("explicit empty Modules is nil, want a non-nil [] so /api/config answers []")
	}
}

func TestNorteModulesUnknownNameFailsNamingIt(t *testing.T) {
	values := map[string]string{"NORTE_MODULES": "nope"}
	_, _, err := app.Load(app.LoadOptions{LookupEnv: envLookupFromMap(values), Home: t.TempDir()})
	if err == nil {
		t.Fatal("Load accepted an unknown module, want an error naming it")
	}
	if !strings.Contains(err.Error(), "nope") {
		t.Errorf("error = %q, want it to name nope", err.Error())
	}
}

func TestNorteModulesWhitespaceIsTrimmed(t *testing.T) {
	parsed, err := app.ParseNorteModuleNames("  library  ", []string{"library"})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(parsed) != 1 || parsed[0] != "library" {
		t.Errorf("parsed = %v, want [library]", parsed)
	}
}

func TestNorteModulesDuplicateKeepsFirstOccurrence(t *testing.T) {
	parsed, err := app.ParseNorteModuleNames("b,a,b", []string{"a", "b"})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(parsed) != 2 || parsed[0] != "b" || parsed[1] != "a" {
		t.Errorf("parsed = %v, want [b a] with the duplicate's first occurrence kept", parsed)
	}
}

func TestNorteModulesInternalEmptyEntryFails(t *testing.T) {
	for _, raw := range []string{"a,,b", "a, ", ",a", "a,"} {
		if _, err := app.ParseNorteModuleNames(raw, []string{"a", "b"}); err == nil {
			t.Errorf("Parse(%q) succeeded, want an empty-entry error", raw)
		}
	}
}

func TestNorteModulesOrderIsPreserved(t *testing.T) {
	parsed, err := app.ParseNorteModuleNames("b,a", []string{"a", "b"})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(parsed) != 2 || parsed[0] != "b" || parsed[1] != "a" {
		t.Errorf("parsed = %v, want [b a] in the configured order", parsed)
	}
}

func TestNorteModulesResolvePreservesConfiguredOrder(t *testing.T) {
	cfg := loadNorteConfigForModules(t, norteModulesValue("library"))
	modules, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if len(modules) != 1 || modules[0].Name() != "library" {
		t.Fatalf("resolved = %v, want one library module", modules)
	}
}

func TestNorteRouterRejectsAPatternOutsideItsPrefix(t *testing.T) {
	mux := http.NewServeMux()
	scoped := app.NewNorteModuleRouter(mux, "library")
	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatal("Handle outside the prefix did not panic")
		}
		text, ok := recovered.(string)
		if !ok {
			t.Fatalf("panic = %v (%T), want a string naming the pattern", recovered, recovered)
		}
		if !strings.Contains(text, "/api/core/x") {
			t.Errorf("panic = %q, want it to name the pattern", text)
		}
	}()
	scoped.Handle("GET /api/core/x", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
}

func TestNorteRouterAcceptsAPatternInsideItsPrefix(t *testing.T) {
	mux := http.NewServeMux()
	scoped := app.NewNorteModuleRouter(mux, "library")
	scoped.Handle("GET /api/library/x", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/library/x", nil)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", recorder.Code)
	}
}

// norteAdapterFake is a Module whose Start the adapter tests control.
type norteAdapterFake struct {
	name      string
	startErr  error
	cancelled *atomic.Bool
}

func (f *norteAdapterFake) Name() string { return f.name }

func (f *norteAdapterFake) Migrations() fs.FS { return fstest.MapFS{} }

func (f *norteAdapterFake) Register(_ *app.Router, _ app.Deps) {}

func (f *norteAdapterFake) Commands() []*cobra.Command { return nil }

func (f *norteAdapterFake) JobHandlers(app.Deps) map[string]core.JobHandler { return nil }

func (f *norteAdapterFake) Start(ctx context.Context, _ app.Deps) error {
	if f.startErr != nil {
		return f.startErr
	}
	<-ctx.Done()
	if f.cancelled != nil {
		f.cancelled.Store(true)
	}
	return nil
}

func (f *norteAdapterFake) Text(context.Context, string) (string, bool, error) {
	return "", false, nil
}

func (f *norteAdapterFake) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return nil, nil
}

func (f *norteAdapterFake) SearchEntries(context.Context, string, int) ([]core.SearchEntry, error) {
	return nil, nil
}

var errNorteAdapterBoom = errors.New("boom")

func TestNorteAdaptersCancelTheOtherOnError(t *testing.T) {
	secondCancelled := &atomic.Bool{}
	second := &norteAdapterFake{name: "second", cancelled: secondCancelled}
	first := &norteAdapterFake{name: "first", startErr: errNorteAdapterBoom}
	if err := app.RunNorteAdapters(context.Background(), []app.Module{first, second}, app.Deps{}); err == nil {
		t.Fatal("RunNorteAdapters succeeded after a Start error, want it non-nil")
	} else if !strings.Contains(err.Error(), "boom") {
		t.Fatalf("error = %q, want the first failure", err.Error())
	}
	if !secondCancelled.Load() {
		t.Error("the second adapter was not cancelled after the first failed")
	}
}

func TestNorteAdaptersStopCleanlyOnParentCancel(t *testing.T) {
	first := &norteAdapterFake{name: "first"}
	second := &norteAdapterFake{name: "second"}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.RunNorteAdapters(ctx, []app.Module{first, second}, app.Deps{}) }()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RunNorteAdapters on cancel = %v, want nil", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunNorteAdapters did not stop after the parent context ended")
	}
}
