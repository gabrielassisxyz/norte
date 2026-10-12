package library

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

// newLibraryRulesCommand builds `norte rules`, the command-line half of the
// domain rules: the same service the HTTP handlers call, in a process with no
// server necessarily running.
func newLibraryRulesCommand() *cobra.Command {
	rules := &cobra.Command{
		Use:   "rules",
		Short: "Manage the domain rules saved links are placed by",
		Args:  cobra.NoArgs,
	}
	rules.AddCommand(
		newLibraryRulesListCommand(),
		newLibraryRulesSetCommand(),
		newLibraryRulesRemoveCommand(),
		newLibraryRulesSuggestionsCommand(),
		newLibraryRulesDismissCommand(),
	)
	return rules
}

func newLibraryRulesListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List the domain rules",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			return libraryWithService(cmd.Context(), cfg, func(service *LibraryService) error {
				rules, err := service.ListDomainRules(cmd.Context())
				if err != nil {
					return libraryRulesCommandError(err)
				}
				for _, rule := range rules {
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\n", rule.Domain, rule.Location)
				}
				return nil
			})
		},
	}
}

func newLibraryRulesSetCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "set <domain> <inbox|stash>",
		Short: "Create or replace a domain rule",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			return libraryWithService(cmd.Context(), cfg, func(service *LibraryService) error {
				rule, err := service.SetDomainRule(cmd.Context(), args[0], args[1])
				if err != nil {
					return libraryRulesCommandError(err)
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\n", rule.Domain, rule.Location)
				return nil
			})
		},
	}
}

func newLibraryRulesRemoveCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "rm <domain>",
		Short: "Remove a domain rule",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			return libraryWithService(cmd.Context(), cfg, func(service *LibraryService) error {
				if err := service.DeleteDomainRule(cmd.Context(), args[0]); err != nil {
					return libraryRulesCommandError(err)
				}
				return nil
			})
		},
	}
}

func newLibraryRulesSuggestionsCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "suggestions",
		Short: "List the suggested domain rules",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			return libraryWithService(cmd.Context(), cfg, func(service *LibraryService) error {
				suggestions, err := service.ListDomainRuleSuggestions(cmd.Context())
				if err != nil {
					return libraryRulesCommandError(err)
				}
				for _, suggestion := range suggestions {
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%d\n",
						suggestion.Domain, suggestion.Location, suggestion.Moves)
				}
				return nil
			})
		},
	}
}

func newLibraryRulesDismissCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "dismiss <domain>",
		Short: "Dismiss a suggested domain rule",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := libraryCommandConfig(cmd)
			if err != nil {
				return err
			}
			if err := libraryRequireModuleEnabled(cfg.Modules); err != nil {
				return err
			}
			return libraryWithService(cmd.Context(), cfg, func(service *LibraryService) error {
				if err := service.DismissDomainRuleSuggestion(cmd.Context(), args[0]); err != nil {
					return libraryRulesCommandError(err)
				}
				return nil
			})
		},
	}
}

// libraryRulesCommandError reports a refusal as the sentence it carries, so a
// person running the command reads the reason rather than an error chain with
// a code in it.
func libraryRulesCommandError(err error) error {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return errors.New(domain.Message)
	}
	return err
}
