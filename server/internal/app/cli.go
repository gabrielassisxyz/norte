package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/webassets"
)

// Version is the version `norte version` prints. A release build overrides it
// with -ldflags "-X .../internal/app.Version=<v>".
var Version = "dev"

// ConfigFlagName is the flag that points the loader at a config file.
const ConfigFlagName = "config"

// testRoutesEnvVar turns on the slow route the shutdown test needs. It is an
// environment variable rather than a flag so it cannot be mistaken for part of
// the configuration surface.
const testRoutesEnvVar = "NORTE_TEST_ROUTES"

// flagUsage is the help text per setting, kept here so the settings table stays
// about resolution and this stays about the command line.
var flagUsage = map[string]string{
	"data":            "directory holding the database and the file store",
	"modules":         "comma-separated feature modules to enable",
	"listen":          "address to listen on",
	"public_url":      "URL this server is reachable at, when it is not the listen address",
	"timezone":        "IANA timezone used for dates and schedules",
	"llm_url":         "base URL of the LLM API",
	"llm_model":       "LLM model name",
	"telegram_chat":   "Telegram chat id notifications go to",
	"fetch_max_bytes": "largest response the fetcher will download",
	"body_max_bytes":  "largest request body the server accepts",
	"log_level":       "debug, info, warn or error",
}

// NewRootCommand builds the whole command line.
func NewRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:           "norte",
		Short:         "Norte serves its own frontend and API from one binary",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().String(ConfigFlagName, "", "path to the TOML config file")
	for _, s := range flagSettings() {
		root.PersistentFlags().String(s.flag, "", fmt.Sprintf("%s (env %s)", flagUsage[s.name], s.env))
	}
	root.AddCommand(newServeCommand(), newMigrateCommand(), newVersionCommand(), newConfigCommand(), newFilesCommand(), newJobsCommand())
	for _, module := range norteEnabledModulesForCLI() {
		for _, cmd := range module.Commands() {
			root.AddCommand(cmd)
		}
	}
	return root
}

// norteEnabledModulesForCLI resolves the modules the current process
// environment (and config file) enables, for command wiring only. An unknown
// name yields no commands here; serve and migrate report it when they load
// the same configuration for real.
func norteEnabledModulesForCLI() []Module {
	cfg, _, err := Load(LoadOptions{})
	if err != nil {
		return nil
	}
	modules, err := ResolveNorteModules(cfg.Modules)
	if err != nil {
		return nil
	}
	return modules
}

// loadConfigForCommand turns the flags the user actually typed into the loader's
// highest-precedence layer. Flags the user left alone are not passed, so an
// unset flag never shadows the environment or the file.
func loadConfigForCommand(cmd *cobra.Command) (*Config, []string, error) {
	typed := map[string]string{}
	cmd.Flags().Visit(func(flag *pflag.Flag) {
		if flag.Name != ConfigFlagName {
			typed[flag.Name] = flag.Value.String()
		}
	})
	configPath, err := cmd.Flags().GetString(ConfigFlagName)
	if err != nil {
		return nil, nil, err
	}
	return Load(LoadOptions{Flags: typed, ConfigPath: configPath})
}

func newServeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Serve the frontend and the API",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, warnings, err := loadConfigForCommand(cmd)
			if err != nil {
				return err
			}
			logger, err := core.NewLogger(cfg.LogLevel, cmd.ErrOrStderr())
			if err != nil {
				return err
			}
			for _, warning := range warnings {
				logger.Warn(warning)
			}
			testRoutes := os.Getenv(testRoutesEnvVar) == "1"
			if testRoutes {
				logger.Warn("test-only routes are enabled", "env", testRoutesEnvVar)
			}

			ctx, stop := signal.NotifyContext(cmd.Context(), syscall.SIGTERM, syscall.SIGINT)
			defer stop()
			modules, err := ResolveNorteModules(cfg.Modules)
			if err != nil {
				return err
			}
			// Migrations run before the listener opens, so no request is ever
			// served against a schema that is one version behind the code.
			// Core migrates first, then each module in the configured order.
			return withDatabase(ctx, cfg.Data, func(database *core.Database) error {
				appliedCore, err := core.MigrateCore(ctx, database.Writer())
				if err != nil {
					return err
				}
				appliedModules, err := MigrateNorteModules(ctx, database.Writer(), modules)
				if err != nil {
					return err
				}
				logger.Info("database ready", "path", database.Path(),
					"core_applied", appliedCore, "modules_applied", appliedModules)
				// The one in-process worker. A second process would be a second
				// deployable for a one-user app, and heavy runtimes are created
				// inside the handler and closed when it returns.
				queue := core.NewJobs(database.Writer(), core.SystemClock(), logger)
				RegisterNorteJobHandlers(queue, modules)
				worker := core.NewJobsWorker(queue, core.SystemClock(), logger, core.NewID())
				clock := core.SystemClock()
				deps := Deps{
					Database: database,
					Jobs:     queue,
					Files:    core.NewFiles(cfg.Data, database.Writer(), clock),
					Clock:    clock,
				}
				serveCtx, cancel := context.WithCancel(ctx)
				defer cancel()
				adaptersDone := make(chan error, 1)
				go func() {
					err := RunNorteAdapters(serveCtx, modules)
					if err != nil {
						cancel()
					}
					adaptersDone <- err
				}()
				workerCtx, workerStop := context.WithCancel(serveCtx)
				defer workerStop()
				workerDone := make(chan error, 1)
				go func() { workerDone <- worker.Run(workerCtx) }()
				serveErr := Serve(serveCtx, RouterOptions{
					Config:     cfg,
					Logger:     logger,
					Assets:     webassets.FS(),
					Modules:    modules,
					ModuleDeps: deps,
					TestRoutes: testRoutes,
				})
				// Serve can return without the context being cancelled (the
				// listener failed to bind, the router failed to build), and the
				// adapters and the worker only stop on cancellation, so cancel
				// before waiting or a failed start hangs instead of exiting.
				cancel()
				workerStop()
				workerErr := <-workerDone
				adaptersErr := <-adaptersDone
				return errors.Join(serveErr, workerErr, adaptersErr)
			})
		},
	}
}

