package app_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/library"
)

// subjectsFixedInstant is the deterministic now these tests run on, so an
// assertion about created_at order never depends on how fast the machine is.
var subjectsFixedInstant = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

// subjectsTestEnv is one server's worth of state: the real router with the
// library mounted, the database behind it, and the data directory both sit in.
type subjectsTestEnv struct {
	handler  http.Handler
	database *core.Database
	dataDir  string
	clock    *clocktest.Clock
}

// newSubjectsTestEnv builds the real router the way serve does, over a
// database in a directory of the test's own. Nothing here reads the operator's
// NORTE_DATA: the config is loaded from an explicit map and a temporary home.
func newSubjectsTestEnv(t *testing.T) *subjectsTestEnv {
	t.Helper()
	return newSubjectsTestEnvWith(t, library.NewLibraryModule())
}

// newSubjectsTestEnvWith is the same server with the library module replaced by
// the one given, which is how a test makes a module report focus targets the
// real library never does. The module must still be named "library".
func newSubjectsTestEnvWith(t *testing.T, libraryModule app.Module) *subjectsTestEnv {
	t.Helper()
	dataDir := t.TempDir()
	clock := clocktest.New(subjectsFixedInstant)
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
	modules := []app.Module{libraryModule}
	if _, err := app.MigrateNorteModules(context.Background(), database.Writer(), modules); err != nil {
		t.Fatalf("applying the library migrations: %v", err)
	}
	cfg, _, err := app.Load(app.LoadOptions{
		LookupEnv: envLookupFromMap(map[string]string{"NORTE_MODULES": "library"}),
		Home:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	handler, err := app.NewRouter(app.RouterOptions{
		Config:  cfg,
		Logger:  slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Assets:  fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Norte</title>")}},
		Modules: modules,
		ModuleDeps: app.Deps{
			Database: database,
			Jobs:     core.NewJobs(database.Writer(), clock, nil),
			Files:    core.NewFiles(dataDir, database.Writer(), clock),
			Clock:    clock,
		},
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return &subjectsTestEnv{handler: handler, database: database, dataDir: dataDir, clock: clock}
}

// do sends one JSON request at the test router with an allowed Host.
func (env *subjectsTestEnv) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encoding the request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Host = "localhost:8080"
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	env.handler.ServeHTTP(recorder, request)
	return recorder
}

// decode reads a JSON answer, failing the test when the status is not the one
// expected, with the body in the message.
func decodeSubjectsAnswer[T any](t *testing.T, recorder *httptest.ResponseRecorder, want int) T {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("status = %d, want %d (body %q)", recorder.Code, want, recorder.Body.String())
	}
	var decoded T
	if recorder.Body.Len() == 0 {
		return decoded
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("the body is not the expected JSON: %v (%q)", err, recorder.Body.String())
	}
	return decoded
}

type subjectBody struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Focus     bool   `json:"focus"`
	CreatedAt string `json:"created_at"`
	Counts    struct {
		Total  int `json:"total"`
		ByType []struct {
			Module string `json:"module"`
			Type   string `json:"type"`
			Count  int    `json:"count"`
		} `json:"by_type"`
	} `json:"counts"`
	LinkCount int `json:"link_count"`
}

type subjectListBody struct {
	Items      []subjectBody `json:"items"`
	NextCursor string        `json:"next_cursor"`
}

type linkBody struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Source     string   `json:"source"`
	Status     string   `json:"status"`
	Confidence *float64 `json:"confidence"`
	CreatedAt  string   `json:"created_at"`
	DecidedAt  *string  `json:"decided_at"`
	Src       struct {
		ID     string `json:"id"`
		Module string `json:"module"`
		Type   string `json:"type"`
		Title  string `json:"title"`
	} `json:"src"`
	Dst struct {
		ID    string `json:"id"`
		Type  string `json:"type"`
		Title string `json:"title"`
	} `json:"dst"`
}

type linkListBody struct {
	Items      []linkBody `json:"items"`
	NextCursor string     `json:"next_cursor"`
}

type focusBody struct {
	Subjects []subjectBody `json:"subjects"`
	Targets  []struct {
		ID    string `json:"id"`
		Type  string `json:"type"`
		Title string `json:"title"`
	} `json:"targets"`
}

