package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// librarySaveAndMove saves one URL and places it by hand, which is the
// location_source = 'user' signal suggestions are computed from.
func librarySaveAndMove(t *testing.T, service *LibraryService, rawURL, location string) string {
	t.Helper()
	outcome := librarySaveOne(t, service, rawURL, "")
	place := location
	if _, err := service.Patch(context.Background(), outcome.ID, PatchInput{Location: &place}); err != nil {
		t.Fatalf("placing %s in %s: %v", rawURL, location, err)
	}
	return outcome.ID
}

// libraryErrorField reads the field the error envelope attributes the failure
// to, or "" when the answer is not the envelope.
func libraryErrorField(t *testing.T, responseCode int, body []byte) string {
	t.Helper()
	var decoded struct {
		Error struct {
			Field *string `json:"field"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("the %d answer is not JSON: %v (%q)", responseCode, err, string(body))
	}
	if decoded.Error.Field == nil {
		return ""
	}
	return *decoded.Error.Field
}

// TestLibraryDomainNormalizationStoresTheBareHost is the first criterion as a
// table: whatever spelling the person typed, the stored domain is the bare
// host, and anything that is not a dotted domain is refused on the domain
// field.
func TestLibraryDomainNormalizationStoresTheBareHost(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	ctx := context.Background()

	for _, tc := range []struct {
		name string
		raw  string
		want string
	}{
		{"a bare domain", "github.com", "github.com"},
		{"a URL with scheme, path, query and fragment", "https://www.GitHub.com/x?y=1", "github.com"},
		{"a trailing root dot", "GitHub.com.", "github.com"},
		{"a port", "WWW.x.io:8080", "x.io"},
		{"surrounding whitespace and casing", "  GitHub.COM  ", "github.com"},
		{"an http URL with a port and a path", "http://example.org:8080/path?q=1#f", "example.org"},
		{"a subdomain is kept", "https://sub.example.org/", "sub.example.org"},
		{"one leading www. is removed", "www.example.org", "example.org"},
		{"a trailing dot with www.", "WWW.EXAMPLE.ORG.", "example.org"},
		{"only one www. is removed", "www.www.example.com", "www.example.com"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rule, err := service.SetDomainRule(ctx, tc.raw, "stash")
			if err != nil {
				t.Fatalf("storing %q: %v", tc.raw, err)
			}
			if rule.Domain != tc.want {
				t.Errorf("storing %q kept %q, want %q", tc.raw, rule.Domain, tc.want)
			}
			if err := service.DeleteDomainRule(ctx, tc.raw); err != nil {
				t.Fatalf("cleaning up %q: %v", tc.want, err)
			}
		})
	}

	for _, raw := range []string{"localhost", "a b.com", "", "com", "https://", "example..com"} {
		t.Run("refused "+raw, func(t *testing.T) {
			_, err := service.SetDomainRule(ctx, raw, "stash")
			var domain *LibraryError
			if !errors.As(err, &domain) {
				t.Fatalf("storing %q gave %v, want a domain error", raw, err)
			}
			if domain.Status != 400 || domain.Field != "domain" {
				t.Errorf("storing %q gave status %d on %q, want 400 on domain",
					raw, domain.Status, domain.Field)
			}
		})
	}
}

// TestLibraryDomainRulesListSetAndDelete is the handler half of the second
// criterion: list ordered by domain, put creating and replacing, delete with
// its 204 and its 404, and the two 400 cases.
func TestLibraryDomainRulesListSetAndDelete(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	listDomains := func(t *testing.T) []map[string]any {
		t.Helper()
		response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/domain-rules", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET domain-rules = %d (%q)", response.Code, response.Body.String())
		}
		var decoded struct {
			Rules []map[string]any `json:"rules"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("the list is not JSON: %v", err)
		}
		return decoded.Rules
	}

	if got := listDomains(t); len(got) != 0 {
		t.Fatalf("the list holds %d rules, want none", len(got))
	}

	setRule := func(domain, location string) map[string]any {
		t.Helper()
		response := doLibraryRequest(t, handler, http.MethodPut,
			"/api/library/domain-rules/"+domain, map[string]any{"location": location})
		if response.Code != http.StatusOK {
			t.Fatalf("PUT %s = %d (%q)", domain, response.Code, response.Body.String())
		}
		var decoded map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("the stored rule is not JSON: %v", err)
		}
		return decoded
	}

	created := setRule("github.com", "stash")
	if created["domain"] != "github.com" || created["location"] != "stash" {
		t.Errorf("the stored rule is %v, want github.com in the stash", created)
	}
	if _, ok := created["created_at"].(string); !ok {
		t.Errorf("the stored rule has no created_at (%v)", created)
	}
	firstStamp := created["created_at"].(string)

	// A second domain sorts before the first, which is the ordering the
	// contract names.
	setRule("example.org", "inbox")
	rules := listDomains(t)
	if len(rules) != 2 || rules[0]["domain"] != "example.org" || rules[1]["domain"] != "github.com" {
		t.Errorf("the list is %v, want example.org then github.com", rules)
	}

	// Replacing moves the location and keeps the creation time: the rule is
	// the same answer with a new destination.
	clock.Advance(time.Hour)
	replaced := setRule("github.com", "inbox")
	if replaced["location"] != "inbox" {
		t.Errorf("the replaced rule is %v, want the inbox", replaced)
	}
	if replaced["created_at"] != firstStamp {
		t.Errorf("the replaced rule was created at %v, want the original %v", replaced["created_at"], firstStamp)
	}

	// The normalized spelling reaches the same row: no second row is made.
	normalized := setRule("WWW.GitHub.COM", "stash")
	if normalized["domain"] != "github.com" {
		t.Errorf("the normalized set kept %v, want github.com", normalized["domain"])
	}
	if got := listDomains(t); len(got) != 2 {
		t.Errorf("the list holds %d rules after a normalized set, want 2", len(got))
	}

	deleted := doLibraryRequest(t, handler, http.MethodDelete, "/api/library/domain-rules/github.com", nil)
	if deleted.Code != http.StatusNoContent {
		t.Errorf("DELETE github.com = %d, want 204 (%q)", deleted.Code, deleted.Body.String())
	}
	if got := listDomains(t); len(got) != 1 {
		t.Errorf("the list holds %d rules after the delete, want 1", len(got))
	}

	missing := doLibraryRequest(t, handler, http.MethodDelete, "/api/library/domain-rules/github.com", nil)
	if missing.Code != http.StatusNotFound {
		t.Errorf("DELETE github.com again = %d, want 404 (%q)", missing.Code, missing.Body.String())
	}

	// The two 400 cases: a location the router cannot choose, and a domain
	// that cannot be stored.
	badLocation := doLibraryRequest(t, handler, http.MethodPut,
		"/api/library/domain-rules/example.org", map[string]any{"location": "up_next"})
	if badLocation.Code != http.StatusBadRequest {
		t.Errorf("PUT location=up_next = %d, want 400 (%q)", badLocation.Code, badLocation.Body.String())
	}
	if field := libraryErrorField(t, badLocation.Code, badLocation.Body.Bytes()); field != "location" {
		t.Errorf("the bad location is attributed to %q, want location", field)
	}

	badDomain := doLibraryRequest(t, handler, http.MethodPut,
		"/api/library/domain-rules/localhost", map[string]any{"location": "stash"})
	if badDomain.Code != http.StatusBadRequest {
		t.Errorf("PUT localhost = %d, want 400 (%q)", badDomain.Code, badDomain.Body.String())
	}
	if field := libraryErrorField(t, badDomain.Code, badDomain.Body.Bytes()); field != "domain" {
		t.Errorf("the bad domain is attributed to %q, want domain", field)
	}
}

