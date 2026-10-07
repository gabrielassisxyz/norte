package library

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// openLibraryDBAt opens the database at dataDir, migrates it idempotently and
// closes it through the shutdown path when the test ends.
func openLibraryDBAt(t *testing.T, dataDir string, clock core.Clock) *core.Database {
	t.Helper()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	return database
}

func libraryPostSave(t *testing.T, handler http.Handler, body map[string]any) (int, map[string]any) {
	t.Helper()
	response := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items", body)
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the save answer is not JSON: %v (%q)", err, response.Body.String())
	}
	return response.Code, decoded
}

func libraryGetList(t *testing.T, handler http.Handler, query string) (int, map[string]any) {
	t.Helper()
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items"+query, nil)
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the list answer is not JSON: %v (%q)", err, response.Body.String())
	}
	return response.Code, decoded
}

func libraryListIDs(t *testing.T, handler http.Handler, query string) []string {
	t.Helper()
	status, decoded := libraryGetList(t, handler, query)
	if status != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200 (%v)", query, status, decoded)
	}
	items, _ := decoded["items"].([]any)
	ids := make([]string, 0, len(items))
	for _, item := range items {
		id, _ := item.(map[string]any)["id"].(string)
		ids = append(ids, id)
	}
	return ids
}

func libraryFreshCLIDir(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "share", "norte")
}

// TestLibraryCLISaveAppearsInViewsWithCounts is the done-when path through
// the command line: one save, visible in inbox, tudo, tipo=post and
// unread=true, with counts to match.
func TestLibraryCLISaveAppearsInViewsWithCounts(t *testing.T) {
	dataDir := libraryFreshCLIDir(t)
	out, err := runLibraryCLI(t, dataDir, "save", "https://example.org/a?utm_source=x#top", "--why", "w1")
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, out)
	}
	id := strings.TrimSpace(out)
	if id == "" {
		t.Fatalf("norte save printed no id:\n%s", out)
	}

	clock := libraryTestClock()
	database := openLibraryDBAt(t, dataDir, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	for _, query := range []string{"?view=inbox", "?view=tudo", "?tipo=post", "?unread=true"} {
		ids := libraryListIDs(t, handler, query)
		if len(ids) != 1 || ids[0] != id {
			t.Errorf("GET %s = %v, want [%s]", query, ids, id)
		}
	}
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/counts", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("GET /api/library/counts = %d (%q)", response.Code, response.Body.String())
	}
	var counts map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &counts); err != nil {
		t.Fatalf("the counts answer is not JSON: %v", err)
	}
	views := counts["views"].(map[string]any)
	for _, view := range []string{"inbox", "tudo"} {
		if views[view] != 1.0 {
			t.Errorf("counts.views.%s = %v, want 1 (%v)", view, views[view], counts)
		}
	}
	if counts["unread"] != 1.0 {
		t.Errorf("counts.unread = %v, want 1 (%v)", counts["unread"], counts)
	}
}

