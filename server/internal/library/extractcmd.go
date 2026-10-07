package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/gabrielassisxyz/norte/server/internal/app"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// RequestExtractionOutcome is what a retry reports: the job that will do the
// work, and the generation it will run under.
type RequestExtractionOutcome struct {
	ItemID     string
	JobID      string
	Generation int64
}

// RequestExtraction puts an item back to pending and enqueues the extraction.
// The HTTP endpoint and `norte extract` both call it, so the two cannot drift.
//
// The generation always advances, whether or not a refresh was asked for. That
// gives the new job a dedupe key of its own -- so a retry is never absorbed by
// a queued job that would read the old snapshot instead of refetching -- and it
// makes any run still in flight recognise itself as superseded and write
// nothing. Keeping the generation would have saved a column write and cost both
// of those properties.
func (s *LibraryService) RequestExtraction(ctx context.Context, id string, refresh bool) (RequestExtractionOutcome, error) {
	tx, err := s.database.Writer().BeginTx(ctx, nil)
	if err != nil {
		return RequestExtractionOutcome{}, fmt.Errorf("beginning the retry transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	queries := db.New(tx)
	if _, err := queries.GetLibraryItemByID(ctx, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RequestExtractionOutcome{}, libraryNotFound(id)
		}
		return RequestExtractionOutcome{}, fmt.Errorf("reading the library item: %w", err)
	}
	stamp := core.FormatTime(s.clock.Now())
	if err := queries.ResetLibraryExtraction(ctx, db.ResetLibraryExtractionParams{
		UpdatedAt: stamp,
		ID:        id,
	}); err != nil {
		return RequestExtractionOutcome{}, fmt.Errorf("resetting the extraction of %s: %w", id, err)
	}
	generation, err := queries.GetLibraryExtractGeneration(ctx, id)
	if err != nil {
		return RequestExtractionOutcome{}, fmt.Errorf("reading the extract generation of %s: %w", id, err)
	}
	jobID, err := s.enqueueLibraryExtractJob(ctx, tx, id, generation, refresh)
	if err != nil {
		return RequestExtractionOutcome{}, err
	}
	if err := tx.Commit(); err != nil {
		return RequestExtractionOutcome{}, fmt.Errorf("committing the retry of %s: %w", id, err)
	}
	return RequestExtractionOutcome{ItemID: id, JobID: jobID, Generation: generation}, nil
}

// newLibraryExtractCommand builds `norte extract`, the command-line half of the
// retry: the same service the endpoint calls, against the same queue.
func newLibraryExtractCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "extract <id>",
		Short: "Extract a saved link's article text again",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			refresh, _ := cmd.Flags().GetBool("refresh")
			return libraryRunExtract(cmd.Context(), cfg, args[0], refresh, cmd)
		},
	}
	cmd.Flags().Bool("refresh", false, "download the page again instead of re-reading the stored snapshot")
	return cmd
}

// libraryRunExtract opens the database, brings the schema up to date the way
// serve does, and enqueues through the shared service. It never runs the
// extraction itself: the one worker lives in `norte serve`, and a second one
// here would lease jobs the server believes it owns.
func libraryRunExtract(ctx context.Context, cfg *app.Config, id string, refresh bool, cmd *cobra.Command) error {
	return libraryWithService(ctx, cfg, func(service *LibraryService) error {
		outcome, err := service.RequestExtraction(ctx, id, refresh)
		if err != nil {
			var domain *LibraryError
			if errors.As(err, &domain) {
				return errors.New(domain.Message)
			}
			return err
		}
		fmt.Fprintf(cmd.OutOrStdout(), "queued %s for %s (generation %d)\n",
			outcome.JobID, outcome.ItemID, outcome.Generation)
		return nil
	})
}
