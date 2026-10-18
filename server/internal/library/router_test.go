package library

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/library/db"
)

// libraryRouterHarness is a library with a decider sidecar of the test's own:
// the real service saving items, the real handler routing them, and a stub
// answering whatever the case under test programmed, counting its calls so a
// test can prove the handler did not ask at all.
type libraryRouterHarness struct {
	t        *testing.T
	database *core.Database
	dataDir  string
	clock    *clocktest.Clock
	service  *LibraryService
	router   *LibraryRouter
	logs     *bytes.Buffer

	status int
	body   string
	calls  int
	states []map[string]string
}

func newLibraryRouterHarness(t *testing.T) *libraryRouterHarness {
	t.Helper()
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	harness := &libraryRouterHarness{
		t:        t,
		database: database,
		dataDir:  dataDir,
		clock:    clock,
		service:  newLibraryTestService(t, database, dataDir, clock),
		logs:     &bytes.Buffer{},
		status:   http.StatusOK,
		body:     libraryRouteAnswer(0.1, "article", 0.1),
	}
	server := httptest.NewServer(http.HandlerFunc(harness.serve))
	t.Cleanup(server.Close)
	harness.router = harness.routerFor(newLibraryDecider(server.URL))
	return harness
}

// routerFor is the handler over a decider of the caller's choosing, which is
// how the no-sidecar and the unreachable-sidecar cases are built: everything
// else about the harness stays the same.
func (h *libraryRouterHarness) routerFor(decider *libraryDecider) *LibraryRouter {
	return NewLibraryRouter(LibraryRouterOptions{
		Database: h.database,
		Clock:    h.clock,
		Logger:   slog.New(slog.NewJSONHandler(h.logs, nil)),
		Decider:  decider,
	})
}

func (h *libraryRouterHarness) serve(w http.ResponseWriter, r *http.Request) {
	h.calls++
	var request struct {
		State map[string]string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		h.t.Errorf("reading the decide request: %v", err)
	}
	h.states = append(h.states, request.State)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(h.status)
	_, _ = w.Write([]byte(h.body))
}

// libraryRouteAnswer is one sidecar reply, shaped the way Laya answers two
// choice questions: the inbox takes the rest of the where distribution, and
// the kinds the answer did not name share the rest of the kind one, so the
// named kind is the top option exactly when its own probability says so.
func libraryRouteAnswer(stash float64, kind string, kindProbability float64) string {
	others := make([]string, 0, len(libraryValidKinds))
	for name := range libraryValidKinds {
		if name != kind {
			others = append(others, name)
		}
	}
	sort.Strings(others)
	kinds := map[string]float64{kind: kindProbability}
	for _, name := range others {
		kinds[name] = (1 - kindProbability) / float64(len(others))
	}
	where := libraryLocationStash
	if stash < 0.5 {
		where = libraryLocationInbox
	}
	encoded, err := json.Marshal(map[string]any{
		"answers": map[string]libraryDeciderAnswer{
			libraryRouteWhereQuestion: {
				Choice: where,
				Probabilities: map[string]float64{
					libraryLocationStash: stash,
					libraryLocationInbox: 1 - stash,
				},
			},
			libraryRouteKindQuestion: {Choice: kind, Probabilities: kinds},
		},
	})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// answers programs the reply the next routing gets.
func (h *libraryRouterHarness) answers(stash float64, kind string, kindProbability float64) {
	h.body = libraryRouteAnswer(stash, kind, kindProbability)
}

// rule writes one of the person's domain rules. The editing API is a later
// bead, so the row is written the way that bead's endpoint will.
func (h *libraryRouterHarness) rule(domain, location string) {
	h.t.Helper()
	if _, err := h.database.Writer().ExecContext(context.Background(),
		`INSERT INTO library_domain_rules (domain, location, created_at) VALUES (?, ?, ?)`,
		domain, location, core.FormatTime(libraryFixedInstant)); err != nil {
		h.t.Fatalf("writing the rule %s -> %s: %v", domain, location, err)
	}
}

func (h *libraryRouterHarness) save(pageURL string) string {
	h.t.Helper()
	return h.saveWith(SaveInput{URL: pageURL, Source: LibrarySourceCLI})
}

func (h *libraryRouterHarness) saveWith(in SaveInput) string {
	h.t.Helper()
	outcome, err := h.service.Save(context.Background(), in)
	if err != nil {
		h.t.Fatalf("saving %s: %v", in.URL, err)
	}
	return outcome.ID
}

func (h *libraryRouterHarness) item(id string) db.LibraryItem {
	h.t.Helper()
	row, err := db.New(h.database.Reader()).GetLibraryItemByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("reading item %s: %v", id, err)
	}
	return row
}