// TestLibraryDuplicateSaveReturnsSameID saves one URL twice -- once through
// the API with a differently-cased host, once through the CLI -- and proves
// both answers carry the first id with the newest note.
func TestLibraryDuplicateSaveReturnsSameID(t *testing.T) {
	dataDir := libraryFreshCLIDir(t)
	first, err := runLibraryCLI(t, dataDir, "save", "https://example.org/a?utm_source=x#top", "--why", "w1")
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, first)
	}
	firstID := strings.TrimSpace(first)

	clock := libraryTestClock()
	database := openLibraryDBAt(t, dataDir, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	status, body := libraryPostSave(t, handler, map[string]any{
		"url": "https://EXAMPLE.org/a",
		"why": "w2",
	})
	if status != http.StatusOK {
		t.Fatalf("the duplicate POST = %d, want 200 (%v)", status, body)
	}
	if body["id"] != firstID {
		t.Errorf("the duplicate POST id = %v, want %s", body["id"], firstID)
	}

	second, err := runLibraryCLI(t, dataDir, "save", "https://example.org/a", "--why", "w2")
	if err != nil {
		t.Fatalf("the duplicate norte save: %v\n%s", err, second)
	}
	if strings.TrimSpace(second) != firstID {
		t.Errorf("the duplicate norte save printed %q, want %s", strings.TrimSpace(second), firstID)
	}

	detail := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/"+firstID, nil)
	if detail.Code != http.StatusOK {
		t.Fatalf("GET the item = %d (%q)", detail.Code, detail.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(detail.Body.Bytes(), &item); err != nil {
		t.Fatalf("the detail answer is not JSON: %v", err)
	}
	if item["why"] != "w2" {
		t.Errorf("why = %v, want w2", item["why"])
	}
}

// TestLibrarySourcesRecorded proves a save starts as a post whatever the
// adapter, and that the source names the adapter: the dialog, the extension,
// the CLI and Telegram.
func TestLibrarySourcesRecorded(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	status, appBody := libraryPostSave(t, handler, map[string]any{"url": "https://example.org/app"})
	if status != http.StatusCreated {
		t.Fatalf("the dialog save = %d, want 201 (%v)", status, appBody)
	}
	status, extBody := libraryPostSave(t, handler, map[string]any{
		"url": "https://example.org/extension", "source": "extension",
	})
	if status != http.StatusCreated {
		t.Fatalf("the extension save = %d, want 201 (%v)", status, extBody)
	}
	telegram, err := service.Save(context.Background(), SaveInput{
		URL: "https://example.org/telegram", Source: LibrarySourceTelegram,
	})
	if err != nil {
		t.Fatalf("the telegram save: %v", err)
	}
	cliDir := libraryFreshCLIDir(t)
	cliOut, err := runLibraryCLI(t, cliDir, "save", "https://example.org/cli")
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, cliOut)
	}

	// A request carrying any source but the extension's is refused.
	refused := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items",
		map[string]any{"url": "https://example.org/nope", "source": "cli"})
	if refused.Code != http.StatusBadRequest {
		t.Errorf("a save carrying source cli = %d, want 400 (%q)", refused.Code, refused.Body.String())
	}

	wantSource := map[string]string{
		appBody["id"].(string):    "app",
		extBody["id"].(string):    "extension",
		telegram.ID:               "telegram",
		strings.TrimSpace(cliOut): "cli",
	}
	cliDatabase := openLibraryDBAt(t, cliDir, clock)
	for id, want := range wantSource {
		reader := database.Reader()
		if strings.HasPrefix(want, "cli") {
			reader = cliDatabase.Reader()
		}
		var kind, source string
		if err := reader.QueryRow(
			`SELECT kind, source FROM library_items WHERE id = ?`, id).Scan(&kind, &source); err != nil {
			t.Fatalf("reading %s: %v", id, err)
		}
		if kind != "post" {
			t.Errorf("a new item has kind %q, want post", kind)
		}
		if source != want {
			t.Errorf("source = %q, want %q", source, want)
		}
	}
}

// TestLibraryLinksCreatedAtomically proves one save with two targets creates
// two confirmed about links, a repeated id creates one, and an unknown id
// refuses the whole save.
func TestLibraryLinksCreatedAtomically(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	first := librarySaveOne(t, service, "https://example.org/target-a", "")
	second := librarySaveOne(t, service, "https://example.org/target-b", "")
	before := libraryCountRows(t, service, `SELECT count(*) FROM library_items`)

	status, body := libraryPostSave(t, handler, map[string]any{
		"url":     "https://example.org/linked",
		"link_to": []string{first.ID, second.ID},
	})
	if status != http.StatusCreated {
		t.Fatalf("the linked save = %d, want 201 (%v)", status, body)
	}
	id := body["id"].(string)
	var links int
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_links WHERE src_id = ? AND kind = 'about' AND status = 'confirmed'`,
		id).Scan(&links); err != nil {
		t.Fatalf("counting the links: %v", err)
	}
	if links != 2 {
		t.Errorf("the save created %d confirmed about links, want 2", links)
	}

	status, repeatedBody := libraryPostSave(t, handler, map[string]any{
		"url":     "https://example.org/repeated",
		"link_to": []string{first.ID, first.ID},
	})
	if status != http.StatusCreated {
		t.Fatalf("the repeated-link save = %d, want 201 (%v)", status, repeatedBody)
	}
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_links WHERE src_id = ? AND kind = 'about'`,
		repeatedBody["id"].(string)).Scan(&links); err != nil {
		t.Fatalf("counting the repeated links: %v", err)
	}
	if links != 1 {
		t.Errorf("a repeated link id created %d links, want 1", links)
	}

	unknown := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items",
		map[string]any{"url": "https://example.org/unknown-link", "link_to": []string{"no-such-id"}})
	if unknown.Code != http.StatusBadRequest {
		t.Errorf("an unknown link target = %d, want 400 (%q)", unknown.Code, unknown.Body.String())
	}
	if got := libraryCountRows(t, service, `SELECT count(*) FROM library_items`); got != before+2 {
		t.Errorf("library_items holds %d rows, want %d: the refused save left a row behind", got, before+2)
	}
}