// createSubject posts one subject and answers with it.
func (env *subjectsTestEnv) createSubject(t *testing.T, name string) subjectBody {
	t.Helper()
	return decodeSubjectsAnswer[subjectBody](t,
		env.do(t, http.MethodPost, "/api/core/subjects", map[string]any{"name": name}), http.StatusCreated)
}

// saveLink saves one library item, optionally linked to the registry ids
// given, and answers with its id.
func (env *subjectsTestEnv) saveLink(t *testing.T, url, title string, linkTo ...string) string {
	t.Helper()
	body := map[string]any{"url": url, "title": title}
	if len(linkTo) > 0 {
		body["link_to"] = linkTo
	}
	recorder := env.do(t, http.MethodPost, "/api/library/items", body)
	saved := decodeSubjectsAnswer[struct {
		ID string `json:"id"`
	}](t, recorder, http.StatusCreated)
	return saved.ID
}

// retypeItem sets a saved item's kind, which is what makes its registry type
// something other than "post" -- the per-kind counts are grouped by that type.
func (env *subjectsTestEnv) retypeItem(t *testing.T, id, kind string) {
	t.Helper()
	recorder := env.do(t, http.MethodPatch, "/api/library/items/"+id, map[string]any{"kind": kind})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PATCH kind = %d, want 200 (body %q)", recorder.Code, recorder.Body.String())
	}
}

// --- Criterion: creating a subject derives its slug and registers it ---

func TestCreateSubjectDerivesSlugAndRegistersTheItem(t *testing.T) {
	env := newSubjectsTestEnv(t)

	created := env.createSubject(t, "Machine Learning")
	if created.Slug != "machine-learning" {
		t.Errorf("slug = %q, want machine-learning", created.Slug)
	}
	if created.Name != "Machine Learning" {
		t.Errorf("name = %q, want Machine Learning", created.Name)
	}
	if created.Focus {
		t.Error("a new subject is not a focus unless it was asked for")
	}

	var module, itemType, url string
	err := env.database.Reader().QueryRow(
		`SELECT module, type, url FROM core_items WHERE id = ?`, created.ID).Scan(&module, &itemType, &url)
	if err != nil {
		t.Fatalf("the subject has no registry row: %v", err)
	}
	if module != "core" || itemType != "subject" {
		t.Errorf("registry row = (%q, %q), want (core, subject)", module, itemType)
	}
	if url != "/assuntos/machine-learning" {
		t.Errorf("registry url = %q, want /assuntos/machine-learning", url)
	}
}

func TestCreateSubjectRefusesATakenSlug(t *testing.T) {
	env := newSubjectsTestEnv(t)
	env.createSubject(t, "Machine Learning")

	recorder := env.do(t, http.MethodPost, "/api/core/subjects", map[string]any{"name": "Machine Learning"})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("a second subject with the same name = %d, want 409 (body %q)",
			recorder.Code, recorder.Body.String())
	}

	// The accented spelling derives the same slug, so it is the same conflict:
	// that is the whole point of deriving the slug rather than storing one.
	recorder = env.do(t, http.MethodPost, "/api/core/subjects", map[string]any{"name": "Machine  Learning!"})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("a differently punctuated duplicate = %d, want 409 (body %q)",
			recorder.Code, recorder.Body.String())
	}
}

// --- Criterion: a linked item appears on the subject with the right count ---

func TestSubjectCountsWhatIsLinkedToIt(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Kubernetes")

	// One linked on save, one linked afterwards through the links endpoint.
	onSave := env.saveLink(t, "https://example.com/pods", "Pods explicados", subject.ID)
	later := env.saveLink(t, "https://example.com/aula", "Uma aula longa")
	env.retypeItem(t, later, "curso")
	decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost, "/api/core/links", map[string]any{
		"src_id": later, "dst_id": subject.ID, "kind": "about",
	}), http.StatusCreated)

	// A third item linked to nothing must not be counted.
	env.saveLink(t, "https://example.com/solto", "Nada a ver")

	bySlug := decodeSubjectsAnswer[subjectBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects/by-slug/kubernetes", nil), http.StatusOK)
	if bySlug.ID != subject.ID {
		t.Fatalf("by-slug answered %q, want %q", bySlug.ID, subject.ID)
	}
	if bySlug.Counts.Total != 2 {
		t.Errorf("total = %d, want 2 (%+v)", bySlug.Counts.Total, bySlug.Counts.ByType)
	}
	counts := map[string]int{}
	for _, entry := range bySlug.Counts.ByType {
		if entry.Module != "library" {
			t.Errorf("by_type carries module %q, want library", entry.Module)
		}
		counts[entry.Type] = entry.Count
	}
	if counts["post"] != 1 || counts["curso"] != 1 {
		t.Errorf("by_type = %v, want one post and one curso", counts)
	}
	if bySlug.LinkCount != 2 {
		t.Errorf("link_count = %d, want 2", bySlug.LinkCount)
	}
	_ = onSave
}