// registryType is the item's type as the cross-module registry holds it,
// which has to follow the kind.
func (h *libraryRouterHarness) registryType(id string) string {
	h.t.Helper()
	var kind string
	if err := h.database.Reader().QueryRowContext(context.Background(),
		`SELECT type FROM core_items WHERE id = ?`, id).Scan(&kind); err != nil {
		h.t.Fatalf("reading the registry type of %s: %v", id, err)
	}
	return kind
}

func (h *libraryRouterHarness) setColumn(id, column string, value any) {
	h.t.Helper()
	if _, err := h.database.Writer().ExecContext(context.Background(),
		`UPDATE library_items SET `+column+` = ? WHERE id = ?`, value, id); err != nil {
		h.t.Fatalf("setting %s on %s: %v", column, id, err)
	}
}

// extracted gives the item the text the decider reads, the way a finished
// extraction leaves it.
func (h *libraryRouterHarness) extracted(id, text string) {
	h.t.Helper()
	h.setColumn(id, "content_text", text)
	h.setColumn(id, "extract_status", "done")
}

// route runs the job the extraction would have queued.
func (h *libraryRouterHarness) route(id string) error {
	h.t.Helper()
	return h.routeThrough(h.router, id)
}

func (h *libraryRouterHarness) routeThrough(router *LibraryRouter, id string) error {
	h.t.Helper()
	payload, err := json.Marshal(map[string]string{"item_id": id})
	if err != nil {
		h.t.Fatalf("encoding the route payload: %v", err)
	}
	return router.Handle(context.Background(), core.Job{
		ID:          "job-route-" + id,
		Kind:        LibraryRouteJobKind,
		Payload:     string(payload),
		Attempt:     1,
		MaxAttempts: core.JobsMaxAttempts,
	})
}

// assertPlaced is the whole assertion of this bead: where the item sits and
// what put it there.
func (h *libraryRouterHarness) assertPlaced(id, location, source string) {
	h.t.Helper()
	row := h.item(id)
	if row.Location != location || row.LocationSource != source {
		h.t.Errorf("the item is in %q by %q, want %q by %q",
			row.Location, row.LocationSource, location, source)
	}
}

// TestADomainRuleMatchesTheHostAndItsSubdomains is the save-time decider, as
// a table: the four cases the bead names plus the two spellings a stored rule
// can arrive in and the suffix that is not a parent domain.
func TestADomainRuleMatchesTheHostAndItsSubdomains(t *testing.T) {
	rules := []db.ListLibraryDomainRulesRow{
		{Domain: "pinterest.com", Location: libraryLocationStash},
		{Domain: "help.pinterest.com", Location: libraryLocationInbox},
		{Domain: ".Dribbble.com", Location: libraryLocationStash},
	}
	cases := []struct {
		name   string
		host   string
		domain string
		found  bool
	}{
		{"the host is the rule", "pinterest.com", "pinterest.com", true},
		{"a subdomain matches its parent", "br.pinterest.com", "pinterest.com", true},
		{"a deeper subdomain too", "a.b.pinterest.com", "pinterest.com", true},
		{"the longest rule wins", "help.pinterest.com", "help.pinterest.com", true},
		{"and under the longest rule", "en.help.pinterest.com", "help.pinterest.com", true},
		{"a sloppily stored rule still governs", "cdn.dribbble.com.", ".Dribbble.com", true},
		{"a suffix that is not a parent domain", "notpinterest.com", "", false},
		{"a host with no rule at all", "example.org", "", false},
		{"no host to match", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rule, ok := libraryMatchDomainRule(rules, tc.host)
			if ok != tc.found {
				t.Fatalf("matching %q found %v, want %v", tc.host, ok, tc.found)
			}
			if ok && rule.Domain != tc.domain {
				t.Errorf("matching %q chose %q, want %q", tc.host, rule.Domain, tc.domain)
			}
		})
	}
}

