// The person's domain rules and the suggestions computed from their own
// moves: listing, writing and forgetting rules, and asking which rules Norte
// would suggest next.
//
// A rule sends a host and its subdomains to one location, and the longest
// matching rule wins -- the matcher lives in router.go and is read here, not
// reimplemented. A suggestion is a domain the person keeps placing by hand:
// at least three items from it sit in one of inbox and stash with the move
// recorded as their own, nothing from it sits in the other, no rule matches
// it, and they have not dismissed it.
package library

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	libraryapi "github.com/gabrielassisxyz/norte/server/gen/api/library"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// libraryDomainRulePattern is the shape a stored domain holds: dotted labels
// of letters, digits and hyphens, with at least one dot so a bare host never
// becomes a rule.
var libraryDomainRulePattern = regexp.MustCompile(`^[a-z0-9-]+(\.[a-z0-9-]+)+$`)

// libraryDomainRuleSuggestionThreshold is how many hand moves one domain needs
// before Norte suggests making the placement certain with a rule.
const libraryDomainRuleSuggestionThreshold = 3

// libraryNormalizeDomainForWrite is the stricter spelling a write stores: the
// bare host of whatever the person typed, lowercased, with one leading www.
// off. A rule on the bare domain already covers www. through subdomain
// matching, so storing www. would only fork one answer into two rows.
//
// It accepts a bare domain as well as a URL: with a scheme the host is parsed
// out, without one the input is read as the host with an optional port, path,
// query and fragment. Anything left that is not a dotted domain is refused on
// the domain field.
func libraryNormalizeDomainForWrite(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", libraryBadRequest("invalid_request", fmt.Sprintf("invalid domain %q", raw), "domain")
	}
	lowered := strings.ToLower(trimmed)
	host := ""
	if strings.Contains(lowered, "://") {
		parsed, err := url.Parse(lowered)
		if err != nil || parsed.Hostname() == "" {
			return "", libraryBadRequest("invalid_request", fmt.Sprintf("invalid domain %q", raw), "domain")
		}
		host = parsed.Hostname()
	} else {
		rest := lowered
		if index := strings.IndexAny(rest, "/?#"); index >= 0 {
			rest = rest[:index]
		}
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			rest = rest[at+1:]
		}
		if index := strings.Index(rest, ":"); index >= 0 {
			rest = rest[:index]
		}
		host = strings.Trim(rest, ".")
		host = strings.TrimSpace(host)
	}
	host = strings.Trim(host, ".")
	if strings.HasPrefix(host, "www.") {
		host = strings.TrimPrefix(host, "www.")
	}
	if !libraryDomainRulePattern.MatchString(host) {
		return "", libraryBadRequest("invalid_request", fmt.Sprintf("invalid domain %q", raw), "domain")
	}
	return host, nil
}

// libraryDomainRuleLocationForWrite checks the one field a rule carries: only
// the two locations the router chooses between are storable, because a rule
// is read at save time and the other locations are moves the person makes
// afterwards.
func libraryDomainRuleLocationForWrite(location string) (string, error) {
	if location == libraryLocationInbox || location == libraryLocationStash {
		return location, nil
	}
	return "", libraryBadRequest("invalid_request", fmt.Sprintf("unknown location %q", location), "location")
}

// libraryDomainRuleNotFound is not found, but for a rule: the envelope is the
// item's.
func libraryDomainRuleNotFound(domain string) *LibraryError {
	return &LibraryError{Status: 404, Code: "not_found", Message: fmt.Sprintf("no domain rule for %q", domain)}
}

// ListDomainRules answers every rule, ordered by domain.
func (s *LibraryService) ListDomainRules(ctx context.Context) ([]libraryapi.DomainRule, error) {
	rows, err := db.New(s.database.Reader()).ListLibraryDomainRulesWithMeta(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing the domain rules: %w", err)
	}
	rules := make([]libraryapi.DomainRule, 0, len(rows))
	for _, row := range rows {
		rules = append(rules, libraryMapDomainRule(row.Domain, row.Location, row.CreatedAt))
	}
	return rules, nil
}

// SetDomainRule creates or replaces the rule for the normalized domain and
// answers it. Replacing keeps the original creation time and only moves the
// location: the rule is the same answer with a new destination, and existing
// items stay where they are either way because no item row is touched.
func (s *LibraryService) SetDomainRule(ctx context.Context, rawDomain, location string) (libraryapi.DomainRule, error) {
	domain, err := libraryNormalizeDomainForWrite(rawDomain)
	if err != nil {
		return libraryapi.DomainRule{}, err
	}
	checked, err := libraryDomainRuleLocationForWrite(location)
	if err != nil {
		return libraryapi.DomainRule{}, err
	}
	stamp := core.FormatTime(s.clock.Now())
	if err := db.New(s.database.Writer()).UpsertLibraryDomainRule(ctx, db.UpsertLibraryDomainRuleParams{
		Domain: domain, Location: checked, CreatedAt: stamp,
	}); err != nil {
		return libraryapi.DomainRule{}, fmt.Errorf("storing the domain rule for %s: %w", domain, err)
	}
	row, err := db.New(s.database.Reader()).GetLibraryDomainRule(ctx, domain)
	if err != nil {
		return libraryapi.DomainRule{}, fmt.Errorf("reading the stored domain rule for %s: %w", domain, err)
	}
	return libraryMapDomainRule(row.Domain, row.Location, row.CreatedAt), nil
}

