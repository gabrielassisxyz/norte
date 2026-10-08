package app

import (
	"log/slog"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// BuildNorteRuntime assembles everything serve runs on top of an open,
// migrated database: the job queue, the shared Deps, the modules' text
// providers and their job handlers.
//
// It is the one place this wiring is written. serve calls it, and so does the
// vertical test, so a line dropped from the startup path is a line the test
// no longer has either; a hand-copied version would keep passing while the
// real server lost a handler.
//
// Deps is built before the handlers are registered and before the routes are
// mounted, and both get the same value: an extraction a save enqueues and one
// a retry endpoint re-enqueues have to run against the same database, clock
// and event bus.
func BuildNorteRuntime(cfg *Config, database *core.Database, clock core.Clock,
	logger *slog.Logger, modules []Module) (*core.Jobs, Deps) {
	queue := core.NewJobs(database.Writer(), clock, logger)
	// The text resolver is created before Deps and filled after, because its
	// providers are the modules' own methods over the very Deps it is a field
	// of.
	texts := core.NewTexts(database.Reader(), nil)
	deps := Deps{
		Database:      database,
		Jobs:          queue,
		Files:         core.NewFiles(cfg.Data, database.Writer(), clock),
		Clock:         clock,
		Events:        core.NewEvents(),
		Texts:         texts,
		Logger:        logger,
		FetchMaxBytes: cfg.FetchMaxBytes,
		LLMURL:        cfg.LLMURL,
		LLM:           core.NewLLM(cfg.LLMURL, cfg.LLMModel, cfg.LLMKey),
		// The same providers GET /api/core/focus merges, so what a
		// classifier may propose and what the focus screen shows are one
		// list read twice rather than two lists.
		LinkCandidates: core.NewLinkCandidates(database, NorteFocusProviders(modules)),
		TelegramToken:  cfg.TelegramToken,
		TelegramChat:   cfg.TelegramChat,
		PublicURL:      cfg.PublicURL,
		Focus: core.NewFocusAPI(core.NewSubjects(database, clock),
			NorteFocusProviders(modules)),
	}
	texts.SetProviders(NorteTextProviders(modules, deps))
	RegisterNorteJobHandlers(queue, modules, deps)
	return queue, deps
}
