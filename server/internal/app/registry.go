package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/pressly/goose/v3"
	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// Module is one feature product switched on by configuration. The core stays
// always on; a module owns tables prefixed with its name, routes under
// /api/<name>/, subcommands, job kinds and providers, and nothing else.
type Module interface {
	Name() string
	Migrations() fs.FS
	Register(r *Router, deps Deps)
	Commands() []*cobra.Command
	JobHandlers(deps Deps) map[string]core.JobHandler
	Start(ctx context.Context, deps Deps) error
	// Text is the module's answer for core.Text. It takes Deps rather than
	// catching them from Register, because the core's resolver is built at
	// startup from the same dependencies a route is mounted with and the
	// interface promises no order between the two.
	Text(ctx context.Context, deps Deps, id string) (string, bool, error)
	FocusTargets(ctx context.Context) ([]core.FocusTarget, error)
	SearchEntries(ctx context.Context, q string, limit int) ([]core.SearchEntry, error)
}

// Deps is what the core offers a module at startup, so a module never reaches
// for a global.
//
// The two settings are named one by one rather than passed as the whole
// *Config, because the config carries the LLM key and the Telegram token and a
// module has no business being handed either to read a byte cap.
type Deps struct {
	Database *core.Database
	Jobs     *core.Jobs
	Files    *core.Files
	Clock    core.Clock
	// Events is the in-process bus modules publish to and subscribe on.
	Events *core.Events
	// Texts resolves an item's readable text across module lines, so a module
	// reads another module's text without reading its table.
	Texts *core.Texts
	// Logger is the server's logger, for what a background job has to report.
	Logger *slog.Logger
	// FetchMaxBytes is the largest response a module's fetcher may download.
	FetchMaxBytes int64
	// LLMURL is empty when no LLM is configured, which is how a module decides
	// not to enqueue work whose handler would have nothing to call.
	LLMURL string
	// TelegramToken is empty when no bot is configured, which is how a module
	// decides not to start an adapter that would have nothing to poll. It is a
	// secret: it belongs in a request, never in a log line.
	TelegramToken string
	// TelegramChat is the only chat an adapter accepts messages from, and
	// PublicURL is the address a phone reaches this server at. Both are
	// validated by whoever uses them, because the rule is theirs.
	TelegramChat string
	PublicURL    string
}

// Router wraps the server's *http.ServeMux with the prefix one module owns.
// Register receives one scoped to /api/<name>/, and a pattern outside it
// panics at startup with the pattern in the message.
type Router struct {
	mux               *http.ServeMux
	norteModulePrefix string
}

// NewNorteModuleRouter scopes mux to one module's prefix.
func NewNorteModuleRouter(mux *http.ServeMux, moduleName string) *Router {
	return &Router{mux: mux, norteModulePrefix: "/api/" + moduleName + "/"}
}

// Handle registers pattern when it sits under the module's prefix, and panics
// otherwise, naming the pattern so the offending Register call is findable.
func (r *Router) Handle(pattern string, handler http.Handler) {
	if path := norteRouterPatternPath(pattern); !strings.HasPrefix(path, r.norteModulePrefix) {
		panic(fmt.Sprintf("module route %q is outside its prefix %q", pattern, r.norteModulePrefix))
	}
	r.mux.Handle(pattern, handler)
}

// HandleFunc is Handle for a bare function.
func (r *Router) HandleFunc(pattern string, fn func(http.ResponseWriter, *http.Request)) {
	r.Handle(pattern, http.HandlerFunc(fn))
}

// norteRouterPatternPath extracts the path from a ServeMux pattern, which is
// either "/path" or "METHOD /path" (optionally with a host between them). The
// first "/" starts the path in every form a module registers.
func norteRouterPatternPath(pattern string) string {
	if i := strings.Index(pattern, "/"); i >= 0 {
		return pattern[i:]
	}
	return pattern
}

// norteModuleFactories maps a compiled-in name to the way main instantiates
// it. It is populated by each module package's init through
// RegisterNorteModule, which is what keeps app from importing the module and
// the module from creating a cycle back: app never names the module package,
// the module names app once, and main pulls both together with a blank import.
var norteModuleFactories = map[string]func() Module{}

// RegisterNorteModule makes name instantiable. A module package calls it from
// init; main's blank import is what runs that init in the built binary.
func RegisterNorteModule(name string, factory func() Module) {
	norteModuleFactories[name] = factory
}

// CompiledNorteModuleNames lists every module compiled into this binary, in a
// stable order. It is the default of NORTE_MODULES.
func CompiledNorteModuleNames() []string {
	names := make([]string, 0, len(norteModuleFactories))
	for name := range norteModuleFactories {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// ParseNorteModuleNames parses a raw NORTE_MODULES value against the compiled
// names. Names are trimmed, a duplicate keeps its first occurrence, and the
// configured order is the order of migrations and of /api/config's list. An
// empty value means core only. An empty entry inside a non-empty list is an
// error, as is a name the binary does not know, which the error names.
func ParseNorteModuleNames(raw string, known []string) ([]string, error) {
	if strings.TrimSpace(raw) == "" && !strings.Contains(raw, ",") {
		return []string{}, nil
	}
	knownSet := make(map[string]bool, len(known))
	for _, name := range known {
		knownSet[name] = true
	}
	seen := map[string]bool{}
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			return nil, fmt.Errorf("empty entry in module list %q: entries are comma-separated names with no blanks", raw)
		}
		if !knownSet[trimmed] {
			return nil, fmt.Errorf("unknown module %q: the binary was built with %s", trimmed, strings.Join(known, ", "))
		}
		if !seen[trimmed] {
			seen[trimmed] = true
			out = append(out, trimmed)
		}
	}
	return out, nil
}