// TestLibraryInvalidURLsChangeNothing proves every malformed, relative,
// wrong-scheme or credential-bearing URL is refused without touching any
// table or the file store.
func TestLibraryInvalidURLsChangeNothing(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	counts := func() (items, registry, blobs, files int) {
		service := newLibraryTestService(t, database, dataDir, clock)
		items = libraryCountRows(t, service, `SELECT count(*) FROM library_items`)
		registry = libraryCountRows(t, service, `SELECT count(*) FROM core_items`)
		blobs = libraryCountRows(t, service, `SELECT count(*) FROM core_files`)
		entries, err := os.ReadDir(filepath.Join(dataDir, "files"))
		if err != nil && !os.IsNotExist(err) {
			t.Fatalf("listing the file store: %v", err)
		}
		files = len(entries)
		return items, registry, blobs, files
	}
	before := [4]int{}
	{
		a, b, c, d := counts()
		before = [4]int{a, b, c, d}
	}
	bad := []string{
		"relative/path",
		"https://",
		"::::",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"https://user:pass@example.org/",
		"https://user@example.org/",
	}
	for _, raw := range bad {
		response := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items",
			map[string]any{"url": raw})
		if response.Code != http.StatusBadRequest {
			t.Errorf("POST %q = %d, want 400 (%q)", raw, response.Code, response.Body.String())
		}
		if _, err := runLibraryCLI(t, libraryFreshCLIDir(t), "save", raw); err == nil {
			t.Errorf("norte save %q succeeded, want a failure", raw)
		}
	}
	a, b, c, d := counts()
	if after := [4]int{a, b, c, d}; after != before {
		t.Errorf("the refused saves changed (items, registry, blobs, files) from %v to %v", before, after)
	}
}

// TestLibraryExtensionSnapshotWins proves a CLI snapshot is replaced by the
// extension's, and that a later duplicate without HTML keeps it.
func TestLibraryExtensionSnapshotWins(t *testing.T) {
	dataDir := libraryFreshCLIDir(t)
	htmlFile := filepath.Join(t.TempDir(), "page.html")
	if err := os.WriteFile(htmlFile, []byte("<html>cli version</html>"), 0o600); err != nil {
		t.Fatalf("writing the HTML fixture: %v", err)
	}
	first, err := runLibraryCLI(t, dataDir, "save", "https://example.org/snap", "--html", htmlFile)
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, first)
	}
	id := strings.TrimSpace(first)

	clock := libraryTestClock()
	database := openLibraryDBAt(t, dataDir, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	readSnapshot := func() (hash, source string, generation int) {
		t.Helper()
		var meta string
		var hashNull string
		var gen int
		if err := database.Reader().QueryRow(
			`SELECT html_hash, meta, extract_generation FROM library_items WHERE id = ?`, id).
			Scan(&hashNull, &meta, &gen); err != nil {
			t.Fatalf("reading the snapshot: %v", err)
		}
		var decoded map[string]any
		if err := json.Unmarshal([]byte(meta), &decoded); err != nil {
			t.Fatalf("the meta is not JSON: %v", err)
		}
		captured, _ := decoded["snapshot_source"].(string)
		return hashNull, captured, gen
	}
	if _, source, _ := readSnapshot(); source != "cli" {
		t.Fatalf("snapshot_source = %q, want cli", source)
	}

	status, _ := libraryPostSave(t, handler, map[string]any{
		"url": "https://example.org/snap", "source": "extension",
		"html": "<html>extension version</html>",
	})
	if status != http.StatusOK {
		t.Fatalf("the extension duplicate did not answer 200")
	}
	hash, source, generation := readSnapshot()
	if source != "extension" {
		t.Errorf("snapshot_source = %q, want extension", source)
	}
	if hash == "" {
		t.Error("the extension duplicate left no snapshot hash")
	}

	status, _ = libraryPostSave(t, handler, map[string]any{
		"url": "https://example.org/snap", "why": "later note",
	})
	if status != http.StatusOK {
		t.Fatalf("the later duplicate did not answer 200")
	}
	keptHash, keptSource, keptGeneration := readSnapshot()
	if keptHash != hash || keptSource != "extension" {
		t.Errorf("a duplicate without HTML replaced the extension snapshot: %q/%q", keptHash, keptSource)
	}
	if keptGeneration != generation {
		t.Errorf("a duplicate without HTML moved the generation from %d to %d", generation, keptGeneration)
	}
}