// TestThePlacementFallsBackToTheInboxAndTheImportToTheArchive: the rest of
// the save-time decider, which is the default and the one option on it.
func TestThePlacementFallsBackToTheInboxAndTheImportToTheArchive(t *testing.T) {
	rules := []db.ListLibraryDomainRulesRow{
		{Domain: "pinterest.com", Location: libraryLocationStash},
		{Domain: "arena.example", Location: libraryLocationInbox},
	}
	cases := []struct {
		name     string
		host     string
		asImport bool
		want     libraryPlacement
	}{
		{"no rule, no import", "example.org", false,
			libraryPlacement{libraryLocationInbox, libraryLocationSourceDefault}},
		{"a rule to the stash", "br.pinterest.com", false,
			libraryPlacement{libraryLocationStash, libraryLocationSourceRule}},
		{"a rule to the inbox", "arena.example", false,
			libraryPlacement{libraryLocationInbox, libraryLocationSourceRule}},
		{"an import with no rule lands processed", "example.org", true,
			libraryPlacement{libraryLocationArchive, libraryLocationSourceImport}},
		{"an import keeps a stash rule", "pinterest.com", true,
			libraryPlacement{libraryLocationStash, libraryLocationSourceRule}},
		{"an import over an inbox rule still archives", "arena.example", true,
			libraryPlacement{libraryLocationArchive, libraryLocationSourceImport}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := libraryPlaceNewItem(rules, tc.host, tc.asImport); got != tc.want {
				t.Errorf("placing %q (import=%v) gave %+v, want %+v", tc.host, tc.asImport, got, tc.want)
			}
		})
	}
}

// TestASaveAppliesTheDomainRuleItMatches is the rule read through the real
// save: the row lands where the rule says and records that a rule said so,
// and the host's parent rule reaches its subdomain.
func TestASaveAppliesTheDomainRuleItMatches(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	harness.rule("pinterest.com", libraryLocationStash)
	harness.rule("help.pinterest.com", libraryLocationInbox)

	pin := harness.save("https://br.pinterest.com/pin/12345/")
	harness.assertPlaced(pin, libraryLocationStash, libraryLocationSourceRule)

	// The longest matching rule wins, through the save and not only in the
	// matcher: this one sends the same host's help pages to the inbox.
	help := harness.save("https://help.pinterest.com/en/article/save-pins")
	harness.assertPlaced(help, libraryLocationInbox, libraryLocationSourceRule)

	essay := harness.save("https://example.org/essays/a-long-one")
	harness.assertPlaced(essay, libraryLocationInbox, libraryLocationSourceDefault)
}

// TestASaveUnderTheImportOptionLandsInTheArchive: the option the Karakeep
// import calls the same router with.
func TestASaveUnderTheImportOptionLandsInTheArchive(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	harness.rule("pinterest.com", libraryLocationStash)

	imported := harness.saveWith(SaveInput{
		URL: "https://example.org/old-bookmark", Source: LibrarySourceImport, AsImport: true,
	})
	harness.assertPlaced(imported, libraryLocationArchive, libraryLocationSourceImport)

	// A rule is an answer about the host, not about this batch, so it still
	// decides -- an import does not sweep a stashed host into the archive.
	pin := harness.saveWith(SaveInput{
		URL: "https://pinterest.com/pin/9/", Source: LibrarySourceImport, AsImport: true,
	})
	harness.assertPlaced(pin, libraryLocationStash, libraryLocationSourceRule)

	// The same source without the option is an ordinary arrival.
	plain := harness.saveWith(SaveInput{
		URL: "https://example.org/another", Source: LibrarySourceImport,
	})
	harness.assertPlaced(plain, libraryLocationInbox, libraryLocationSourceDefault)
}