// TestLibraryDomainRuleSuggestionsCountThresholdAndOrder is the third
// criterion's counting: three hand moves suggest, two do not, and the most
// moves sort first with the domain breaking ties.
func TestLibraryDomainRuleSuggestionsCountThresholdAndOrder(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://example.org/two-%d", i), "stash")
	}
	if suggestions, err := service.ListDomainRuleSuggestions(ctx); err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	} else if len(suggestions) != 0 {
		t.Fatalf("two moves suggest %v, want nothing", suggestions)
	}

	librarySaveAndMove(t, service, "https://example.org/two-2", "stash")
	suggestions, err := service.ListDomainRuleSuggestions(ctx)
	if err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	}
	if len(suggestions) != 1 || suggestions[0].Domain != "example.org" ||
		suggestions[0].Location != "stash" || suggestions[0].Moves != 3 {
		t.Fatalf("three moves suggest %v, want example.org to the stash with 3 moves", suggestions)
	}

	// More moves sort first, and equal moves sort by domain.
	for i := 0; i < 4; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://alpha.example/four-%d", i), "inbox")
	}
	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://beta.example/three-%d", i), "inbox")
	}
	suggestions, err = service.ListDomainRuleSuggestions(ctx)
	if err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	}
	if len(suggestions) != 3 {
		t.Fatalf("the suggestions are %v, want three domains", suggestions)
	}
	if suggestions[0].Domain != "alpha.example" || suggestions[0].Moves != 4 {
		t.Errorf("first is %v, want alpha.example with 4 moves", suggestions[0])
	}
	if suggestions[1].Domain != "beta.example" || suggestions[1].Moves != 3 {
		t.Errorf("second is %v, want beta.example with 3 moves", suggestions[1])
	}
	if suggestions[2].Domain != "example.org" || suggestions[2].Moves != 3 {
		t.Errorf("third is %v, want example.org with 3 moves", suggestions[2])
	}
}