// TestLibrarySnapshotReplaceLeavesOneRefAndGCCollects proves a replaced
// snapshot leaves exactly one snapshot reference, and the old blob becomes
// collectable once past the grace period.
func TestLibrarySnapshotReplaceLeavesOneRefAndGCCollects(t *testing.T) {
	dataDir := libraryFreshCLIDir(t)
	firstHTML := filepath.Join(t.TempDir(), "first.html")
	if err := os.WriteFile(firstHTML, []byte("<html>first</html>"), 0o600); err != nil {
		t.Fatalf("writing the fixture: %v", err)
	}
	first, err := runLibraryCLI(t, dataDir, "save", "https://example.org/replace", "--html", firstHTML)
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, first)
	}
	id := strings.TrimSpace(first)

	clock := libraryTestClock()
	database := openLibraryDBAt(t, dataDir, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	var oldHash string
	if err := database.Reader().QueryRow(
		`SELECT html_hash FROM library_items WHERE id = ?`, id).Scan(&oldHash); err != nil {
		t.Fatalf("reading the first hash: %v", err)
	}
	status, _ := libraryPostSave(t, handler, map[string]any{
		"url": "https://example.org/replace", "html": "<html>second</html>",
	})
	if status != http.StatusOK {
		t.Fatalf("the replacing duplicate did not answer 200")
	}
	var refs int
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_file_refs WHERE owner_id = ? AND kind = 'snapshot'`, id).Scan(&refs); err != nil {
		t.Fatalf("counting the snapshot references: %v", err)
	}
	if refs != 1 {
		t.Errorf("%d snapshot references remain, want exactly 1", refs)
	}
	var newHash string
	if err := database.Reader().QueryRow(
		`SELECT html_hash FROM library_items WHERE id = ?`, id).Scan(&newHash); err != nil {
		t.Fatalf("reading the second hash: %v", err)
	}
	if newHash == oldHash {
		t.Fatal("the snapshot hash did not change on replacement")
	}

	past := core.FormatTime(time.Now().Add(-2 * time.Hour))
	if _, err := database.Writer().Exec(
		`UPDATE core_files SET created_at = ? WHERE hash = ?`, past, oldHash); err != nil {
		t.Fatalf("back-dating the old blob: %v", err)
	}
	store := core.NewFiles(dataDir, database.Writer(), core.SystemClock())
	collected, err := store.CollectGarbage(context.Background())
	if err != nil {
		t.Fatalf("collecting garbage: %v", err)
	}
	if collected.Removed != 1 {
		t.Errorf("gc removed %d blobs, want the one old snapshot", collected.Removed)
	}
	if _, err := os.Stat(store.Path(oldHash)); !os.IsNotExist(err) {
		t.Errorf("the old blob survived gc (stat: %v)", err)
	}
	if _, err := os.Stat(store.Path(newHash)); err != nil {
		t.Errorf("the current blob did not survive gc: %v", err)
	}
}

// TestLibraryFTSPaginationFollowsRank proves two pages of a text query follow
// the bm25 order with no duplicates, and that q with an explicit sort is
// refused.
func TestLibraryFTSPaginationFollowsRank(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	for i := 0; i < 60; i++ {
		librarySaveOne(t, service, fmt.Sprintf("https://example.org/fts-%d", i), fmt.Sprintf("sharedword note %d", i))
	}
	oneShot := libraryListIDs(t, handler, "?q=sharedword&limit=200")
	if len(oneShot) != 60 {
		t.Fatalf("one shot found %d items, want 60", len(oneShot))
	}
	first := libraryListIDs(t, handler, "?q=sharedword&limit=50")
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items?q=sharedword&limit=50", nil)
	var page map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatalf("the page is not JSON: %v", err)
	}
	cursor, _ := page["next_cursor"].(string)
	if cursor == "" {
		t.Fatal("the first of two pages carries no next_cursor")
	}
	second := libraryListIDs(t, handler, "?q=sharedword&limit=50&cursor="+cursor)
	if len(first) != 50 || len(second) != 10 {
		t.Fatalf("the pages hold %d and %d items, want 50 and 10", len(first), len(second))
	}
	paged := append(append([]string{}, first...), second...)
	seen := map[string]bool{}
	for _, id := range paged {
		if seen[id] {
			t.Fatalf("the pages repeat %s", id)
		}
		seen[id] = true
	}
	for i, id := range paged {
		if id != oneShot[i] {
			t.Fatalf("paged order diverges from the rank order at %d", i)
		}
	}

	refused := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items?q=sharedword&sort=title", nil)
	if refused.Code != http.StatusBadRequest {
		t.Errorf("q with sort=title = %d, want 400 (%q)", refused.Code, refused.Body.String())
	}
}

// TestLibraryConcurrentSavesDedupe proves two simultaneous saves of one URL
// leave exactly one row with both answers carrying its id.
func TestLibraryConcurrentSavesDedupe(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	type answer struct {
		status int
		id     string
	}
	answers := make([]answer, 2)
	var wg sync.WaitGroup
	for i := range answers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, body := libraryPostSave(t, handler, map[string]any{"url": "https://example.org/race"})
			answers[i] = answer{status: status, id: fmt.Sprint(body["id"])}
		}(i)
	}
	wg.Wait()
	for _, a := range answers {
		if a.status != http.StatusCreated && a.status != http.StatusOK {
			t.Fatalf("a concurrent save answered %d, want 200 or 201", a.status)
		}
	}
	if answers[0].id != answers[1].id {
		t.Fatalf("the concurrent saves answered %q and %q, want one id", answers[0].id, answers[1].id)
	}
	var rows int
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM library_items`).Scan(&rows); err != nil {
		t.Fatalf("counting the items: %v", err)
	}
	if rows != 1 {
		t.Errorf("the concurrent saves left %d rows, want 1", rows)
	}
}

