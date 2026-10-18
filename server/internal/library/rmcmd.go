package library

import (
	"errors"

	"github.com/spf13/cobra"
)

// newLibraryRemoveCommand builds `norte rm`, the command-line half of the
// delete path: the same service the HTTP handler calls, in a process with no
// server necessarily running.
//
// Success prints nothing, the way `norte rules rm` prints nothing: there is
// nothing left to say about a row that is gone, and a confirmation sentence on
// stdout is one more thing a script has to ignore. A refusal is the sentence
// the service wrote, on a non-zero exit.
func newLibraryRemoveCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "rm <id>",
		Short: "Delete a saved link and everything written on it",
		Long: "Delete a saved link and everything written on it.\n\n" +
			"The item's tags, its registry links and the highlights, margin notes and " +
			"note written on it go with it; questions written from it are kept, with no " +
			"item. There is no undo.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			return libraryWithService(cmd.Context(), cfg, func(service *LibraryService) error {
				if err := service.Delete(cmd.Context(), args[0]); err != nil {
					var domain *LibraryError
					if errors.As(err, &domain) {
						return errors.New(domain.Message)
					}
					return err
				}
				return nil
			})
		},
	}
}
