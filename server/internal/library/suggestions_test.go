package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

// libraryRequireErrorEnvelope asserts a refusal came back in the one envelope
// the API answers failures in, carrying the code expected and the request id
// the same failure was logged under.
//
// It checks the shape and not only the status, because a 400 with a bare
// message is a 400 no client can branch on, and that is exactly what a
// hand-written error path produces when it bypasses the envelope.
func libraryRequireErrorEnvelope(t *testing.T, response *httptest.ResponseRecorder, code string) {
	t.Helper()
	var body struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"request_id"`
			Field     string `json:"field"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("the refusal is not JSON: %v (%q)", err, response.Body.String())
	}
	if body.Error.Code != code {
		t.Errorf("the refusal carries code %q, want %q (%q)", body.Error.Code, code, response.Body.String())
	}
	if body.Error.Message == "" {
		t.Errorf("the refusal carries no message (%q)", response.Body.String())
	}
	if body.Error.RequestID == "" {
		t.Errorf("the refusal carries no request id (%q)", response.Body.String())
	}
}

// libraryFocusFixture is the shelf the focus-ranked tests reason about: two
// subjects in focus, and five unread items linked to them in the five ways
// that produce a different weight.
type libraryFocusFixture struct {
	handler  http.Handler
	service  *LibraryService
	database *core.Database
	subjectA string
	subjectB string
	// ids are keyed by the letters the bead names the items with, so a
	// failure message says which link shape went wrong.
	ids map[string]string
}

// newLibraryFocusSubject flags a subject and returns the registry id a link
// has to point at to count as in focus.
func newLibraryFocusSubject(t *testing.T, database *core.Database, clock core.Clock, name string) string {
	t.Helper()
	record, err := core.NewSubjects(database, clock).Create(context.Background(), name, true)
	if err != nil {
		t.Fatalf("creating the focus subject %s: %v", name, err)
	}
	return record.Row.ID
}