// TestLibraryWhyUpdateIsSearchable proves patching the note rewrites the
// index: found by the new word, gone by the old one.
func TestLibraryWhyUpdateIsSearchable(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/why", "zebra")

	patch := func(why string) {
		t.Helper()
		response := doLibraryRequest(t, handler, http.MethodPatch, "/api/library/items/"+outcome.ID,
			map[string]any{"why": why})
		if response.Code != http.StatusOK {
			t.Fatalf("PATCH why = %d (%q)", response.Code, response.Body.String())
		}
	}
	patch("zebra")
	if ids := libraryListIDs(t, handler, "?q=zebra"); len(ids) != 1 || ids[0] != outcome.ID {
		t.Errorf("q=zebra found %v, want [%s]", ids, outcome.ID)
	}
	patch("other")
	if ids := libraryListIDs(t, handler, "?q=zebra"); len(ids) != 0 {
		t.Errorf("q=zebra still finds %v after the note changed", ids)
	}
}

// TestLibrarySaveWithHTMLCommitsTogether proves a save with HTML stores one
// blob, one snapshot reference and the hash, with the item, its registry row,
// its links and one extract job committed together.
func TestLibrarySaveWithHTMLCommitsTogether(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	target := librarySaveOne(t, service, "https://example.org/about-target", "")

	status, body := libraryPostSave(t, handler, map[string]any{
		"url":     "https://example.org/with-html",
		"title":   "A page",
		"html":    "<html>snapshot</html>",
		"link_to": []string{target.ID},
	})
	if status != http.StatusCreated {
		t.Fatalf("the save = %d, want 201 (%v)", status, body)
	}
	id := body["id"].(string)

	var hash string
	var refs, registry int
	var generation int
	var payload string
	var dedupe *string
	if err := database.Reader().QueryRow(
		`SELECT html_hash, extract_generation FROM library_items WHERE id = ?`, id).Scan(&hash, &generation); err != nil {
		t.Fatalf("reading the item: %v", err)
	}
	if hash == "" {
		t.Error("html_hash is empty after a save with HTML")
	}
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_file_refs WHERE owner_id = ? AND kind = 'snapshot' AND hash = ?`,
		id, hash).Scan(&refs); err != nil || refs != 1 {
		t.Errorf("snapshot references = %d, want 1 (%v)", refs, err)
	}
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_items WHERE id = ?`, id).Scan(&registry); err != nil || registry != 1 {
		t.Errorf("registry rows = %d, want 1 (%v)", registry, err)
	}
	var kind string
	if err := database.Reader().QueryRow(
		`SELECT kind, payload, dedupe_key FROM core_jobs WHERE dedupe_key = ?`, "extract:"+id+":1").Scan(&kind, &payload, &dedupe); err != nil {
		t.Fatalf("reading the extract job: %v", err)
	}
	var decoded struct {
		ItemID     string `json:"item_id"`
		Generation int    `json:"generation"`
		Refresh    bool   `json:"refresh"`
	}
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatalf("the job payload is not JSON: %v", err)
	}
	if decoded.ItemID != id || decoded.Generation != 1 || decoded.Refresh {
		t.Errorf("the job payload = %+v, want this item at generation 1 without refresh", decoded)
	}
	if dedupe == nil || *dedupe != "extract:"+id+":1" {
		t.Errorf("the job dedupe key = %v, want extract:%s:1", dedupe, id)
	}
	var linkRows int
	if err := database.Reader().QueryRow(
		`SELECT count(*) FROM core_links WHERE src_id = ? AND dst_id = ? AND kind = 'about' AND status = 'confirmed'`,
		id, target.ID).Scan(&linkRows); err != nil || linkRows != 1 {
		t.Errorf("confirmed about links = %d, want 1 (%v)", linkRows, err)
	}
	if generation != 1 {
		t.Errorf("extract_generation = %d, want 1", generation)
	}
}