// TestLibraryDomainRuleSuggestionsReadOnlyUserMovesInInboxAndStash: only the
// person's own moves count, and a move into the other of the two locations
// suppresses the suggestion.
func TestLibraryDomainRuleSuggestionsReadOnlyUserMovesInInboxAndStash(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	ctx := context.Background()

	// Three arrivals with no hand move are placed by nobody and suggest
	// nothing.
	for i := 0; i < 3; i++ {
		librarySaveOne(t, service, fmt.Sprintf("https://untouched.example/auto-%d", i), "")
	}
	if suggestions, err := service.ListDomainRuleSuggestions(ctx); err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	} else if len(suggestions) != 0 {
		t.Fatalf("three automatic placements suggest %v, want nothing", suggestions)
	}

	// A move into the other location suppresses the three that agree.
	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://divided.example/stash-%d", i), "stash")
	}
	librarySaveAndMove(t, service, "https://divided.example/inbox-0", "inbox")
	if suggestions, err := service.ListDomainRuleSuggestions(ctx); err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	} else if len(suggestions) != 0 {
		t.Fatalf("a divided domain suggests %v, want nothing", suggestions)
	}

	// A move anywhere else is neither counted nor suppressing: three in the
	// stash still suggest with one in later.
	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://elsewhere.example/kept-%d", i), "stash")
	}
	librarySaveAndMove(t, service, "https://elsewhere.example/later-0", "later")
	suggestions, err := service.ListDomainRuleSuggestions(ctx)
	if err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	}
	if len(suggestions) != 1 || suggestions[0].Domain != "elsewhere.example" {
		t.Fatalf("the suggestions are %v, want only elsewhere.example", suggestions)
	}
}