// DeleteDomainRule forgets the rule for the normalized domain. A domain with
// no rule answers 404, and no item is moved either way.
func (s *LibraryService) DeleteDomainRule(ctx context.Context, rawDomain string) error {
	domain, err := libraryNormalizeDomainForWrite(rawDomain)
	if err != nil {
		return err
	}
	affected, err := db.New(s.database.Writer()).DeleteLibraryDomainRule(ctx, domain)
	if err != nil {
		return fmt.Errorf("deleting the domain rule for %s: %w", domain, err)
	}
	if affected == 0 {
		return libraryDomainRuleNotFound(domain)
	}
	return nil
}

// ListDomainRuleSuggestions answers the rules Norte would suggest from the
// links the person keeps moving by hand, most moves first and then domain.
func (s *LibraryService) ListDomainRuleSuggestions(ctx context.Context) ([]libraryapi.DomainRuleSuggestion, error) {
	reader := db.New(s.database.Reader())
	rules, err := reader.ListLibraryDomainRules(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the domain rules: %w", err)
	}
	dismissedRows, err := reader.ListLibraryDomainRuleDismissals(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the dismissed suggestions: %w", err)
	}
	dismissed := make(map[string]bool, len(dismissedRows))
	for _, domain := range dismissedRows {
		dismissed[domain] = true
	}
	moved, err := reader.ListLibraryUserMovedItems(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the hand-moved items: %w", err)
	}
	counts := map[string]map[string]int{}
	for _, row := range moved {
		domain := librarySuggestionDomainForLibraryItem(row.CanonicalUrl, row.Url)
		if domain == "" {
			continue
		}
		perLocation, ok := counts[domain]
		if !ok {
			perLocation = map[string]int{}
			counts[domain] = perLocation
		}
		perLocation[row.Location]++
	}
	suggestions := []libraryapi.DomainRuleSuggestion{}
	for domain, perLocation := range counts {
		inbox := perLocation[libraryLocationInbox]
		stash := perLocation[libraryLocationStash]
		location, moves := "", 0
		switch {
		case inbox >= libraryDomainRuleSuggestionThreshold && stash == 0:
			location, moves = libraryLocationInbox, inbox
		case stash >= libraryDomainRuleSuggestionThreshold && inbox == 0:
			location, moves = libraryLocationStash, stash
		default:
			continue
		}
		if dismissed[domain] {
			continue
		}
		if _, matched := libraryMatchDomainRule(rules, domain); matched {
			continue
		}
		suggestions = append(suggestions, libraryapi.DomainRuleSuggestion{
			Domain:   domain,
			Location: libraryapi.DomainRuleLocation(location),
			Moves:    moves,
		})
	}
	sort.Slice(suggestions, func(i, j int) bool {
		if suggestions[i].Moves != suggestions[j].Moves {
			return suggestions[i].Moves > suggestions[j].Moves
		}
		return suggestions[i].Domain < suggestions[j].Domain
	})
	return suggestions, nil
}

// DismissDomainRuleSuggestion records that the person said no to a
// suggestion, so the domain is never suggested again. Dismissing what was
// never suggested still records it, and setting a rule afterwards still works
// because the two tables are read independently.
func (s *LibraryService) DismissDomainRuleSuggestion(ctx context.Context, rawDomain string) error {
	domain, err := libraryNormalizeDomainForWrite(rawDomain)
	if err != nil {
		return err
	}
	stamp := core.FormatTime(s.clock.Now())
	if err := db.New(s.database.Writer()).UpsertLibraryDomainRuleDismissal(ctx, db.UpsertLibraryDomainRuleDismissalParams{
		Domain: domain, DismissedAt: stamp,
	}); err != nil {
		return fmt.Errorf("dismissing the suggestion for %s: %w", domain, err)
	}
	return nil
}

// librarySuggestionDomainForLibraryItem is the domain one hand-moved item
// counts towards: the strict spelling of its address, or nothing when neither
// spelling can become a rule. The canonical URL is read first because it is
// the address the dedupe agreed on.
func librarySuggestionDomainForLibraryItem(canonicalURL, rawURL string) string {
	for _, raw := range []string{canonicalURL, rawURL} {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		if domain, err := libraryNormalizeDomainForWrite(raw); err == nil {
			return domain
		}
	}
	return ""
}