// ResolveNorteModules instantiates the named modules in the configured order.
// An unknown name is an error naming it, so a typo stops startup instead of
// running with a product silently missing.
func ResolveNorteModules(names []string) ([]Module, error) {
	modules := make([]Module, 0, len(names))
	for _, name := range names {
		factory, ok := norteModuleFactories[name]
		if !ok {
			return nil, fmt.Errorf("unknown module %q: the binary was built with %s",
				name, strings.Join(CompiledNorteModuleNames(), ", "))
		}
		module := factory()
		if module.Name() != name {
			return nil, fmt.Errorf("module factory for %q returned a module named %q", name, module.Name())
		}
		modules = append(modules, module)
	}
	return modules, nil
}

// MigrateNorteModules applies each enabled module's pending migrations in the
// configured order, each in its own goose version table, and reports per
// module how many ran. Core migrates separately first, so the mount order is
// core-first. A disabled module is never touched: its tables stay as an
// earlier run left them, and none are created when they do not exist.
func MigrateNorteModules(ctx context.Context, writer *sql.DB, modules []Module) (map[string]int, error) {
	applied := make(map[string]int, len(modules))
	for _, module := range modules {
		count, err := migrateOneNorteModule(ctx, writer, module)
		if err != nil {
			return nil, err
		}
		applied[module.Name()] = count
	}
	return applied, nil
}

func migrateOneNorteModule(ctx context.Context, writer *sql.DB, module Module) (int, error) {
	provider, err := goose.NewProvider(goose.DialectSQLite3, writer, module.Migrations(),
		goose.WithTableName("goose_"+module.Name()),
		// The global registry is shared by every provider in the process; a
		// module's provider must not find the core's migrations in it.
		goose.WithDisableGlobalRegistry(true),
	)
	if err != nil {
		return 0, fmt.Errorf("preparing the %s migrations: %w", module.Name(), err)
	}
	ran, err := provider.Up(ctx)
	if err != nil {
		return 0, fmt.Errorf("applying the %s migrations: %w", module.Name(), err)
	}
	return len(ran), nil
}

// RegisterNorteJobHandlers makes every enabled module's job kinds runnable,
// before the worker starts. A kind from a disabled module stays queued,
// untouched, which is what lets a module be switched off without stranding.
//
// A module builds its handlers from the same Deps its routes are mounted with,
// because the two are the same product reached two ways: the extraction a save
// enqueues and the extraction a retry endpoint re-enqueues must not be able to
// disagree about which database, clock or event bus they are running against.
func RegisterNorteJobHandlers(queue *core.Jobs, modules []Module, deps Deps) {
	for _, module := range modules {
		for kind, handler := range module.JobHandlers(deps) {
			queue.Register(kind, handler)
		}
	}
}

// NorteTextProviders hands the enabled modules to the core as text providers
// keyed by module name, so core.Text can route by core_items.module.
//
// Each provider is the module's own Text closed over deps, which is how a
// stateless module answers for an item without the core knowing what a module
// needs to read it.
func NorteTextProviders(modules []Module, deps Deps) map[string]core.TextProvider {
	providers := make(map[string]core.TextProvider, len(modules))
	for _, module := range modules {
		owner := module
		providers[owner.Name()] = core.TextProviderFunc(
			func(ctx context.Context, id string) (string, bool, error) {
				return owner.Text(ctx, deps, id)
			})
	}
	return providers
}

// NorteFocusProviders exposes the enabled focus providers in the configured
// order. The endpoint merging them arrives in a later bead.
func NorteFocusProviders(modules []Module) []core.FocusProvider {
	providers := make([]core.FocusProvider, 0, len(modules))
	for _, module := range modules {
		providers = append(providers, module)
	}
	return providers
}

// NorteSearchProviders exposes the enabled search providers in the configured
// order. The endpoint merging them arrives in a later bead.
func NorteSearchProviders(modules []Module) []core.SearchProvider {
	providers := make([]core.SearchProvider, 0, len(modules))
	for _, module := range modules {
		providers = append(providers, module)
	}
	return providers
}

// RunNorteAdapters runs every enabled module's Start concurrently under one
// child context, over the same Deps its handlers and routes were built with.
//
// Start is handed those dependencies rather than catching them from an earlier
// call, because the interface promises no order between Register, JobHandlers
// and Start: an adapter that kept what Register was given would be reading a
// field another goroutine is still writing. The first error that is not a cancellation cancels the
// others and is returned, so serve exits non-zero; a parent cancellation
// (SIGTERM) stops every adapter and returns nil when they did.
func RunNorteAdapters(ctx context.Context, modules []Module, deps Deps) error {
	if len(modules) == 0 {
		<-ctx.Done()
		return nil
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, len(modules))
	for _, module := range modules {
		go func(mod Module) {
			err := mod.Start(child, deps)
			if err != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
				err = nil
			}
			done <- err
		}(module)
	}
	var firstErr error
	remaining := len(modules)
	for remaining > 0 {
		select {
		case <-ctx.Done():
			cancel()
			for remaining > 0 {
				if err := <-done; err != nil && firstErr == nil {
					firstErr = err
				}
				remaining--
			}
			return firstErr
		case err := <-done:
			remaining--
			if err != nil && firstErr == nil {
				firstErr = err
				cancel()
			}
			if remaining == 0 {
				return firstErr
			}
		}
	}
	return firstErr
}