// TestLibraryOpenAndRead proves unread=false stamps the read event,
// unread=true clears it, and opening stamps last_opened_at without touching
// unread.
func TestLibraryOpenAndRead(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/open", "")

	patch := func(body map[string]any) map[string]any {
		t.Helper()
		response := doLibraryRequest(t, handler, http.MethodPatch, "/api/library/items/"+outcome.ID, body)
		if response.Code != http.StatusOK {
			t.Fatalf("PATCH %v = %d (%q)", body, response.Code, response.Body.String())
		}
		var decoded map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("the patch answer is not JSON: %v", err)
		}
		return decoded
	}
	if got := patch(map[string]any{"unread": false}); got["read_at"] == nil {
		t.Errorf("PATCH unread=false left read_at absent (%v)", got)
	}
	if got := patch(map[string]any{"unread": true}); got["read_at"] != nil {
		t.Errorf("PATCH unread=true left read_at = %v, want absent", got["read_at"])
	}
	opened := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items/"+outcome.ID+"/open", nil)
	if opened.Code != http.StatusOK {
		t.Fatalf("POST open = %d (%q)", opened.Code, opened.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(opened.Body.Bytes(), &item); err != nil {
		t.Fatalf("the open answer is not JSON: %v", err)
	}
	if item["last_opened_at"] == nil {
		t.Errorf("open left last_opened_at absent (%v)", item)
	}
	if item["unread"] != true {
		t.Errorf("open changed unread to %v, want it untouched", item["unread"])
	}
}

// TestLibraryPatchTitleAndKindFollowRegistry proves retitling marks the title
// edited and follows the registry row, and retyping follows the registry type.
func TestLibraryPatchTitleAndKindFollowRegistry(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/rename", "")

	response := doLibraryRequest(t, handler, http.MethodPatch, "/api/library/items/"+outcome.ID,
		map[string]any{"title": "My own title", "kind": "livro"})
	if response.Code != http.StatusOK {
		t.Fatalf("PATCH = %d (%q)", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatalf("the patch answer is not JSON: %v", err)
	}
	if item["title"] != "My own title" || item["title_edited"] != true {
		t.Errorf("the patched item = %v, want the new title marked edited", item)
	}
	var title, itemType string
	if err := database.Reader().QueryRow(
		`SELECT title, type FROM core_items WHERE id = ?`, outcome.ID).Scan(&title, &itemType); err != nil {
		t.Fatalf("reading the registry row: %v", err)
	}
	if title != "My own title" || itemType != "livro" {
		t.Errorf("the registry row is %q/%q, want My own title/livro", title, itemType)
	}
}

// TestLibraryCursorPagination120 proves three pages of 50, 50 and 20 hold
// every item exactly once, and a cursor from one view is refused in another.
func TestLibraryCursorPagination120(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	for i := 0; i < 120; i++ {
		clock.Advance(time.Millisecond)
		librarySaveOne(t, service, fmt.Sprintf("https://example.org/page-%d", i), "")
	}
	pages := [][]string{}
	cursor := ""
	for {
		path := "?view=tudo&limit=50"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items"+path, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s = %d (%q)", path, response.Code, response.Body.String())
		}
		var page map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatalf("the page is not JSON: %v", err)
		}
		items, _ := page["items"].([]any)
		ids := make([]string, 0, len(items))
		for _, entry := range items {
			ids = append(ids, entry.(map[string]any)["id"].(string))
		}
		pages = append(pages, ids)
		next, _ := page["next_cursor"].(string)
		if next == "" {
			break
		}
		cursor = next
		if len(pages) > 5 {
			t.Fatal("pagination did not terminate")
		}
	}
	if len(pages) != 3 || len(pages[0]) != 50 || len(pages[1]) != 50 || len(pages[2]) != 20 {
		sizes := make([]int, len(pages))
		for i, page := range pages {
			sizes[i] = len(page)
		}
		t.Fatalf("the page sizes are %v, want [50 50 20]", sizes)
	}
	seen := map[string]bool{}
	for _, page := range pages {
		for _, id := range page {
			if seen[id] {
				t.Fatalf("pagination repeats %s", id)
			}
			seen[id] = true
		}
	}
	if len(seen) != 120 {
		t.Fatalf("pagination covered %d items, want 120", len(seen))
	}

	first := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items?view=inbox&limit=50", nil)
	var inboxPage map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &inboxPage); err != nil {
		t.Fatalf("the inbox page is not JSON: %v", err)
	}
	inboxCursor, _ := inboxPage["next_cursor"].(string)
	if inboxCursor == "" {
		t.Fatal("the inbox page carries no cursor to reuse")
	}
	reused := doLibraryRequest(t, handler, http.MethodGet,
		"/api/library/items?view=tudo&limit=50&cursor="+inboxCursor, nil)
	if reused.Code != http.StatusBadRequest {
		t.Errorf("a cursor reused with another view = %d, want 400 (%q)", reused.Code, reused.Body.String())
	}
}

