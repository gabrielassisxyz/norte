package app

import (
	"context"
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
	root.AddCommand(newServeCommand(), newMigrateCommand(), newVersionCommand(), newConfigCommand())
	return root
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
			return Serve(ctx, RouterOptions{
				Config:     cfg,
				Logger:     logger,
				Assets:     webassets.FS(),
				TestRoutes: testRoutes,
			})
		},
	}
}

// newMigrateCommand exists so the deployment story is complete before the
// database does. It applies nothing until the database bead lands.
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
			fmt.Fprintf(cmd.OutOrStdout(), "no migrations yet; the data directory is %s\n", cfg.Data)
			return nil
		},
	}
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
