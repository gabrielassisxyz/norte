package app_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/library"
)

// --- Renaming a subject ---

func TestRenameUpdatesTheRegistryAddressAndTitle(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Kubernetes")

	renamed := decodeSubjectsAnswer[subjectBody](t, env.do(t, http.MethodPatch,
		"/api/core/subjects/"+subject.ID, map[string]any{"name": "Orquestração de Contêineres"}), http.StatusOK)
	if renamed.Slug != "orquestracao-de-conteineres" {
		t.Fatalf("slug after rename = %q, want orquestracao-de-conteineres", renamed.Slug)
	}

	var title, url string
	if err := env.database.Reader().QueryRow(
		`SELECT title, url FROM core_items WHERE id = ?`, subject.ID).Scan(&title, &url); err != nil {
		t.Fatalf("reading the registry row: %v", err)
	}
	if url != "/subjects/orquestracao-de-conteineres" {
		t.Errorf("registry url = %q, want the new slug's address", url)
	}
	if title != "Orquestração de Contêineres" {
		t.Errorf("registry title = %q, want the new name", title)
	}
	if code := env.do(t, http.MethodGet, "/api/core/subjects/by-slug/kubernetes", nil).Code; code != http.StatusNotFound {
		t.Errorf("the old slug answers %d, want 404", code)
	}
}

func TestRenameOntoATakenSlugIsAConflictNotAServerError(t *testing.T) {
	env := newSubjectsTestEnv(t)
	env.createSubject(t, "Escrita")
	other := env.createSubject(t, "Leitura")

	recorder := env.do(t, http.MethodPatch, "/api/core/subjects/"+other.ID, map[string]any{"name": "escrita!"})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("renaming onto a taken slug = %d, want 409 (body %q)", recorder.Code, recorder.Body.String())
	}
	unchanged := decodeSubjectsAnswer[subjectBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects/"+other.ID, nil), http.StatusOK)
	if unchanged.Slug != "leitura" || unchanged.Name != "Leitura" {
		t.Errorf("the refused rename changed the subject to %+v", unchanged)
	}
}

// --- The focus merges what the modules report ---

// focusingModule is the real library module reporting targets of its own, which
// the real one never does: it is the only way to put a provider's answer on the
// endpoint before study and projects exist.
type focusingModule struct {
	app.Module
	targets []core.FocusTarget
	err     error
}

func (m focusingModule) FocusTargets(context.Context) ([]core.FocusTarget, error) {
	return m.targets, m.err
}

func TestFocusIncludesWhatEachModuleReportsInProgress(t *testing.T) {
	env := newSubjectsTestEnvWith(t, focusingModule{
		Module: library.NewLibraryModule(),
		targets: []core.FocusTarget{
			{ID: "curso-1", Type: "course", Title: "Rust do zero"},
			{ID: "proj-1", Type: "project", Title: "Norte"},
		},
	})
	subject := env.createSubject(t, "Escrita")
	decodeSubjectsAnswer[subjectBody](t, env.do(t, http.MethodPatch,
		"/api/core/subjects/"+subject.ID, map[string]any{"focus": true}), http.StatusOK)

	focus := decodeSubjectsAnswer[focusBody](t, env.do(t, http.MethodGet, "/api/core/focus", nil), http.StatusOK)
	if len(focus.Subjects) != 1 || focus.Subjects[0].ID != subject.ID {
		t.Errorf("focus subjects = %+v, want the flagged one", focus.Subjects)
	}
	if len(focus.Targets) != 2 {
		t.Fatalf("focus targets = %+v, want the two the module reported", focus.Targets)
	}
	if focus.Targets[0].ID != "curso-1" || focus.Targets[0].Type != "course" || focus.Targets[0].Title != "Rust do zero" {
		t.Errorf("first target = %+v, want the course in the order reported", focus.Targets[0])
	}
	if focus.Targets[1].ID != "proj-1" {
		t.Errorf("second target = %+v, want the project", focus.Targets[1])
	}
}

func TestFocusFailsWhenAModuleCannotReport(t *testing.T) {
	env := newSubjectsTestEnvWith(t, focusingModule{
		Module: library.NewLibraryModule(),
		err:    context.DeadlineExceeded,
	})
	if code := env.do(t, http.MethodGet, "/api/core/focus", nil).Code; code != http.StatusInternalServerError {
		t.Errorf("focus with a failing provider = %d, want 500 rather than a silently shorter list", code)
	}
}

// --- Counts come only from enabled modules ---

func TestSubjectCountsLeaveOutItemsOfModulesThatAreOff(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Kubernetes")
	env.saveLink(t, "https://example.com/pods", "Pods", subject.ID)

	// A registry row left by a module that has since been switched off: the
	// library is the only one enabled here, so "study" is off.
	tx, err := env.database.Writer().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("beginning a transaction: %v", err)
	}
	if _, err := tx.Exec(`INSERT INTO core_items (id, module, type, title, url, created_at)
        VALUES ('study-1', 'study', 'course', 'Curso antigo', NULL, '2026-10-08T12:00:00Z')`); err != nil {
		t.Fatalf("registering the item of a module that is off: %v", err)
	}
	if err := core.Links.Confirm(context.Background(), tx, subjectsFixedInstant, "study-1", subject.ID, core.LinkKindAbout); err != nil {
		t.Fatalf("linking it: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("committing: %v", err)
	}

	read := decodeSubjectsAnswer[subjectBody](t,
		env.do(t, http.MethodGet, "/api/core/subjects/"+subject.ID, nil), http.StatusOK)
	if read.Counts.Total != 1 {
		t.Errorf("total = %d, want 1: the study item belongs to a module that is off", read.Counts.Total)
	}
	for _, entry := range read.Counts.ByType {
		if entry.Module != "library" {
			t.Errorf("by_type counts the module %q, which is not enabled", entry.Module)
		}
	}
	// The delete warning still counts every row the cascade would remove.
	if read.LinkCount != 2 {
		t.Errorf("link_count = %d, want 2", read.LinkCount)
	}
}

