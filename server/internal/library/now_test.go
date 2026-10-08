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

// newLibraryFocusFixture saves v, w, z, y, x in that order -- so x is the
// newest and v the oldest -- and links each the way the bead's first criterion
// describes.
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

// TestLibraryNowViewRanksByTheFocusScore is the bead's first criterion: the
// order is the one the weights compute by hand -- 1.0 for the confirmed link,
// the recorded confidence for the suggestion, half a point for a suggestion
// with none, nothing for the rejected one -- and the two unscored items follow
// in saved order.
func TestLibraryNowViewRanksByTheFocusScore(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=now&limit=50"))
	want := []string{"x", "y", "z", "w", "v"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("view=now ordered %v, want %v", got, want)
	}
}

// TestLibraryNowViewLeavesOutReadItems is the second criterion on the list
// side: marking the top-ranked item read takes it out of the view entirely
// rather than moving it down.
func TestLibraryNowViewLeavesOutReadItems(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	read := false
	if _, err := fixture.service.Patch(context.Background(), fixture.ids["x"],
		PatchInput{Unread: &read}); err != nil {
		t.Fatalf("marking x read: %v", err)
	}
	got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=now&limit=50"))
	want := []string{"y", "z", "w", "v"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("view=now after marking x read listed %v, want %v", got, want)
	}
}

// TestLibraryNowViewPaginatesAndBindsItsCursor is the third criterion: three
// pages of two under limit=2 with nothing repeated and nothing lost, and the
// cursor refused the moment it is presented under another view.
func TestLibraryNowViewPaginatesAndBindsItsCursor(t *testing.T) {
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

	paged := []string{}
	cursor := ""
	firstCursor := ""
	for pages := 0; ; pages++ {
		if pages > 4 {
			t.Fatal("the now view's pagination did not terminate")
		}
		path := "/api/library/items?view=now&limit=2"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		response := doLibraryRequest(t, fixture.handler, http.MethodGet, path, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s = %d (%q)", path, response.Code, response.Body.String())
		}
		var page map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatalf("the page is not JSON: %v", err)
		}
		items, _ := page["items"].([]any)
		for _, entry := range items {
			paged = append(paged, entry.(map[string]any)["id"].(string))
		}
		next, _ := page["next_cursor"].(string)
		if firstCursor == "" {
			firstCursor = next
		}
		if next == "" {
			break
		}
		cursor = next
	}
	got := fixture.letters(paged)
	want := []string{"x", "y", "z", "w", "v", "u"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("paged view=now gave %v, want %v", got, want)
	}
	if len(paged) != len(want) {
		t.Fatalf("the pages hold %d items, want %d", len(paged), len(want))
	}

	refused := doLibraryRequest(t, fixture.handler, http.MethodGet,
		"/api/library/items?view=tudo&limit=2&cursor="+firstCursor, nil)
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("a now cursor under view=tudo = %d, want 400 (%q)", refused.Code, refused.Body.String())
	}
	libraryRequireErrorEnvelope(t, refused, "invalid_cursor")
}

// TestLibraryNowViewRefusesASecondOrder proves the three parameters that would
// ask the now view for an order it does not have, or for items it exists to
// leave out, are refused rather than quietly dropped.
func TestLibraryNowViewRefusesASecondOrder(t *testing.T) {
	clock := libraryTestClock()
	fixture := newLibraryFocusFixture(t, clock)

	for _, query := range []string{"?view=now&q=focus", "?view=now&sort=title", "?view=now&unread=false"} {
		response := doLibraryRequest(t, fixture.handler, http.MethodGet, "/api/library/items"+query, nil)
		if response.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400 (%q)", query, response.Code, response.Body.String())
			continue
		}
		libraryRequireErrorEnvelope(t, response, "invalid_request")
	}

	// unread=true is the view's own filter spelled out, not a conflict.
	if got := fixture.letters(libraryListIDs(t, fixture.handler, "?view=now&unread=true&limit=50")); len(got) != 5 {
		t.Errorf("view=now&unread=true listed %v, want all five", got)
	}
}

// TestLibraryNowViewWithNothingInFocus proves the view still answers when no
// subject is flagged: every score is 0, so the order is the saved one.
func TestLibraryNowViewWithNothingInFocus(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	saved := []string{}
	for i := range 3 {
		clock.Advance(time.Minute)
		saved = append(saved, librarySaveOne(t, service, fmt.Sprintf("https://example.org/unfocused-%d", i), "").ID)
	}
	got := libraryListIDs(t, handler, "?view=now&limit=50")
	want := []string{saved[2], saved[1], saved[0]}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("view=now with nothing in focus listed %v, want the saved order %v", got, want)
	}
}

// TestLibraryNowViewWithoutTheFocusServiceRefuses proves a process assembled
// without the focus answers 503 rather than an unranked list under the ranked
// view's name.
func TestLibraryNowViewWithoutTheFocusServiceRefuses(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	service := NewLibraryService(database,
		core.NewFiles(dataDir, database.Writer(), clock),
		core.NewJobs(database.Writer(), clock, nil),
		clock)

	_, err := service.List(context.Background(), ListInput{View: LibraryViewNow})
	var domain *LibraryError
	if !errors.As(err, &domain) {
		t.Fatalf("listing view=now with no focus service gave %v, want a domain error", err)
	}
	if domain.Status != http.StatusServiceUnavailable || domain.Code != "no_focus" {
		t.Fatalf("the refusal is %d/%s, want 503/no_focus", domain.Status, domain.Code)
	}
}