// newMigrateCommand creates the data directory and brings the schema up to
// date. It is separate from `serve` so that an upgrade can be applied, and seen
// to succeed, before anything starts answering requests.
func newMigrateCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "migrate",
		Short: "Apply pending database migrations",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, _, err := loadConfigForCommand(cmd)
			if err != nil {
				return err
			}
			modules, err := ResolveNorteModules(cfg.Modules)
			if err != nil {
				return err
			}
			return withDatabase(cmd.Context(), cfg.Data, func(database *core.Database) error {
				appliedCore, err := core.MigrateCore(cmd.Context(), database.Writer())
				if err != nil {
					return err
				}
				appliedModules, err := MigrateNorteModules(cmd.Context(), database.Writer(), modules)
				if err != nil {
					return err
				}
				appliedTotal := appliedCore
				for _, count := range appliedModules {
					appliedTotal += count
				}
				if appliedTotal == 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "%s is up to date\n", database.Path())
					return nil
				}
				fmt.Fprintf(cmd.OutOrStdout(), "applied %d core migration(s) to %s\n", appliedCore, database.Path())
				names := make([]string, 0, len(appliedModules))
				for _, module := range modules {
					names = append(names, module.Name())
				}
				for _, name := range names {
					fmt.Fprintf(cmd.OutOrStdout(), "applied %d %s migration(s) to %s\n",
						appliedModules[name], name, database.Path())
				}
				return nil
			})
		},
	}
}

// newFilesCommand groups the maintenance a file store needs. There is one
// subcommand today; it is nested rather than flat because the store will grow
// more of them and `norte gc` would not say what it collects.
func newFilesCommand() *cobra.Command {
	files := &cobra.Command{
		Use:   "files",
		Short: "Maintain the stored file blobs",
		Args:  cobra.NoArgs,
	}
	files.AddCommand(newFilesGCCommand())
	return files
}

// newFilesGCCommand deletes the blobs nothing points at. It exists as a command
// rather than as something the server does on a timer because deleting a
// person's files is not a thing to do silently in the background.
func newFilesGCCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "gc",
		Short: "Delete stored blobs nothing references",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, _, err := loadConfigForCommand(cmd)
			if err != nil {
				return err
			}
			return withDatabase(cmd.Context(), cfg.Data, func(database *core.Database) error {
				// Every command that reads the schema brings it up to date
				// first, the same way `serve` does. Without it, running this on
				// a data directory that has never been migrated fails with
				// "no such table: core_files", which says nothing about what to
				// do next.
				if _, err := core.MigrateCore(cmd.Context(), database.Writer()); err != nil {
					return err
				}
				store := core.NewFiles(cfg.Data, database.Writer(), core.SystemClock())
				collected, err := store.CollectGarbage(cmd.Context())
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "deleted %d unreferenced blob(s), freeing %d bytes\n",
					collected.Removed, collected.Bytes)
				return nil
			})
		},
	}
}

// withDatabase opens the database, runs fn, and closes through the core's
// shutdown path whatever fn did -- so the write-ahead log is folded back into
// norte.db even when the command failed, and the data directory is left as one
// file that can be copied.
//
// Close runs on a context detached from ctx: on SIGTERM ctx is already
// cancelled by the time there is anything to close, and a checkpoint on a
// cancelled context does nothing at all.
func withDatabase(ctx context.Context, dataDir string, fn func(*core.Database) error) (err error) {
	database, err := core.OpenDatabase(ctx, dataDir)
	if err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, database.Close(context.WithoutCancel(ctx)))
	}()
	return fn(database)
}

func newVersionCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version",
		Args:  cobra.NoArgs,
		// No configuration is loaded and no database is opened: a version check
		// has to work on a machine that is not set up yet.
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), Version)
			return nil
		},
	}
}

func newConfigCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "config",
		Short: "Print the effective configuration and where each value came from",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, warnings, err := loadConfigForCommand(cmd)
			if err != nil {
				return err
			}
			for _, warning := range warnings {
				fmt.Fprintf(cmd.ErrOrStderr(), "warning: %s\n", warning)
			}
			fmt.Fprint(cmd.OutOrStdout(), cfg.Report())
			return nil
		},
	}
}

// Execute runs the command line and reports the exit code to main.
func Execute(ctx context.Context) int {
	root := NewRootCommand()
	if err := root.ExecuteContext(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "norte: %v\n", err)
		return 1
	}
	return 0
}