// --- Criterion: a suggested or rejected link is not counted or listed ---

func TestSubjectCountsAndPanelIgnoreUndecidedLinks(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")
	confirmed := env.saveLink(t, "https://example.com/um", "Confirmado", subject.ID)
	suggested := env.saveLink(t, "https://example.com/dois", "Sugerido")
	rejected := env.saveLink(t, "https://example.com/tres", "Rejeitado")

	env.suggest(t, suggested, subject.ID, 0.8)
	env.suggest(t, rejected, subject.ID, 0.4)
	rejectedLink := env.linkOf(t, rejected, subject.ID)
	decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost,
		"/api/core/links/"+rejectedLink.ID+"/decide", map[string]any{"decision": "reject"}), http.StatusOK)

	read := decodeSubjectsAnswer[subjectBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects/"+subject.ID, nil), http.StatusOK)
	if read.Counts.Total != 1 {
		t.Errorf("total = %d, want 1: only the confirmed link counts", read.Counts.Total)
	}
	// Every row the cascade would remove counts towards the delete warning,
	// whatever its status.
	if read.LinkCount != 3 {
		t.Errorf("link_count = %d, want 3", read.LinkCount)
	}

	// The panel reads confirmed `about` links into the subject, which is the
	// one list the screen renders.
	panel := decodeSubjectsAnswer[linkListBody](t, env.do(t, http.MethodGet,
		"/api/core/links?dst_id="+subject.ID+"&kind=about&status=confirmed", nil), http.StatusOK)
	if len(panel.Items) != 1 {
		t.Fatalf("the panel lists %d links, want 1 (%+v)", len(panel.Items), panel.Items)
	}
	if panel.Items[0].Src.ID != confirmed {
		t.Errorf("the panel lists %q, want the confirmed item %q", panel.Items[0].Src.ID, confirmed)
	}
	if panel.Items[0].Src.Title != "Confirmado" {
		t.Errorf("the listed end has title %q, want Confirmado", panel.Items[0].Src.Title)
	}
}

