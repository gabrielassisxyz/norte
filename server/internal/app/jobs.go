package app

import (
	"fmt"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// newJobsCommand groups the durable queue's inspection and recovery. list
// reports what is on disk without migrating, so it answers even on a database
// from an older version; retry moves a failed job back to queued.
func newJobsCommand() *cobra.Command {
	jobs := &cobra.Command{
		Use:   "jobs",
		Short: "Inspect and recover background jobs",
		Args:  cobra.NoArgs,
	}
	jobs.AddCommand(newJobsListCommand(), newJobsRetryCommand())
	return jobs
}

// newJobsListCommand prints id, kind, status, attempts, available_at and
// last_error for every job, oldest first. Payloads are never printed.
func newJobsListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List background jobs",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, _, err := loadConfigForCommand(cmd)
			if err != nil {
				return err
			}
			return withDatabase(cmd.Context(), cfg.Data, func(database *core.Database) error {
				// No migration here: this command reports what is on disk.
				queue := core.NewJobs(database.Writer(), core.SystemClock(), nil)
				rows, err := queue.ListJobs(cmd.Context())
				if err != nil {
					return err
				}
				writer := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
				fmt.Fprintln(writer, "id\tkind\tstatus\tattempts\tavailable_at\tlast_error")
				for _, row := range rows {
					lastError := ""
					if row.LastError.Valid {
						lastError = row.LastError.String
					}
					fmt.Fprintf(writer, "%s\t%s\t%s\t%d\t%s\t%s\n",
						row.ID, row.Kind, row.Status, row.Attempts, row.AvailableAt, lastError)
				}
				return writer.Flush()
			})
		},
	}
}

// newJobsRetryCommand requeues a failed job with a clean attempt count. A
// queued or running row holding the same dedupe key refuses the retry, since
// the partial index would otherwise be violated; any other status is refused
// without touching either row.
func newJobsRetryCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "retry <id>",
		Short: "Requeue a failed background job",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _, err := loadConfigForCommand(cmd)
			if err != nil {
				return err
			}
			return withDatabase(cmd.Context(), cfg.Data, func(database *core.Database) error {
				queue := core.NewJobs(database.Writer(), core.SystemClock(), nil)
				if err := queue.RetryJob(cmd.Context(), args[0]); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "retried %s\n", args[0])
				return nil
			})
		},
	}
}