// libraryInsertLink writes one core_links row exactly as asked.
//
// It inserts rather than going through core.Links because the two writers
// there produce only a manual confirmed link and an llm suggestion with a
// confidence: a rejected link and a suggestion with no confidence recorded are
// both states the ranking has to score, and neither is reachable from the
// writer in one call.
func libraryInsertLink(t *testing.T, database *core.Database, clock core.Clock,
	srcID, dstID, status string, confidence *float64) {
	t.Helper()
	source := core.LinkSourceLLM
	if status == core.LinkStatusConfirmed {
		source = core.LinkSourceManual
	}
	stored := sql.NullFloat64{}
	if confidence != nil {
		stored = sql.NullFloat64{Float64: *confidence, Valid: true}
	}
	_, err := database.Writer().ExecContext(context.Background(),
		`INSERT INTO core_links (id, src_id, dst_id, kind, source, status, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		core.NewID(), srcID, dstID, core.LinkKindAbout, source, status, stored,
		core.FormatTime(clock.Now()))
	if err != nil {
		t.Fatalf("linking %s to %s as %s: %v", srcID, dstID, status, err)
	}
}

// newLibraryFocusFixture saves v, w, z, y, x in that order -- ids ascending,
// which the draw tests rely on -- then back-dates saved_at so that w is the
// newest and x the oldest. That puts the saved order (w v z y x) well away
// from the score order (x y z w v), which is what lets the ranking tests
// fail when the score stops mattering. Each item is linked the way the bead's
// first criterion describes.
func newLibraryFocusFixture(t *testing.T, clock *clocktest.Clock) libraryFocusFixture {
	t.Helper()
	database, dataDir := newLibraryTestDB(t, clock)
	fixture := libraryFocusFixture{
		handler:  newLibraryTestRouter(t, database, dataDir, clock),
		service:  newLibraryTestService(t, database, dataDir, clock),
		database: database,
		ids:      map[string]string{},
	}
	fixture.subjectA = newLibraryFocusSubject(t, database, clock, "Assunto A")
	fixture.subjectB = newLibraryFocusSubject(t, database, clock, "Assunto B")
	for _, letter := range []string{"v", "w", "z", "y", "x"} {
		clock.Advance(time.Minute)
		fixture.ids[letter] = librarySaveOne(t, fixture.service,
			fmt.Sprintf("https://example.org/focus-%s", letter), "").ID
	}
	for minute, letter := range []string{"x", "y", "z", "v", "w"} {
		if _, err := database.Writer().ExecContext(context.Background(),
			"UPDATE library_items SET saved_at = ? WHERE id = ?",
			core.FormatTime(libraryFixedInstant.Add(time.Duration(minute+1)*time.Minute)),
			fixture.ids[letter]); err != nil {
			t.Fatalf("back-dating %s: %v", letter, err)
		}
	}
	confidence := 0.8
	libraryInsertLink(t, database, clock, fixture.ids["x"], fixture.subjectA, core.LinkStatusConfirmed, nil)
	libraryInsertLink(t, database, clock, fixture.ids["y"], fixture.subjectA, core.LinkStatusSuggested, &confidence)
	libraryInsertLink(t, database, clock, fixture.ids["z"], fixture.subjectB, core.LinkStatusSuggested, nil)
	libraryInsertLink(t, database, clock, fixture.ids["w"], fixture.subjectA, core.LinkStatusRejected, nil)
	return fixture
}

// letters names a list of ids back in the fixture's letters, so a failed
// ordering assertion prints x y z w v rather than five UUIDs.
func (f libraryFocusFixture) letters(ids []string) []string {
	byID := make(map[string]string, len(f.ids))
	for letter, id := range f.ids {
		byID[id] = letter
	}
	named := make([]string, 0, len(ids))
	for _, id := range ids {
		if letter, ok := byID[id]; ok {
			named = append(named, letter)
			continue
		}
		named = append(named, id)
	}
	return named
}

// TestLibrarySuggestionsViewRanksByTheFocusScore is the ranking itself: the
// order is the one the weights compute by hand -- 1.0 for the confirmed link,
// the recorded confidence for the suggestion, half a point for a suggestion
// with none, nothing for the rejected one -- and the two unscored items follow
// in saved order.
func TestLibrarySuggestionsViewRanksByTheFocusScore(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=suggestions&limit=50"))
	want := []string{"x", "y", "z", "w", "v"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("view=suggestions ordered %v, want %v", got, want)
	}
}

// librarySuggestionsItem is one row of the fixture below: what it is linked
// to, whether it has been read, where it sits, and the minute its saved_at is
// back-dated to.
type librarySuggestionsItem struct {
	letter   string
	scored   bool
	unread   bool
	location string
	minute   int
}

// librarySuggestionsRows is the fixture the ordering and the pagination both
// read. Two focus scores (1.0 for the confirmed link, 0 for no link at all),
// two unread and two read items at each, and saved dates that disagree with
// every other key -- so an order that dropped the score, dropped the unread
// level or swapped the two comes out different rather than coincidentally
// right. The locations cover all five, archive and stash included, because
// the view reads every one of them.
var librarySuggestionsRows = []librarySuggestionsItem{
	{letter: "a", scored: true, unread: true, location: "inbox", minute: 1},
	{letter: "b", scored: true, unread: false, location: "up_next", minute: 8},
	{letter: "c", scored: true, unread: true, location: "later", minute: 3},
	{letter: "d", scored: true, unread: false, location: "archive", minute: 6},
	{letter: "e", scored: false, unread: true, location: "stash", minute: 2},
	{letter: "f", scored: false, unread: false, location: "inbox", minute: 7},
	{letter: "g", scored: false, unread: true, location: "archive", minute: 4},
	{letter: "h", scored: false, unread: false, location: "stash", minute: 5},
}

// librarySuggestionsOrder is what the four keys produce over those rows:
// score first, then unread, then the saved date, then the id.
//
//	score 1.0 unread: c (minute 3), a (1)
//	score 1.0 read:   b (8), d (6)
//	score 0   unread: g (4), e (2)
//	score 0   read:   f (7), h (5)
//
// b and d are read and still come before g and e, which are unread: that is
// the "across scores the higher score wins regardless of unread state" half.
var librarySuggestionsOrder = []string{"c", "a", "b", "d", "g", "e", "f", "h"}

// newLibrarySuggestionsFixture builds those eight rows.
func newLibrarySuggestionsFixture(t *testing.T, clock *clocktest.Clock) libraryFocusFixture {
	t.Helper()
	database, dataDir := newLibraryTestDB(t, clock)
	fixture := libraryFocusFixture{
		handler:  newLibraryTestRouter(t, database, dataDir, clock),
		service:  newLibraryTestService(t, database, dataDir, clock),
		database: database,
		ids:      map[string]string{},
	}
	fixture.subjectA = newLibraryFocusSubject(t, database, clock, "Assunto A")
	for _, row := range librarySuggestionsRows {
		clock.Advance(time.Minute)
		id := librarySaveOne(t, fixture.service,
			fmt.Sprintf("https://example.org/suggest-%s", row.letter), "").ID
		fixture.ids[row.letter] = id
		if _, err := database.Writer().ExecContext(context.Background(),
			"UPDATE library_items SET saved_at = ? WHERE id = ?",
			core.FormatTime(libraryFixedInstant.Add(time.Duration(row.minute)*time.Minute)),
			id); err != nil {
			t.Fatalf("back-dating %s: %v", row.letter, err)
		}
		location := row.location
		patch := PatchInput{Location: &location}
		if !row.unread {
			read := false
			patch.Unread = &read
		}
		if _, err := fixture.service.Patch(context.Background(), id, patch); err != nil {
			t.Fatalf("placing %s in %s: %v", row.letter, row.location, err)
		}
		if row.scored {
			libraryInsertLink(t, database, clock, id, fixture.subjectA, core.LinkStatusConfirmed, nil)
		}
	}
	return fixture
}

// TestLibrarySuggestionsOrdersUnreadBeforeReadWithinAScore asserts the exact
// returned order rather than membership, because every weaker assertion here
// passes on an order that has lost one of its four keys.
func TestLibrarySuggestionsOrdersUnreadBeforeReadWithinAScore(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibrarySuggestionsFixture(t, clock)

	got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=suggestions&limit=50"))
	if fmt.Sprint(got) != fmt.Sprint(librarySuggestionsOrder) {
		t.Fatalf("view=suggestions ordered %v, want %v", got, librarySuggestionsOrder)
	}
}

// TestLibrarySuggestionsReadsEveryLocation is the other half of "not a
// location": the archived and the stashed items are in the answer, which they
// were not while the view read only what was unread and the shelves held
// three values.
func TestLibrarySuggestionsReadsEveryLocation(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibrarySuggestionsFixture(t, clock)

	listed := map[string]bool{}
	for _, letter := range fixture.letters(libraryListIDs(t, fixture.handler, "?view=suggestions&limit=50")) {
		listed[letter] = true
	}
	for _, row := range librarySuggestionsRows {
		if !listed[row.letter] {
			t.Errorf("%s, in %s, is missing from view=suggestions", row.letter, row.location)
		}
	}
}

// TestLibrarySuggestionsPaginatesAcrossTheUnreadBoundary is the page-boundary
// case the four-level cursor exists for: with limit=2 the first boundary falls
// inside the run of four items that share score 1.0, exactly where unread
// turns into read. A cursor that paged by the score and the saved date alone
// would restart that run, which shows up as a repeat or a skip here and
// nowhere on the first page.
func TestLibrarySuggestionsPaginatesAcrossTheUnreadBoundary(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibrarySuggestionsFixture(t, clock)

	paged, pages := libraryPageThrough(t, fixture.handler, "?view=suggestions&limit=2", 8)
	if pages < 3 {
		t.Fatalf("the pagination took %d pages, want at least 3", pages)
	}
	got := fixture.letters(paged)
	if fmt.Sprint(got) != fmt.Sprint(librarySuggestionsOrder) {
		t.Fatalf("paged view=suggestions gave %v, want %v", got, librarySuggestionsOrder)
	}
	seen := map[string]int{}
	for _, letter := range got {
		seen[letter]++
	}
	for _, row := range librarySuggestionsRows {
		if seen[row.letter] != 1 {
			t.Errorf("%s came back %d times across the pages, want exactly once", row.letter, seen[row.letter])
		}
	}
}

// libraryPageThrough walks a list to its last page and returns every id in
// the order the pages gave them, plus how many pages it took.
func libraryPageThrough(t *testing.T, handler http.Handler, query string, maxPages int) ([]string, int) {
	t.Helper()
	collected := []string{}
	cursor := ""
	for pages := 1; ; pages++ {
		if pages > maxPages+1 {
			t.Fatalf("the pagination of %s did not terminate", query)
		}
		path := "/api/library/items" + query
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		response := doLibraryRequest(t, handler, http.MethodGet, path, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s = %d (%q)", path, response.Code, response.Body.String())
		}
		var page map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatalf("the page is not JSON: %v", err)
		}
		items, _ := page["items"].([]any)
		for _, entry := range items {
			collected = append(collected, entry.(map[string]any)["id"].(string))
		}
		next, _ := page["next_cursor"].(string)
		if next == "" {
			return collected, pages
		}
		cursor = next
	}
}

// TestLibrarySuggestionsViewPaginatesAndBindsItsCursor is three pages of two
// under limit=2 with nothing repeated and nothing lost, and the cursor refused
// the moment it is presented under another view.
func TestLibrarySuggestionsViewPaginatesAndBindsItsCursor(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)
	// A sixth unscored item whose saved date disagrees with its id order:
	// saved last, so its id is the largest of all, and then back-dated to
	// before every other. Without it a page boundary inside the run of equal
	// scores could be continued by the id alone and still come out right,
	// which is exactly the weaker reason this test could pass for -- the ids
	// are time-ordered, so they agree with the saved order until something
	// makes them disagree.
	clock.Advance(time.Minute)
	fixture.ids["u"] = librarySaveOne(t, fixture.service, "https://example.org/focus-u", "").ID
	if _, err := fixture.database.Writer().ExecContext(context.Background(),
		"UPDATE library_items SET saved_at = ? WHERE id = ?",
		core.FormatTime(libraryFixedInstant.Add(-time.Hour)), fixture.ids["u"]); err != nil {
		t.Fatalf("back-dating u: %v", err)
	}

	firstCursor := libraryFirstCursor(t, fixture.handler, "?view=suggestions&limit=2")
	paged, _ := libraryPageThrough(t, fixture.handler, "?view=suggestions&limit=2", 6)
	got := fixture.letters(paged)
	want := []string{"x", "y", "z", "w", "v", "u"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("paged view=suggestions gave %v, want %v", got, want)
	}

	refused := doLibraryRequest(t, fixture.handler, http.MethodGet,
		"/api/library/items?view=all&limit=2&cursor="+firstCursor, nil)
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("a suggestions cursor under view=all = %d, want 400 (%q)", refused.Code, refused.Body.String())
	}
	libraryRequireErrorEnvelope(t, refused, "invalid_cursor")
}

// libraryFirstCursor reads the next_cursor of a list's first page.
func libraryFirstCursor(t *testing.T, handler http.Handler, query string) string {
	t.Helper()
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items"+query, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("GET %s = %d (%q)", query, response.Code, response.Body.String())
	}
	var page map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatalf("the page is not JSON: %v", err)
	}
	cursor, _ := page["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("GET %s answered no next_cursor (%q)", query, response.Body.String())
	}
	return cursor
}

// TestLibrarySuggestionsViewRefusesASecondOrder proves the two parameters that
// would ask the view for an order it does not have are refused rather than
// quietly dropped -- and that unread is not one of them any more.
func TestLibrarySuggestionsViewRefusesASecondOrder(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	for _, query := range []string{"?view=suggestions&q=focus", "?view=suggestions&sort=title"} {
		response := doLibraryRequest(t, fixture.handler, http.MethodGet, "/api/library/items"+query, nil)
		if response.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400 (%q)", query, response.Code, response.Body.String())
			continue
		}
		libraryRequireErrorEnvelope(t, response, "invalid_request")
	}

	// unread=true is an ordinary filter over the view, not a conflict.
	if got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=suggestions&unread=true&limit=50")); len(got) != 5 {
		t.Errorf("view=suggestions&unread=true listed %v, want all five", got)
	}
}

// TestLibrarySuggestionsAcceptsUnreadFalse is the refusal that went: asking
// the view for what has already been read is answered, with only the read
// items in it and still in focus order.
func TestLibrarySuggestionsAcceptsUnreadFalse(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibrarySuggestionsFixture(t, clock)

	status, decoded := libraryGetList(t, fixture.handler, "?view=suggestions&unread=false&limit=50")
	if status != http.StatusOK {
		t.Fatalf("view=suggestions&unread=false = %d, want 200 (%v)", status, decoded)
	}
	got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=suggestions&unread=false&limit=50"))
	want := []string{"b", "d", "f", "h"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("view=suggestions&unread=false listed %v, want the read items %v", got, want)
	}
}

// TestLibrarySuggestionsCursorIsBoundToTheUnreadFilter is what keeps unread
// being an ordinary filter from reopening the hole the forcing used to close:
// the flag is one of the four inputs to the filter hash, so a cursor issued
// for the unread-only list cannot continue the whole list.
func TestLibrarySuggestionsCursorIsBoundToTheUnreadFilter(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibrarySuggestionsFixture(t, clock)

	cursor := libraryFirstCursor(t, fixture.handler, "?view=suggestions&unread=true&limit=2")
	refused := doLibraryRequest(t, fixture.handler, http.MethodGet,
		"/api/library/items?view=suggestions&unread=false&limit=2&cursor="+cursor, nil)
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("an unread=true cursor under unread=false = %d, want 400 (%q)",
			refused.Code, refused.Body.String())
	}
	libraryRequireErrorEnvelope(t, refused, "invalid_cursor")
}

// TestLibrarySuggestionsViewWithNothingInFocus proves the view still answers
// when no subject is flagged: every score is 0, so the order is the saved one.
func TestLibrarySuggestionsViewWithNothingInFocus(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	saved := []string{}
	for i := range 3 {
		clock.Advance(time.Minute)
		saved = append(saved, librarySaveOne(t, service, fmt.Sprintf("https://example.org/unfocused-%d", i), "").ID)
	}
	got := libraryListIDs(t, handler, "?view=suggestions&limit=50")
	want := []string{saved[2], saved[1], saved[0]}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("view=suggestions with nothing in focus listed %v, want the saved order %v", got, want)
	}
}

// TestLibrarySuggestionsViewWithoutTheFocusServiceRefuses proves a process
// assembled without the focus answers 503 rather than an unranked list under
// the ranked view's name.
func TestLibrarySuggestionsViewWithoutTheFocusServiceRefuses(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := NewLibraryService(database,
		core.NewFiles(dataDir, database.Writer(), clock),
		core.NewJobs(database.Writer(), clock, nil),
		clock)

	_, err := service.List(context.Background(), ListInput{View: LibraryViewSuggestions})
	var domain *LibraryError
	if !errors.As(err, &domain) {
		t.Fatalf("listing view=suggestions with no focus service gave %v, want a domain error", err)
	}
	if domain.Status != http.StatusServiceUnavailable || domain.Code != "no_focus" {
		t.Fatalf("the refusal is %d/%s, want 503/no_focus", domain.Status, domain.Code)
	}
}