// suggest writes a model suggestion straight through the core writer: nothing
// in this delivery has an endpoint for one, and the queue the screens read is
// exactly what has to be set up here.
func (env *subjectsTestEnv) suggest(t *testing.T, srcID, dstID string, confidence float64) {
	t.Helper()
	tx, err := env.database.Writer().Begin()
	if err != nil {
		t.Fatalf("beginning a suggestion: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := core.Links.Suggest(context.Background(), tx, env.clock.Now(),
		srcID, dstID, core.LinkKindAbout, confidence); err != nil {
		t.Fatalf("suggesting a link: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("committing a suggestion: %v", err)
	}
}

// linkOf finds the one link of a pair, whatever its status.
func (env *subjectsTestEnv) linkOf(t *testing.T, srcID, dstID string) linkBody {
	t.Helper()
	page := decodeSubjectsAnswer[linkListBody](t, env.do(t, http.MethodGet,
		"/api/core/links?src_id="+srcID+"&dst_id="+dstID, nil), http.StatusOK)
	if len(page.Items) != 1 {
		t.Fatalf("the pair (%s, %s) has %d links, want 1", srcID, dstID, len(page.Items))
	}
	return page.Items[0]
}

// --- Criterion: focus gains and loses the subject ---

func TestFocusFollowsTheSubjectFlag(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")

	before := decodeSubjectsAnswer[focusBody](t, env.do(t, http.MethodGet, "/api/core/focus", nil), http.StatusOK)
	if len(before.Subjects) != 0 {
		t.Fatalf("focus starts with %d subjects, want none", len(before.Subjects))
	}
	// The library reports nothing as in progress, so the targets are empty and
	// the field is still present.
	if before.Targets == nil {
		t.Error("targets is absent; it is a required field and must be an empty array")
	}

	decodeSubjectsAnswer[subjectBody](t, env.do(t, http.MethodPatch,
		"/api/core/subjects/"+subject.ID, map[string]any{"focus": true}), http.StatusOK)

	on := decodeSubjectsAnswer[focusBody](t, env.do(t, http.MethodGet, "/api/core/focus", nil), http.StatusOK)
	if len(on.Subjects) != 1 || on.Subjects[0].ID != subject.ID {
		t.Fatalf("focus = %+v, want just %s", on.Subjects, subject.ID)
	}
	if !on.Subjects[0].Focus {
		t.Error("the subject in the focus does not report itself as one")
	}

	decodeSubjectsAnswer[subjectBody](t, env.do(t, http.MethodPatch,
		"/api/core/subjects/"+subject.ID, map[string]any{"focus": false}), http.StatusOK)

	off := decodeSubjectsAnswer[focusBody](t, env.do(t, http.MethodGet, "/api/core/focus", nil), http.StatusOK)
	if len(off.Subjects) != 0 {
		t.Fatalf("focus still holds %+v after the flag was cleared", off.Subjects)
	}
}

// --- Criterion: deleting a subject takes its rows with it ---

func TestDeleteSubjectRemovesItsAliasesRegistryAndLinks(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Kubernetes")
	item := env.saveLink(t, "https://example.com/pods", "Pods explicados", subject.ID)
	env.insertAlias(t, "k8s", subject.ID)

	recorder := env.do(t, http.MethodDelete, "/api/core/subjects/"+subject.ID, nil)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("DELETE = %d, want 204 (body %q)", recorder.Code, recorder.Body.String())
	}

	for table, query := range map[string]string{
		"core_subjects":        `SELECT COUNT(*) FROM core_subjects WHERE id = ?`,
		"core_subject_aliases": `SELECT COUNT(*) FROM core_subject_aliases WHERE subject_id = ?`,
		"core_items":           `SELECT COUNT(*) FROM core_items WHERE id = ?`,
	} {
		var count int
		if err := env.database.Reader().QueryRow(query, subject.ID).Scan(&count); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if count != 0 {
			t.Errorf("%s still holds %d rows for the deleted subject", table, count)
		}
	}
	var links int
	if err := env.database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_links WHERE src_id = ? OR dst_id = ?`,
		subject.ID, subject.ID).Scan(&links); err != nil {
		t.Fatalf("counting the links: %v", err)
	}
	if links != 0 {
		t.Errorf("%d links survived the subject", links)
	}

	// The item itself is the library's and is untouched: deleting a subject
	// removes what was said about it, not what was saved.
	if env.do(t, http.MethodGet, "/api/library/items/"+item, nil).Code != http.StatusOK {
		t.Error("the linked library item went with the subject")
	}
}

// insertAlias writes one spelling that means a subject. No endpoint creates
// one in this delivery; the search already reads them, which is what this
// exercises.
func (env *subjectsTestEnv) insertAlias(t *testing.T, alias, subjectID string) {
	t.Helper()
	if _, err := env.database.Writer().Exec(
		`INSERT INTO core_subject_aliases (alias_slug, subject_id) VALUES (?, ?)`, alias, subjectID); err != nil {
		t.Fatalf("inserting the alias %q: %v", alias, err)
	}
}

// --- Criterion: search finds a subject unaccented and by an alias, once ---

func TestSubjectSearchMatchesWithoutAccentsAndByAlias(t *testing.T) {
	env := newSubjectsTestEnv(t)
	programacao := env.createSubject(t, "Programação")
	env.createSubject(t, "Escrita")
	machine := env.createSubject(t, "Machine Learning")
	// Two spellings of the same subject, so a match on both must still answer
	// with one row.
	env.insertAlias(t, "ml", machine.ID)
	env.insertAlias(t, "machine-learning-pratico", machine.ID)

	unaccented := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=programacao", nil), http.StatusOK)
	if len(unaccented.Items) != 1 || unaccented.Items[0].ID != programacao.ID {
		t.Fatalf("q=programacao = %+v, want just Programação", unaccented.Items)
	}

	// Typed as a person writes it -- accents, capitals, a space -- which is
	// what the search has to normalise before it can match a slug at all.
	asWritten := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=Programa%C3%A7%C3%A3o", nil), http.StatusOK)
	if len(asWritten.Items) != 1 || asWritten.Items[0].ID != programacao.ID {
		t.Fatalf("q=Programação = %+v, want just Programação", asWritten.Items)
	}
	spaced := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=Machine%20Learning", nil), http.StatusOK)
	if len(spaced.Items) != 1 || spaced.Items[0].ID != machine.ID {
		t.Fatalf("q=\"Machine Learning\" = %+v, want just Machine Learning", spaced.Items)
	}

	byAlias := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=ml", nil), http.StatusOK)
	if len(byAlias.Items) != 1 || byAlias.Items[0].ID != machine.ID {
		t.Fatalf("q=ml = %+v, want just Machine Learning", byAlias.Items)
	}

	// "machine" matches the slug by prefix and both aliases by substring; the
	// answer is still one row.
	overlapping := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=machine", nil), http.StatusOK)
	if len(overlapping.Items) != 1 || overlapping.Items[0].ID != machine.ID {
		t.Fatalf("q=machine = %+v, want one row for Machine Learning", overlapping.Items)
	}

	// An exact match sorts ahead of a longer one that only contains it.
	env.createSubject(t, "Escrita Concisa")
	ranked := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=escrita", nil), http.StatusOK)
	if len(ranked.Items) != 2 {
		t.Fatalf("q=escrita = %+v, want two rows", ranked.Items)
	}
	if ranked.Items[0].Slug != "escrita" || ranked.Items[1].Slug != "escrita-concisa" {
		t.Errorf("q=escrita ordered %q then %q, want the exact match first",
			ranked.Items[0].Slug, ranked.Items[1].Slug)
	}

	// The same question twice gives the same order, which is what "stable"
	// means for a list a screen pages through.
	again := decodeSubjectsAnswer[subjectListBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects?q=escrita", nil), http.StatusOK)
	if again.Items[0].Slug != ranked.Items[0].Slug || again.Items[1].Slug != ranked.Items[1].Slug {
		t.Error("two identical searches answered in different orders")
	}
}

// --- Criterion: 120 subjects page as 50/50/20, and a reused cursor is 400 ---

func TestSubjectsPageAndRefuseAReusedCursor(t *testing.T) {
	env := newSubjectsTestEnv(t)
	for index := 0; index < 120; index++ {
		env.createSubject(t, fmt.Sprintf("Assunto %03d", index))
	}

	sizes := []int{}
	seen := map[string]bool{}
	cursor := ""
	for {
		path := "/api/core/subjects"
		if cursor != "" {
			path += "?cursor=" + cursor
		}
		page := decodeSubjectsAnswer[subjectListBody](t, env.do(t, http.MethodGet, path, nil), http.StatusOK)
		sizes = append(sizes, len(page.Items))
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatalf("subject %s came back on two pages", item.Slug)
			}
			seen[item.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
		if len(sizes) > 5 {
			t.Fatalf("the pages do not end: %v", sizes)
		}
	}
	if fmt.Sprint(sizes) != "[50 50 20]" {
		t.Errorf("pages = %v, want [50 50 20]", sizes)
	}
	if len(seen) != 120 {
		t.Errorf("%d distinct subjects over all pages, want 120", len(seen))
	}
}

func TestLinksCursorIsRefusedUnderChangedFilters(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Kubernetes")
	other := env.createSubject(t, "Escrita")
	for index := 0; index < 3; index++ {
		item := env.saveLink(t, fmt.Sprintf("https://example.com/%d", index),
			fmt.Sprintf("Item %d", index), subject.ID)
		_ = item
	}

	first := decodeSubjectsAnswer[linkListBody](t, env.do(t, http.MethodGet,
		"/api/core/links?dst_id="+subject.ID+"&limit=2", nil), http.StatusOK)
	if first.NextCursor == "" {
		t.Fatal("the first page of three links with limit 2 carries no cursor")
	}

	// The same cursor under the same filters continues the list.
	rest := decodeSubjectsAnswer[linkListBody](t, env.do(t, http.MethodGet,
		"/api/core/links?dst_id="+subject.ID+"&limit=2&cursor="+first.NextCursor, nil), http.StatusOK)
	if len(rest.Items) != 1 {
		t.Errorf("the second page holds %d links, want 1", len(rest.Items))
	}

	// Under another filter it is refused rather than paginating a list it was
	// never issued for.
	recorder := env.do(t, http.MethodGet,
		"/api/core/links?dst_id="+other.ID+"&limit=2&cursor="+first.NextCursor, nil)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a cursor reused under other filters = %d, want 400 (body %q)",
			recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "invalid_cursor") {
		t.Errorf("the refusal does not carry invalid_cursor: %q", recorder.Body.String())
	}
}

// --- Criterion: confirming over a decided pair, and rejecting a suggestion ---

func TestCreateLinkTakesOverARejectedOrSuggestedPair(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Kubernetes")
	fromRejected := env.saveLink(t, "https://example.com/um", "Era rejeitado")
	fromSuggested := env.saveLink(t, "https://example.com/dois", "Era sugerido")

	env.suggest(t, fromRejected, subject.ID, 0.3)
	rejected := env.linkOf(t, fromRejected, subject.ID)
	decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost,
		"/api/core/links/"+rejected.ID+"/decide", map[string]any{"decision": "reject"}), http.StatusOK)
	env.suggest(t, fromSuggested, subject.ID, 0.9)

	for _, src := range []string{fromRejected, fromSuggested} {
		created := decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost, "/api/core/links",
			map[string]any{"src_id": src, "dst_id": subject.ID, "kind": "about"}), http.StatusCreated)
		if created.Status != "confirmed" {
			t.Errorf("the link from %s is %q, want confirmed", src, created.Status)
		}
		if created.Source != "manual" {
			t.Errorf("the link from %s has source %q, want manual", src, created.Source)
		}
		if created.DecidedAt == nil {
			t.Errorf("the link from %s has no decided_at", src)
		}
		var rows int
		if err := env.database.Reader().QueryRow(
			`SELECT COUNT(*) FROM core_links WHERE src_id = ? AND dst_id = ? AND kind = 'about'`,
			src, subject.ID).Scan(&rows); err != nil {
			t.Fatalf("counting the links of the pair: %v", err)
		}
		if rows != 1 {
			t.Errorf("the pair (%s, subject) holds %d rows, want 1", src, rows)
		}
	}
}

// TestCreateLinkClearsTheModelsConfidenceOverASuggestion proves a manual
// confirmation over a suggestion keeps no model confidence: the row is the
// person's decision now, not a suggestion with a score.
func TestCreateLinkClearsTheModelsConfidenceOverASuggestion(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")
	item := env.saveLink(t, "https://example.com/sugerido", "Sugerido")
	env.suggest(t, item, subject.ID, 0.85)

	created := decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost, "/api/core/links",
		map[string]any{"src_id": item, "dst_id": subject.ID, "kind": "about"}), http.StatusCreated)
	if created.Status != "confirmed" || created.Source != "manual" {
		t.Fatalf("the link is %s/%s, want confirmed/manual", created.Status, created.Source)
	}
	if created.Confidence != nil {
		t.Errorf("confidence = %v on a manually confirmed link, want it absent", *created.Confidence)
	}
	var confidence sql.NullFloat64
	if err := env.database.Reader().QueryRow(
		`SELECT confidence FROM core_links WHERE src_id = ? AND dst_id = ? AND kind = 'about'`,
		item, subject.ID).Scan(&confidence); err != nil {
		t.Fatalf("reading the stored confidence: %v", err)
	}
	if confidence.Valid {
		t.Errorf("the stored confidence = %v, want NULL", confidence.Float64)
	}
}

func TestDecideRejectRecordsTheRejection(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")
	item := env.saveLink(t, "https://example.com/um", "Sugerido")
	env.suggest(t, item, subject.ID, 0.5)

	suggested := env.linkOf(t, item, subject.ID)
	if suggested.Status != "suggested" || suggested.DecidedAt != nil {
		t.Fatalf("the set-up link is %+v, want a suggestion nobody decided", suggested)
	}

	decided := decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost,
		"/api/core/links/"+suggested.ID+"/decide", map[string]any{"decision": "reject"}), http.StatusOK)
	if decided.Status != "rejected" {
		t.Errorf("status after reject = %q, want rejected", decided.Status)
	}
	if decided.DecidedAt == nil || *decided.DecidedAt == "" {
		t.Error("rejecting left decided_at empty; a rejection is a decision too")
	}
	if decided.ID != suggested.ID {
		t.Errorf("the decision answered with link %q, want the one decided %q", decided.ID, suggested.ID)
	}
}

func TestCreateLinkRefusesAnEndOutsideTheRegistry(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")

	recorder := env.do(t, http.MethodPost, "/api/core/links",
		map[string]any{"src_id": "nao-existe", "dst_id": subject.ID, "kind": "about"})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a link from an unregistered id = %d, want 400 (body %q)",
			recorder.Code, recorder.Body.String())
	}
	var links int
	if err := env.database.Reader().QueryRow(`SELECT COUNT(*) FROM core_links`).Scan(&links); err != nil {
		t.Fatalf("counting the links: %v", err)
	}
	if links != 0 {
		t.Errorf("the refused link left %d rows behind", links)
	}
}

// --- Criterion: the CLI works against a temporary NORTE_DATA ---

func TestSubjectsCLIAddsListsAndFocuses(t *testing.T) {
	dataDir := t.TempDir()

	if out, err := runSubjectsCLI(t, dataDir, "subjects", "add", "Escrita"); err != nil {
		t.Fatalf("subjects add: %v (%s)", err, out)
	}
	if out, err := runSubjectsCLI(t, dataDir, "subjects", "add", "Kubernetes"); err != nil {
		t.Fatalf("subjects add: %v (%s)", err, out)
	}

	listed, err := runSubjectsCLI(t, dataDir, "subjects", "list")
	if err != nil {
		t.Fatalf("subjects list: %v (%s)", err, listed)
	}
	if !strings.Contains(listed, "escrita") || !strings.Contains(listed, "kubernetes") {
		t.Fatalf("subjects list printed %q, want both subjects", listed)
	}
	if strings.Contains(listed, "* escrita") {
		t.Errorf("subjects list marks escrita as a focus before anyone asked: %q", listed)
	}

	focused, err := runSubjectsCLI(t, dataDir, "subjects", "focus", "Escrita")
	if err != nil {
		t.Fatalf("subjects focus: %v (%s)", err, focused)
	}
	if !strings.Contains(focused, "escrita") || strings.Contains(focused, "not focus") {
		t.Fatalf("subjects focus printed %q, want escrita marked", focused)
	}

	afterFocus, err := runSubjectsCLI(t, dataDir, "subjects", "list")
	if err != nil {
		t.Fatalf("subjects list: %v (%s)", err, afterFocus)
	}
	if !strings.Contains(afterFocus, "* escrita") {
		t.Fatalf("subjects list printed %q, want escrita marked with *", afterFocus)
	}
	if strings.Contains(afterFocus, "* kubernetes") {
		t.Errorf("focusing one subject marked another: %q", afterFocus)
	}

	// A duplicate reports the refusal's own sentence, not an error chain.
	out, err := runSubjectsCLI(t, dataDir, "subjects", "add", "Escrita")
	if err == nil {
		t.Fatalf("a duplicate subject succeeded: %q", out)
	}
	if !strings.Contains(err.Error(), "already taken") {
		t.Errorf("the duplicate reported %q, want the taken-slug sentence", err.Error())
	}
}

// runSubjectsCLI drives the real command line in this process against a data
// directory of the test's own. The environment is pinned so the command cannot
// reach the config file or the data directory of whoever runs it.
func runSubjectsCLI(t *testing.T, dataDir string, args ...string) (string, error) {
	t.Helper()
	t.Setenv("NORTE_DATA", dataDir)
	t.Setenv("NORTE_MODULES", "library")
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(t.TempDir(), "config"))
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	root := app.NewRootCommand()
	root.SetArgs(args)
	root.SetOut(&out)
	root.SetErr(&out)
	if err := root.ExecuteContext(context.Background()); err != nil {
		return out.String(), err
	}
	return out.String(), nil
}