// --- Only a suggestion can be decided ---

func TestDecideRefusesALinkThatIsNotASuggestion(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")
	manual := env.saveLink(t, "https://example.com/um", "Meu", subject.ID)
	before := env.linkOf(t, manual, subject.ID)
	if before.Status != "confirmed" || before.DecidedAt == nil {
		t.Fatalf("set-up link is %+v, want a confirmed one with a decision date", before)
	}

	for _, decision := range []string{"reject", "accept"} {
		recorder := env.do(t, http.MethodPost, "/api/core/links/"+before.ID+"/decide",
			map[string]any{"decision": decision})
		if recorder.Code != http.StatusConflict {
			t.Fatalf("%s on a confirmed link = %d, want 409 (body %q)", decision, recorder.Code, recorder.Body.String())
		}
	}
	after := env.linkOf(t, manual, subject.ID)
	if after.Status != "confirmed" || after.Source != "manual" || *after.DecidedAt != *before.DecidedAt {
		t.Errorf("the refused decisions changed the link from %+v to %+v", before, after)
	}

	// A rejection is a decision too: accepting it afterwards is the person's
	// call through POST /links, not the model's through decide.
	rejected := env.saveLink(t, "https://example.com/dois", "Recusado")
	env.suggest(t, rejected, subject.ID, 0.5)
	link := env.linkOf(t, rejected, subject.ID)
	decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost, "/api/core/links/"+link.ID+"/decide",
		map[string]any{"decision": "reject"}), http.StatusOK)
	if code := env.do(t, http.MethodPost, "/api/core/links/"+link.ID+"/decide",
		map[string]any{"decision": "accept"}).Code; code != http.StatusConflict {
		t.Errorf("accept on a rejected link = %d, want 409", code)
	}
}

func TestDecideAnUnknownLinkIsNotFound(t *testing.T) {
	env := newSubjectsTestEnv(t)
	if code := env.do(t, http.MethodPost, "/api/core/links/nao-existe/decide",
		map[string]any{"decision": "accept"}).Code; code != http.StatusNotFound {
		t.Errorf("deciding a link that does not exist = %d, want 404", code)
	}
}

func TestDecideAcceptConfirmsASuggestion(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")
	item := env.saveLink(t, "https://example.com/um", "Sugerido")
	env.suggest(t, item, subject.ID, 0.7)
	link := env.linkOf(t, item, subject.ID)

	decided := decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost,
		"/api/core/links/"+link.ID+"/decide", map[string]any{"decision": "accept"}), http.StatusOK)
	if decided.Status != "confirmed" || decided.DecidedAt == nil {
		t.Errorf("accepted link = %+v, want confirmed with a decision date", decided)
	}
	if decided.Src.ID != item || decided.Src.Title != "Sugerido" || decided.Dst.ID != subject.ID || decided.Dst.Type != "subject" {
		t.Errorf("the decided link resolved src %+v and dst %+v, want the item and the subject", decided.Src, decided.Dst)
	}
}

// --- Both ends of every listed link come back resolved ---

func TestLinkListResolvesBothEndsOfEveryRow(t *testing.T) {
	env := newSubjectsTestEnv(t)
	first := env.createSubject(t, "Kubernetes")
	second := env.createSubject(t, "Escrita")
	a := env.saveLink(t, "https://example.com/a", "Item A", first.ID)
	b := env.saveLink(t, "https://example.com/b", "Item B", second.ID, first.ID)

	list := decodeSubjectsAnswer[linkListBody](t, env.do(t, http.MethodGet, "/api/core/links", nil), http.StatusOK)
	if len(list.Items) != 3 {
		t.Fatalf("listed %d links, want 3 (%+v)", len(list.Items), list.Items)
	}
	titles := map[string]string{a: "Item A", b: "Item B", first.ID: "Kubernetes", second.ID: "Escrita"}
	for _, link := range list.Items {
		if link.Src.Title != titles[link.Src.ID] || link.Dst.Title != titles[link.Dst.ID] {
			t.Errorf("link %s resolved src %+v and dst %+v, titles do not match their ids", link.ID, link.Src, link.Dst)
		}
		if link.Src.Module != "library" || link.Dst.Type != "subject" {
			t.Errorf("link %s resolved src module %q and dst type %q", link.ID, link.Src.Module, link.Dst.Type)
		}
	}
}

func TestCreateLinkAnswersWithBothEndsResolved(t *testing.T) {
	env := newSubjectsTestEnv(t)
	subject := env.createSubject(t, "Escrita")
	item := env.saveLink(t, "https://example.com/um", "Um texto")

	created := decodeSubjectsAnswer[linkBody](t, env.do(t, http.MethodPost, "/api/core/links",
		map[string]any{"src_id": item, "dst_id": subject.ID, "kind": "about"}), http.StatusCreated)
	if created.Src.ID != item || created.Src.Module != "library" || created.Dst.ID != subject.ID || created.Dst.Title != "Escrita" {
		t.Errorf("the created link resolved src %+v and dst %+v, want the item and the subject", created.Src, created.Dst)
	}
}