// TestLibraryLastOpenedSortListsOnlyOpened proves the continuar-lendo order
// holds only opened items, newest-opened first.
func TestLibraryLastOpenedSortListsOnlyOpened(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)

	librarySaveOne(t, service, "https://example.org/never", "")
	older := librarySaveOne(t, service, "https://example.org/older", "")
	newer := librarySaveOne(t, service, "https://example.org/newer", "")

	open := func(id string) {
		t.Helper()
		clock.Advance(time.Second)
		response := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items/"+id+"/open", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("POST open %s = %d", id, response.Code)
		}
	}
	open(older.ID)
	open(newer.ID)

	ids := libraryListIDs(t, handler, "?view=tudo&sort=last_opened_desc")
	if len(ids) != 2 || ids[0] != newer.ID || ids[1] != older.ID {
		t.Errorf("last_opened_desc = %v, want [%s %s]", ids, newer.ID, older.ID)
	}
}

// TestLibraryListOmitsContent proves a list answer never carries the
// extracted HTML or text, even for an item that has a snapshot.
func TestLibraryListOmitsContent(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	status, _ := libraryPostSave(t, handler, map[string]any{
		"url": "https://example.org/snapshot-list", "html": "<html>hi</html>",
	})
	if status != http.StatusCreated {
		t.Fatalf("the save = %d, want 201", status)
	}
	response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items?view=tudo", nil)
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the list is not JSON: %v", err)
	}
	for _, entry := range decoded["items"].([]any) {
		item := entry.(map[string]any)
		for _, banned := range []string{"content_html", "content_text"} {
			if _, ok := item[banned]; ok {
				t.Errorf("a list item carries %q", banned)
			}
		}
	}
	if strings.Contains(response.Body.String(), "content_html") {
		t.Error("the raw list body names content_html")
	}
}