// TestLibraryDomainRuleSuggestionsSkipRuledAndDismissedDomains: a rule on the
// domain or on a parent of it suppresses the suggestion, and so does a
// dismissal -- while setting a rule for a dismissed domain still works.
func TestLibraryDomainRuleSuggestionsSkipRuledAndDismissedDomains(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://ruled.example/item-%d", i), "stash")
	}
	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://sub.parent.example/item-%d", i), "stash")
	}
	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://dismissed.example/item-%d", i), "inbox")
	}

	if _, err := service.SetDomainRule(ctx, "ruled.example", "stash"); err != nil {
		t.Fatalf("setting the rule: %v", err)
	}
	if _, err := service.SetDomainRule(ctx, "parent.example", "stash"); err != nil {
		t.Fatalf("setting the parent rule: %v", err)
	}
	if err := service.DismissDomainRuleSuggestion(ctx, "dismissed.example"); err != nil {
		t.Fatalf("dismissing the suggestion: %v", err)
	}

	suggestions, err := service.ListDomainRuleSuggestions(ctx)
	if err != nil {
		t.Fatalf("listing the suggestions: %v", err)
	}
	for _, suggestion := range suggestions {
		if suggestion.Domain == "ruled.example" {
			t.Errorf("a ruled domain is suggested: %v", suggestions)
		}
		if suggestion.Domain == "sub.parent.example" {
			t.Errorf("a domain under a ruled parent is suggested: %v", suggestions)
		}
		if suggestion.Domain == "dismissed.example" {
			t.Errorf("a dismissed domain is suggested: %v", suggestions)
		}
	}

	// Dismissing through the endpoint answers 204 and the domain stays
	// unsuggested; the dismissal is no bar to a later rule.
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	dismissed := doLibraryRequest(t, handler, http.MethodPost,
		"/api/library/domain-rule-suggestions/dismissed.example/dismiss", nil)
	if dismissed.Code != http.StatusNoContent {
		t.Errorf("POST dismiss = %d, want 204 (%q)", dismissed.Code, dismissed.Body.String())
	}
	listed := doLibraryRequest(t, handler, http.MethodGet, "/api/library/domain-rule-suggestions", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("GET suggestions = %d (%q)", listed.Code, listed.Body.String())
	}
	var decoded struct {
		Suggestions []map[string]any `json:"suggestions"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the suggestions are not JSON: %v", err)
	}
	for _, suggestion := range decoded.Suggestions {
		if suggestion["domain"] == "dismissed.example" {
			t.Errorf("a dismissed domain is suggested over HTTP: %v", decoded.Suggestions)
		}
	}
	if _, err := service.SetDomainRule(ctx, "dismissed.example", "inbox"); err != nil {
		t.Errorf("setting a rule for a dismissed domain: %v", err)
	}
}

// TestLibraryDomainRulesNeverMoveAnExistingItem: writing a rule is an answer
// about the next save, so every stored item keeps its location and its source
// after a PUT.
func TestLibraryDomainRulesNeverMoveAnExistingItem(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	ctx := context.Background()

	first := librarySaveOne(t, service, "https://stable.example/first", "")
	second := librarySaveAndMove(t, service, "https://stable.example/second", "stash")

	before := map[string][2]string{}
	for _, id := range []string{first.ID, second} {
		row, err := service.Get(ctx, id)
		if err != nil {
			t.Fatalf("reading %s: %v", id, err)
		}
		before[id] = [2]string{row.Location, row.LocationSource}
	}

	if _, err := service.SetDomainRule(ctx, "stable.example", "inbox"); err != nil {
		t.Fatalf("setting the rule: %v", err)
	}
	for _, id := range []string{first.ID, second} {
		row, err := service.Get(ctx, id)
		if err != nil {
			t.Fatalf("reading %s: %v", id, err)
		}
		if got := [2]string{row.Location, row.LocationSource}; got != before[id] {
			t.Errorf("%s is in %q by %q, want %q by %q",
				id, row.Location, row.LocationSource, before[id][0], before[id][1])
		}
	}

	// The rule applies to the next save all the same.
	third := librarySaveOne(t, service, "https://stable.example/third", "")
	row, err := service.Get(ctx, third.ID)
	if err != nil {
		t.Fatalf("reading the third item: %v", err)
	}
	if row.Location != "inbox" || row.LocationSource != "rule" {
		t.Errorf("the third item is in %q by %q, want the inbox by rule", row.Location, row.LocationSource)
	}
}

// TestLibraryDomainRuleSuggestionsOverHTTP reads the suggestion list through
// the router, proving the endpoint answers the shape the contract names.
func TestLibraryDomainRuleSuggestionsOverHTTP(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	for i := 0; i < 3; i++ {
		librarySaveAndMove(t, service, fmt.Sprintf("https://http.example/item-%d", i), "stash")
	}
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/domain-rule-suggestions", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("GET suggestions = %d (%q)", response.Code, response.Body.String())
	}
	var decoded struct {
		Suggestions []struct {
			Domain   string `json:"domain"`
			Location string `json:"location"`
			Moves    int    `json:"moves"`
		} `json:"suggestions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the suggestions are not JSON: %v", err)
	}
	if len(decoded.Suggestions) != 1 || decoded.Suggestions[0].Domain != "http.example" ||
		decoded.Suggestions[0].Location != "stash" || decoded.Suggestions[0].Moves != 3 {
		t.Errorf("the suggestions are %v, want http.example to the stash with 3 moves", decoded.Suggestions)
	}
	if strings.Contains(response.Body.String(), "moves") == false {
		t.Errorf("the answer carries no moves (%q)", response.Body.String())
	}
}