// TestAPatchOfTheLocationIsThePersonsOwnPlacement: the one write that pins an
// item against everything automatic.
func TestAPatchOfTheLocationIsThePersonsOwnPlacement(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	id := harness.save("https://example.org/to-triage")
	harness.assertPlaced(id, libraryLocationInbox, libraryLocationSourceDefault)

	location := "up_next"
	if _, err := harness.service.Patch(context.Background(), id, PatchInput{Location: &location}); err != nil {
		t.Fatalf("patching the location: %v", err)
	}
	harness.assertPlaced(id, "up_next", libraryLocationSourceUser)

	// A patch that touches anything else leaves the record alone: only a
	// placement is a placement.
	unread := false
	if _, err := harness.service.Patch(context.Background(), id, PatchInput{Unread: &unread}); err != nil {
		t.Fatalf("patching the read state: %v", err)
	}
	harness.assertPlaced(id, "up_next", libraryLocationSourceUser)
}

// TestADuplicateSaveLeavesTheLocationAndTheKindAlone: saving a link again is
// not a new arrival, so neither the router nor a rule written since gets to
// undo the triage the person did in between.
func TestADuplicateSaveLeavesTheLocationAndTheKindAlone(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	id := harness.save("https://example.org/saved-twice")

	location := "later"
	kind := "video"
	if _, err := harness.service.Patch(context.Background(), id,
		PatchInput{Location: &location, Kind: &kind}); err != nil {
		t.Fatalf("patching the item: %v", err)
	}

	// The rule arrives after the first save, which is the case that would
	// move the item if a duplicate were routed again.
	harness.rule("example.org", libraryLocationStash)
	again := harness.saveWith(SaveInput{
		URL: "https://example.org/saved-twice", Source: LibrarySourceCLI, Reason: "a second thought",
	})
	if again != id {
		t.Fatalf("the duplicate save created %s, want the existing %s", again, id)
	}
	harness.assertPlaced(id, "later", libraryLocationSourceUser)
	if got := harness.item(id).Kind; got != "video" {
		t.Errorf("the duplicate save left the kind as %q, want video", got)
	}

	// Nor does the import option reach an item that already exists.
	imported := harness.saveWith(SaveInput{
		URL: "https://example.org/saved-twice", Source: LibrarySourceImport, AsImport: true,
	})
	if imported != id {
		t.Fatalf("the import save created %s, want the existing %s", imported, id)
	}
	harness.assertPlaced(id, "later", libraryLocationSourceUser)
}

// TestTheDeciderStashesOnlyWhenItIsSureEnough is the threshold, from both
// sides, through the real handler against the stub sidecar.
func TestTheDeciderStashesOnlyWhenItIsSureEnough(t *testing.T) {
	cases := []struct {
		name     string
		stash    float64
		location string
		source   string
	}{
		{"above the threshold", 0.94, libraryLocationStash, libraryLocationSourceDecider},
		{"exactly at it", libraryStashThreshold, libraryLocationStash, libraryLocationSourceDecider},
		{"just under it", 0.79, libraryLocationInbox, libraryLocationSourceDefault},
		{"the measured pin with no text", 0.6042, libraryLocationInbox, libraryLocationSourceDefault},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryRouterHarness(t)
			id := harness.save("https://example.org/a-pin")
			harness.extracted(id, "A page of pictures and nothing to read.")
			harness.answers(tc.stash, "article", 0.2)

			if err := harness.route(id); err != nil {
				t.Fatalf("routing: %v", err)
			}
			if harness.calls != 2 {
				t.Errorf("the sidecar saw %d calls, want 2: the placement, then the kind", harness.calls)
			}
			harness.assertPlaced(id, tc.location, tc.source)
		})
	}
}

// TestTheRoutedStateCarriesWhatTheBeadNames: the decider answers about the
// state it is given, so what travels is the whole criterion -- URL, host,
// title, the person's reason and the start of the text, capped.
func TestTheRoutedStateCarriesWhatTheBeadNames(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	id := harness.saveWith(SaveInput{
		URL:    "https://br.pinterest.com/pin/7/",
		Title:  "A board of kitchens",
		Reason: "for the renovation",
		Source: LibrarySourceCLI,
	})
	harness.extracted(id, strings.Repeat("x", libraryRouteTextRunes+500))
	if err := harness.route(id); err != nil {
		t.Fatalf("routing: %v", err)
	}
	if len(harness.states) != 2 {
		t.Fatalf("the sidecar saw %d states, want 2: the placement, then the kind", len(harness.states))
	}
	// The kind is asked without the host, which pulled an essay to podcast
	// against the real model.
	if host, ok := harness.states[1]["host"]; ok {
		t.Errorf("the kind question's state carried host %q, want none", host)
	}
	state := harness.states[0]
	for field, want := range map[string]string{
		"url":    "https://br.pinterest.com/pin/7/",
		"host":   "br.pinterest.com",
		"title":  "A board of kitchens",
		"reason": "for the renovation",
	} {
		if state[field] != want {
			t.Errorf("state[%q] = %q, want %q", field, state[field], want)
		}
	}
	if got := len([]rune(state["text"])); got != libraryRouteTextRunes {
		t.Errorf("the state carried %d runes of text, want %d", got, libraryRouteTextRunes)
	}
}