// libraryMapDomainRule renders one stored rule for the list and set answers.
func libraryMapDomainRule(domain, location, createdAt string) libraryapi.DomainRule {
	return libraryapi.DomainRule{
		Domain:    domain,
		Location:  libraryapi.DomainRuleLocation(location),
		CreatedAt: createdAt,
	}
}

// ListLibraryDomainRules answers every rule, ordered by domain.
func (h LibraryHandlers) ListLibraryDomainRules(ctx context.Context, _ libraryapi.ListLibraryDomainRulesRequestObject) (libraryapi.ListLibraryDomainRulesResponseObject, error) {
	rules, err := h.service.ListDomainRules(ctx)
	if err != nil {
		return libraryDomainRulesListError(err, ctx)
	}
	return libraryapi.ListLibraryDomainRules200JSONResponse(libraryapi.DomainRuleList{Rules: rules}), nil
}

// SetLibraryDomainRule answers the rule the call stored, created or replaced.
func (h LibraryHandlers) SetLibraryDomainRule(ctx context.Context, request libraryapi.SetLibraryDomainRuleRequestObject) (libraryapi.SetLibraryDomainRuleResponseObject, error) {
	if request.Body == nil {
		return librarySetDomainRuleDefault(http.StatusBadRequest, "invalid_request", "the rule carries no body", "body", ctx), nil
	}
	rule, err := h.service.SetDomainRule(ctx, request.Domain, request.Body.Location)
	if err != nil {
		return librarySetDomainRuleError(err, ctx)
	}
	return libraryapi.SetLibraryDomainRule200JSONResponse(rule), nil
}

// DeleteLibraryDomainRule forgets one rule, or answers 404 when none exists
// for the normalized domain.
func (h LibraryHandlers) DeleteLibraryDomainRule(ctx context.Context, request libraryapi.DeleteLibraryDomainRuleRequestObject) (libraryapi.DeleteLibraryDomainRuleResponseObject, error) {
	if err := h.service.DeleteDomainRule(ctx, request.Domain); err != nil {
		return libraryDeleteDomainRuleError(err, ctx)
	}
	return libraryapi.DeleteLibraryDomainRule204Response{}, nil
}

// ListLibraryDomainRuleSuggestions answers the rules Norte would suggest.
func (h LibraryHandlers) ListLibraryDomainRuleSuggestions(ctx context.Context, _ libraryapi.ListLibraryDomainRuleSuggestionsRequestObject) (libraryapi.ListLibraryDomainRuleSuggestionsResponseObject, error) {
	suggestions, err := h.service.ListDomainRuleSuggestions(ctx)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.ListLibraryDomainRuleSuggestionsdefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return libraryapi.ListLibraryDomainRuleSuggestions200JSONResponse(
		libraryapi.DomainRuleSuggestionList{Suggestions: suggestions}), nil
}

// DismissLibraryDomainRuleSuggestion records one dismissal.
func (h LibraryHandlers) DismissLibraryDomainRuleSuggestion(ctx context.Context, request libraryapi.DismissLibraryDomainRuleSuggestionRequestObject) (libraryapi.DismissLibraryDomainRuleSuggestionResponseObject, error) {
	if err := h.service.DismissDomainRuleSuggestion(ctx, request.Domain); err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.DismissLibraryDomainRuleSuggestiondefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return libraryapi.DismissLibraryDomainRuleSuggestion204Response{}, nil
}

// libraryLibraryErrorToDomainRuleResponse maps a domain failure onto the
// response type the operation owns. One helper per operation, the way the tag
// endpoints do it, because each generated default type belongs to its own
// operation.
func libraryDomainRulesListError(err error, ctx context.Context) (libraryapi.ListLibraryDomainRulesResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryapi.ListLibraryDomainRulesdefaultJSONResponse{
			Body:       libraryErrorBody(domain, ctx),
			StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}

func librarySetDomainRuleDefault(status int, code, message, field string, ctx context.Context) libraryapi.SetLibraryDomainRuledefaultJSONResponse {
	return libraryapi.SetLibraryDomainRuledefaultJSONResponse{
		Body:       libraryErrorBody(&LibraryError{Status: status, Code: code, Message: message, Field: field}, ctx),
		StatusCode: status,
	}
}

func librarySetDomainRuleError(err error, ctx context.Context) (libraryapi.SetLibraryDomainRuleResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return librarySetDomainRuleDefault(domain.Status, domain.Code, domain.Message, domain.Field, ctx), nil
	}
	return nil, err
}

func libraryDeleteDomainRuleError(err error, ctx context.Context) (libraryapi.DeleteLibraryDomainRuleResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryapi.DeleteLibraryDomainRuledefaultJSONResponse{
			Body:       libraryErrorBody(domain, ctx),
			StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}