// TestLibraryMigrationDropsTheStub proves the migration that creates the real
// tables also drops the stub module's placeholder.
func TestLibraryMigrationDropsTheStub(t *testing.T) {
	clock := libraryTestClock()
	database, _ := newLibraryTestDB(t, clock)
	rows, err := database.Reader().Query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
	if err != nil {
		t.Fatalf("reading the schema: %v", err)
	}
	defer rows.Close()
	present := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("reading a table name: %v", err)
		}
		present[name] = true
	}
	for _, want := range []string{"library_items", "library_fts"} {
		if !present[want] {
			t.Errorf("%s is missing after the migration", want)
		}
	}
	if present["library_meta"] {
		t.Error("the stub's library_meta survived the migration")
	}
}

// TestLibraryDetailIsARead proves the detail answer carries the record and a
// second read changes nothing.
func TestLibraryDetailIsARead(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	outcome := librarySaveOne(t, service, "https://example.org/detail", "keep me")

	read := func() map[string]any {
		t.Helper()
		response := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/"+outcome.ID, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET the item = %d", response.Code)
		}
		var decoded map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("the detail is not JSON: %v", err)
		}
		return decoded
	}
	first, second := read(), read()
	if first["id"] != outcome.ID || first["why"] != "keep me" || first["canonical_url"] == nil {
		t.Errorf("the detail = %v, want the full record", first)
	}
	if first["updated_at"] != second["updated_at"] {
		t.Errorf("two reads moved updated_at from %v to %v", first["updated_at"], second["updated_at"])
	}
	missing := doLibraryRequest(t, handler, http.MethodGet, "/api/library/items/no-such-id", nil)
	if missing.Code != http.StatusNotFound {
		t.Errorf("an unknown id = %d, want 404", missing.Code)
	}
}

// TestLibraryUnknownPatchAndOpenAre404 refuses writes against nothing.
func TestLibraryUnknownPatchAndOpenAre404(t *testing.T) {
	clock := libraryTestClock()
	database, dataDir := newLibraryTestDB(t, clock)
	handler := newLibraryTestRouter(t, database, dataDir, clock)

	patch := doLibraryRequest(t, handler, http.MethodPatch, "/api/library/items/no-such-id",
		map[string]any{"why": "x"})
	if patch.Code != http.StatusNotFound {
		t.Errorf("PATCH an unknown id = %d, want 404", patch.Code)
	}
	opened := doLibraryRequest(t, handler, http.MethodPost, "/api/library/items/no-such-id/open", nil)
	if opened.Code != http.StatusNotFound {
		t.Errorf("POST open on an unknown id = %d, want 404", opened.Code)
	}
}