// TestTheDeciderNeverOverridesAPlacementItDoesNotOwn is the rule above the
// router: every source but the default is somebody's answer, and an item
// moved out of where the save left it is one too. The sidecar is asked in
// every case -- its kind answer is not about the placement -- and answers
// stash at 0.99, which the guard refuses to act on.
func TestTheDeciderNeverOverridesAPlacementItDoesNotOwn(t *testing.T) {
	cases := []struct {
		name     string
		prepare  func(*libraryRouterHarness, string)
		location string
		source   string
	}{
		{
			name: "the person moved it",
			prepare: func(h *libraryRouterHarness, id string) {
				location := "up_next"
				if _, err := h.service.Patch(context.Background(), id, PatchInput{Location: &location}); err != nil {
					h.t.Fatalf("patching the location: %v", err)
				}
			},
			location: "up_next", source: libraryLocationSourceUser,
		},
		{
			name: "a rule placed it",
			prepare: func(h *libraryRouterHarness, id string) {
				h.setColumn(id, "location_source", libraryLocationSourceRule)
			},
			location: libraryLocationInbox, source: libraryLocationSourceRule,
		},
		{
			name: "an import placed it",
			prepare: func(h *libraryRouterHarness, id string) {
				h.setColumn(id, "location", libraryLocationArchive)
				h.setColumn(id, "location_source", libraryLocationSourceImport)
			},
			location: libraryLocationArchive, source: libraryLocationSourceImport,
		},
		{
			// The guard's second half: a location that moved while the source
			// still reads default. Nothing in Norte writes that pair today,
			// which is exactly why the write is guarded on both -- the next
			// writer of the column must not be able to lose a move.
			name: "the location changed since the save",
			prepare: func(h *libraryRouterHarness, id string) {
				h.setColumn(id, "location", "later")
			},
			location: "later", source: libraryLocationSourceDefault,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryRouterHarness(t)
			id := harness.save("https://example.org/mine")
			harness.extracted(id, "Some text.")
			harness.answers(0.99, "article", 0.2)
			tc.prepare(harness, id)

			if err := harness.route(id); err != nil {
				t.Fatalf("routing: %v", err)
			}
			if harness.calls != 2 {
				t.Errorf("the sidecar saw %d calls, want 2: the placement, then the kind", harness.calls)
			}
			harness.assertPlaced(id, tc.location, tc.source)
		})
	}
}

// TestTheDeciderSetsTheKindOnlyAboveItsThreshold: the kind half, including
// the kind the person chose, which no answer may overwrite.
func TestTheDeciderSetsTheKindOnlyAboveItsThreshold(t *testing.T) {
	cases := []struct {
		name        string
		kind        string
		probability float64
		handEdited  string
		want        string
	}{
		{"above the threshold", "video", 0.71, "", "video"},
		{"exactly at it", "podcast", libraryKindThreshold, "", "podcast"},
		{"just under it", "video", 0.59, "", libraryDefaultKind},
		{"a kind the library does not have", "recipe", 0.95, "", libraryDefaultKind},
		{"the kind the save already wrote", libraryDefaultKind, 0.95, "", libraryDefaultKind},
		{"a kind the person chose", "video", 0.99, "book", "book"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryRouterHarness(t)
			id := harness.save("https://example.org/a-talk")
			harness.extracted(id, "A transcript of a talk.")
			if tc.handEdited != "" {
				kind := tc.handEdited
				if _, err := harness.service.Patch(context.Background(), id, PatchInput{Kind: &kind}); err != nil {
					t.Fatalf("patching the kind: %v", err)
				}
			}
			harness.answers(0.1, tc.kind, tc.probability)

			if err := harness.route(id); err != nil {
				t.Fatalf("routing: %v", err)
			}
			if got := harness.item(id).Kind; got != tc.want {
				t.Errorf("the kind is %q, want %q", got, tc.want)
			}
			// The registry carries the type the rest of Norte reads, so the
			// two must never disagree about what the item is.
			if got := harness.registryType(id); got != tc.want {
				t.Errorf("the registry type is %q, want %q", got, tc.want)
			}
		})
	}
}

