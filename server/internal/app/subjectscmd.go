package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// newSubjectsCommand builds `norte subjects`, the command-line half of the
// vocabulary: the same service the HTTP handlers call, in a process with no
// server necessarily running.
//
// It lives beside the other root commands rather than in the core, because the
// core cannot reach the configuration loader -- app imports core, and the
// reverse would be a cycle. What belongs to the core is the service this wires.
func newSubjectsCommand() *cobra.Command {
	subjects := &cobra.Command{
		Use:   "subjects",
		Short: "Manage the subjects saved items are grouped by",
		Args:  cobra.NoArgs,
	}
	subjects.AddCommand(newSubjectsAddCommand(), newSubjectsListCommand(), newSubjectsFocusCommand())
	return subjects
}

func newSubjectsAddCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "add <name>",
		Short: "Create a subject",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return withSubjects(cmd, func(service *core.Subjects) error {
				record, err := service.Create(cmd.Context(), args[0], false)
				if err != nil {
					return subjectsCommandError(err)
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\n", record.Row.ID, record.Row.Slug)
				return nil
			})
		},
	}
}

func newSubjectsListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List the subjects, with what each one has linked to it",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			query, _ := cmd.Flags().GetString("query")
			return withSubjects(cmd, func(service *core.Subjects) error {
				// Every page, not the first one: a person asking a one-user
				// database for its vocabulary wants the vocabulary, and a
				// truncated answer with no hint of the cut is worse than a
				// long one.
				cursor := ""
				for {
					page, err := service.List(cmd.Context(), core.SubjectListInput{Query: query, Cursor: cursor})
					if err != nil {
						return subjectsCommandError(err)
					}
					for _, record := range page.Items {
						focus := " "
						if core.SubjectFocus(record.Row) {
							focus = "*"
						}
						fmt.Fprintf(cmd.OutOrStdout(), "%s %s\t%s\t%d\n",
							focus, record.Row.Slug, record.Row.Name, record.Total)
					}
					if page.NextCursor == "" {
						return nil
					}
					cursor = page.NextCursor
				}
			})
		},
	}
	cmd.Flags().String("query", "", "keep only the subjects matching this name or alias")
	return cmd
}

func newSubjectsFocusCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "focus <name>",
		Short: "Mark a subject as a current focus, or clear the mark",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			off, _ := cmd.Flags().GetBool("off")
			return withSubjects(cmd, func(service *core.Subjects) error {
				// The argument is a name as a person writes it, so it is
				// slugified the same way creating one is: `norte subjects
				// focus "Escrita"` and `... focus escrita` are one command.
				record, err := service.GetBySlug(cmd.Context(), core.Slugify(args[0]))
				if err != nil {
					return subjectsCommandError(err)
				}
				focus := !off
				updated, err := service.Patch(cmd.Context(), record.Row.ID, nil, &focus)
				if err != nil {
					return subjectsCommandError(err)
				}
				state := "focus"
				if !core.SubjectFocus(updated.Row) {
					state = "not focus"
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\n", updated.Row.Slug, state)
				return nil
			})
		},
	}
	cmd.Flags().Bool("off", false, "clear the focus mark instead of setting it")
	return cmd
}

// withSubjects opens the database, brings the core schema up to date the way
// serve does, and hands fn the service.
//
// Each command wires its own rather than reaching for the server's: these run
// in a process of their own, with no server necessarily running at all.
func withSubjects(cmd *cobra.Command, fn func(*core.Subjects) error) error {
	cfg, _, err := loadConfigForCommand(cmd)
	if err != nil {
		return err
	}
	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	return withDatabase(ctx, cfg.Data, func(database *core.Database) error {
		// Without this, running on a data directory that has never been
		// migrated fails with "no such table: core_subjects", which says
		// nothing about what to do next.
		if _, err := core.MigrateCore(ctx, database.Writer()); err != nil {
			return err
		}
		return fn(core.NewSubjects(database, core.SystemClock()))
	})
}

// subjectsCommandError reports a refusal as the sentence it carries, so a
// person running the command reads "the slug ... is already taken" rather than
// an error chain with a code in it.
func subjectsCommandError(err error) error {
	var domain *core.APIError
	if errors.As(err, &domain) {
		return errors.New(strings.TrimSpace(domain.Message))
	}
	return err
}
