package library

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// newLibrarySaveCommand builds `norte save`, the command-line half of the
// save path: the same service the HTTP handler calls, with the source owned
// by this adapter rather than by a request field.
func newLibrarySaveCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "save <url>",
		Short: "Save a link to the library",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			enabled := false
			for _, name := range cfg.Modules {
				if name == ModuleName {
					enabled = true
				}
			}
			if !enabled {
				return fmt.Errorf("the library module is not enabled (NORTE_MODULES holds %q)",
					joinLibraryModules(cfg.Modules))
			}
			htmlPath, _ := cmd.Flags().GetString("html")
			why, _ := cmd.Flags().GetString("why")
			links, _ := cmd.Flags().GetStringArray("link")
			var html []byte
			if htmlPath != "" {
				html, err = os.ReadFile(htmlPath)
				if err != nil {
					return fmt.Errorf("reading the HTML snapshot %s: %w", htmlPath, err)
				}
			}
			return libraryRunSave(cmd.Context(), cfg, SaveInput{
				URL:    args[0],
				HTML:   html,
				Why:    why,
				LinkTo: links,
				Source: LibrarySourceCLI,
			}, cmd)
		},
	}
	cmd.Flags().String("html", "", "path to an HTML snapshot captured for the page")
	cmd.Flags().String("why", "", "why this link was worth keeping")
	cmd.Flags().StringArray("link", nil, "registry id this item is about (may repeat)")
	return cmd
}

// libraryCommandConfig loads the configuration the way every command does:
// flags the user actually typed over the environment over the file. It
// mirrors the root command's loader, which lives unexported beside it,
// through the loader's own exported options.
func libraryCommandConfig(cmd *cobra.Command) (*app.Config, error) {
	typed := map[string]string{}
	cmd.Flags().Visit(func(flag *pflag.Flag) {
		if flag.Name != app.ConfigFlagName {
			typed[flag.Name] = flag.Value.String()
		}
	})
	configPath, err := cmd.Flags().GetString(app.ConfigFlagName)
	if err != nil {
		return nil, err
	}
	cfg, _, err := app.Load(app.LoadOptions{Flags: typed, ConfigPath: configPath})
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// libraryRunSave opens the database, brings the schema up to date the way
// serve does, and saves through the shared service, printing the item id.
func libraryRunSave(ctx context.Context, cfg *app.Config, in SaveInput, cmd *cobra.Command) error {
	database, err := core.OpenDatabase(ctx, cfg.Data)
	if err != nil {
		return err
	}
	defer func() {
		// Close runs detached from ctx: on SIGTERM ctx is already cancelled,
		// and a checkpoint on a cancelled context does nothing at all.
		_ = database.Close(context.WithoutCancel(ctx))
	}()
	modules, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		return err
	}
	if _, err := core.MigrateCore(ctx, database.Writer()); err != nil {
		return err
	}
	if _, err := app.MigrateNorteModules(ctx, database.Writer(), modules); err != nil {
		return err
	}
	clock := core.SystemClock()
	service := NewLibraryService(database, core.NewFiles(cfg.Data, database.Writer(), clock),
		core.NewJobs(database.Writer(), clock, nil), clock)
	outcome, err := service.Save(ctx, in)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return errors.New(domain.Message)
		}
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), outcome.ID)
	return nil
}

func joinLibraryModules(names []string) string {
	out := ""
	for i, name := range names {
		if i > 0 {
			out += ","
		}
		out += name
	}
	return out
}