// TestARoutingThatFailsLeavesTheItemWhereItWas covers every way the sidecar
// can let the router down: there is none configured, it refuses the
// connection, it answers a status, or it answers something that is not an
// answer. In all four the item stays in the inbox and the job does not keep
// retrying -- except the unconfigured case, which is permanent because no
// retry can conjure a sidecar back.
func TestARoutingThatFailsLeavesTheItemWhereItWas(t *testing.T) {
	t.Run("no decider is configured", func(t *testing.T) {
		harness := newLibraryRouterHarness(t)
		id := harness.save("https://example.org/unrouted")
		harness.extracted(id, "Some text.")

		err := harness.routeThrough(harness.routerFor(newLibraryDecider("")), id)
		if err == nil {
			t.Fatal("routing with no decider succeeded")
		}
		if !core.IsPermanent(err) {
			t.Errorf("the failure is retryable (%v), want permanent", err)
		}
		harness.assertPlaced(id, libraryLocationInbox, libraryLocationSourceDefault)
	})

	t.Run("the sidecar refuses the connection", func(t *testing.T) {
		harness := newLibraryRouterHarness(t)
		id := harness.save("https://example.org/unreachable")
		harness.extracted(id, "Some text.")

		// Port 1 on the loopback refuses at once, so the case is the sidecar
		// being down rather than the test waiting out a timeout.
		if err := harness.routeThrough(harness.routerFor(newLibraryDecider("http://127.0.0.1:1")), id); err != nil {
			t.Fatalf("a routing against a dead sidecar failed the job: %v", err)
		}
		harness.assertPlaced(id, libraryLocationInbox, libraryLocationSourceDefault)
		harness.assertLogged(id, "127.0.0.1:1")
	})

	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"the sidecar answers a status", http.StatusServiceUnavailable, `{"ready": false}`},
		{"the sidecar answers prose", http.StatusOK, `the model is thinking`},
		{"the sidecar answers no questions", http.StatusOK, `{"answers": {}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryRouterHarness(t)
			id := harness.save("https://example.org/half-answered")
			harness.extracted(id, "Some text.")
			harness.status = tc.status
			harness.body = tc.body

			if err := harness.route(id); err != nil {
				t.Fatalf("a routing the sidecar botched failed the job: %v", err)
			}
			harness.assertPlaced(id, libraryLocationInbox, libraryLocationSourceDefault)
			harness.assertLogged(id, "")
		})
	}
}

// assertLogged reads the captured log for a line naming the item, which is
// the one thing a person has to go on when an item did not move: a failure
// nobody can attribute to an item is a failure nobody can look into. detail,
// when given, must appear in the same log.
func (h *libraryRouterHarness) assertLogged(id, detail string) {
	h.t.Helper()
	logged := h.logs.String()
	if !strings.Contains(logged, id) {
		h.t.Errorf("the failure was logged without the item id %s: %s", id, logged)
	}
	if !strings.Contains(logged, "could not be decided") {
		h.t.Errorf("the failure was not logged as one: %s", logged)
	}
	if detail != "" && !strings.Contains(logged, detail) {
		h.t.Errorf("the log does not say %q: %s", detail, logged)
	}
}

// TestARouteJobForADeletedItemFinishesDone: the item was deleted while the job
// waited, so there is nowhere to route it to and nothing wrong. The same
// reasoning as the classify and extract handlers: a deliberate delete is not
// a failure of the server.
func TestARouteJobForADeletedItemFinishesDone(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	if err := harness.route(core.NewID()); err != nil {
		t.Fatalf("routing a deleted item: %v", err)
	}
}

// TestARouteJobWithNoItemFailsAtOnce: a payload naming nothing is a bug in
// whoever queued it, and retrying the same bytes cannot fix it.
func TestARouteJobWithNoItemFailsAtOnce(t *testing.T) {
	harness := newLibraryRouterHarness(t)
	for _, payload := range []string{`{}`, `{"item_id": ""}`, `not json`} {
		err := harness.router.Handle(context.Background(), core.Job{
			ID: "job-bad", Kind: LibraryRouteJobKind, Payload: payload,
			Attempt: 1, MaxAttempts: core.JobsMaxAttempts,
		})
		if err == nil {
			t.Fatalf("the payload %q was accepted", payload)
		}
		if !core.IsPermanent(err) {
			t.Errorf("the payload %q failed retryably (%v), want permanent", payload, err)
		}
	}
}

// TestAnExtractionQueuesTheRoutingOnlyWithASidecar: the extraction is what
// puts the routing in the queue, and only when there is something to ask --
// the same rule the classify and tag jobs follow.
func TestAnExtractionQueuesTheRoutingOnlyWithASidecar(t *testing.T) {
	for _, configured := range []bool{true, false} {
		name := "with a sidecar"
		if !configured {
			name = "without one"
		}
		t.Run(name, func(t *testing.T) {
			harness := newLibraryExtractHarness(t, libraryHarnessOptions{Decider: configured})
			page, err := os.ReadFile("testdata/pages/essay.html")
			if err != nil {
				t.Fatalf("reading the fixture: %v", err)
			}
			id := harness.save("https://example.org/essays/one", page)
			if err := harness.runToCompletion(id, 1, false); err != nil {
				t.Fatalf("extracting: %v", err)
			}
			if status := harness.item(id).ExtractStatus; status != "done" {
				t.Fatalf("extract_status = %q, want done", status)
			}
			// The item is untouched by the extraction itself: the decider is
			// asked by the job, and until it runs the save's placement holds.
			if row := harness.item(id); row.Location != libraryLocationInbox ||
				row.LocationSource != libraryLocationSourceDefault {
				t.Errorf("the extraction left the item in %q by %q, want the inbox by default",
					row.Location, row.LocationSource)
			}

			want := 0
			if configured {
				want = 1
			}
			if got := harness.countJobs(LibraryRouteJobKind); got != want {
				t.Errorf("%d routing jobs were queued, want %d", got, want)
			}
			if !configured {
				return
			}
			var key string
			if err := harness.database.Reader().QueryRowContext(context.Background(),
				`SELECT dedupe_key FROM core_jobs WHERE kind = ? LIMIT 1`,
				LibraryRouteJobKind).Scan(&key); err != nil {
				t.Fatalf("reading the routing job: %v", err)
			}
			if want := "route:" + id; key != want {
				t.Errorf("the routing job's dedupe key is %q, want %q", key, want)
			}
			// A second extraction of the same generation collapses on that
			// key rather than queueing a second opinion.
			if err := harness.runToCompletion(id, 1, false); err != nil {
				t.Fatalf("re-extracting: %v", err)
			}
			if got := harness.countJobs(LibraryRouteJobKind); got != 1 {
				t.Errorf("a replay queued %d routing jobs, want 1", got)
			}
		})
	}
}

// TestTheLibraryRegistersTheRoutingHandler: a kind nothing handles is a kind
// whose jobs sit in the queue for ever, so the registration is part of the
// feature and not of the wiring.
func TestTheLibraryRegistersTheRoutingHandler(t *testing.T) {
	handlers := (&LibraryModule{}).JobHandlers(app.Deps{DeciderURL: "http://127.0.0.1:1"})
	if _, ok := handlers[LibraryRouteJobKind]; !ok {
		t.Fatalf("the library registers no %s handler", LibraryRouteJobKind)
	}
	// Registered whether or not a sidecar is configured: a job queued while
	// one was configured can be claimed after it is gone.
	if _, ok := (&LibraryModule{}).JobHandlers(app.Deps{})[LibraryRouteJobKind]; !ok {
		t.Errorf("the %s handler is missing without a sidecar", LibraryRouteJobKind)
	}
}
