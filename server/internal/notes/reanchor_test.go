package notes

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
)

// notesArticleHTML is a page whose extracted text holds the sentences the
// re-anchoring tests mark. It is enough paragraphs for the extractor to treat
// the div as the article rather than as boilerplate.
func notesArticleHTML(marked string) string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Como ler devagar</title></head><body><article>` +
		`<h1>Como ler devagar</h1>` +
		`<p>Uma primeira frase que serve de contexto antes do que vem depois dela.</p>` +
		`<p>` + marked + `</p>` +
		`<p>Uma frase final que serve de contexto depois do que vem antes dela.</p>` +
		`<p>Mais um parágrafo, para que a extração trate isto como um artigo inteiro.</p>` +
		`</article></body></html>`
}

// saveAndExtract puts an article in the library through the real save endpoint
// and lets the real extraction job run, so the text a passage anchors against
// is the text the library actually produced.
func (h *notesHarness) saveAndExtract(pageURL, html string) string {
	h.t.Helper()
	recorder := h.request(http.MethodPost, "/api/library/items",
		map[string]any{"url": pageURL, "html": html})
	if recorder.Code != http.StatusCreated && recorder.Code != http.StatusOK {
		h.t.Fatalf("saving %s answered %d: %s", pageURL, recorder.Code, recorder.Body.String())
	}
	saved := notesDecode[struct {
		ID string `json:"id"`
	}](h.t, recorder, recorder.Code)
	h.drainJobs()
	return saved.ID
}

// replaceSnapshot makes the stored HTML of an item something else, which is
// what a page having been rewritten looks like from the extraction's side.
func (h *notesHarness) replaceSnapshot(id, html string) {
	h.t.Helper()
	blob, err := h.deps.Files.Store(context.Background(), strings.NewReader(html), "text/html; charset=utf-8")
	if err != nil {
		h.t.Fatalf("storing the new snapshot: %v", err)
	}
	if _, err := h.database.Writer().Exec(
		`UPDATE library_items SET html_hash = ? WHERE id = ?`, blob.Hash, id); err != nil {
		h.t.Fatalf("pointing %s at the new snapshot: %v", id, err)
	}
}

func (h *notesHarness) articleText(id string) string {
	h.t.Helper()
	var text string
	if err := h.database.Reader().QueryRow(
		`SELECT COALESCE(content_text, '') FROM library_items WHERE id = ?`, id).Scan(&text); err != nil {
		h.t.Fatalf("reading the text of %s: %v", id, err)
	}
	return text
}

// TestAReExtractionOnUnchangedTextKeepsTheHighlightAnchored walks the whole
// path the criterion names: the extract endpoint, the queue, the library's
// event, the notes job, and the highlight's status at the end of it.
func TestAReExtractionOnUnchangedTextKeepsTheHighlightAnchored(t *testing.T) {
	harness := newNotesHarness(t)
	const marked = "O trecho que fica marcado nesta leitura."
	itemID := harness.saveAndExtract("https://example.invalid/devagar", notesArticleHTML(marked))
	if text := harness.articleText(itemID); text == "" {
		t.Fatal("the extraction produced no text to anchor against")
	}

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   marked,
			"prefix":  "antes do que vem depois dela.",
			"suffix":  "Uma frase final que serve",
		}), http.StatusCreated)
	if created.Status != NotesAnchored {
		t.Fatalf("the highlight was stored %q: %s", created.Status, harness.articleText(itemID))
	}
	_, hintBefore := harness.highlightStatus(created.ID)

	recorder := harness.request(http.MethodPost, "/api/library/items/"+itemID+"/extract", map[string]any{})
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("the re-extraction answered %d: %s", recorder.Code, recorder.Body.String())
	}
	harness.drainJobs()

	status, hintAfter := harness.highlightStatus(created.ID)
	if status != NotesAnchored {
		t.Fatalf("the highlight became %q after a re-extraction that changed nothing", status)
	}
	if hintAfter != hintBefore {
		t.Fatalf("the offset moved from %d to %d on unchanged text", hintBefore, hintAfter)
	}
}

// TestAReExtractionThatDropsThePassageOrphansTheHighlight is the other half of
// the criterion: the article was rewritten, the passage is gone, and the
// highlight is listed as lost rather than deleted or silently moved.
func TestAReExtractionThatDropsThePassageOrphansTheHighlight(t *testing.T) {
	harness := newNotesHarness(t)
	const marked = "O trecho que fica marcado nesta leitura."
	itemID := harness.saveAndExtract("https://example.invalid/devagar", notesArticleHTML(marked))

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   marked,
			"prefix":  "antes do que vem depois dela.",
			"suffix":  "Uma frase final que serve",
		}), http.StatusCreated)
	if created.Status != NotesAnchored {
		t.Fatalf("the highlight was stored %q", created.Status)
	}

	// The article behind the item is rewritten and extracted again. The
	// snapshot is swapped rather than refetched, because a fetch is a request
	// to the open internet and no test in this repository makes one.
	harness.replaceSnapshot(itemID,
		notesArticleHTML("Uma frase inteiramente diferente ocupa agora aquele lugar."))
	if recorder := harness.request(http.MethodPost, "/api/library/items/"+itemID+"/extract",
		map[string]any{}); recorder.Code != http.StatusAccepted {
		t.Fatalf("the re-extraction answered %d: %s", recorder.Code, recorder.Body.String())
	}
	harness.drainJobs()
	if text := harness.articleText(itemID); strings.Contains(text, marked) {
		t.Fatalf("the re-extraction kept the passage: %q", text)
	}

	status, _ := harness.highlightStatus(created.ID)
	if status != NotesOrphaned {
		t.Fatalf("the highlight stayed %q after its passage was rewritten away", status)
	}
	// The passage itself is still the person's: an orphaned highlight is listed
	// below the text, not thrown away.
	listed := notesDecode[notesHighlightListBody](t,
		harness.request(http.MethodGet, "/api/notes/highlights?item_id="+itemID, nil), http.StatusOK)
	if len(listed.Items) != 1 || listed.Items[0].Exact != marked {
		t.Fatalf("the orphaned highlight came back as %+v", listed.Items)
	}
}

// TestTheExtractionEventEnqueuesOneReanchorJobPerItem is the durability of the
// reaction: the callback writes a queue row and returns, and three publishes
// while that row is waiting leave one job rather than three.
func TestTheExtractionEventEnqueuesOneReanchorJobPerItem(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Um artigo", "Antes. O trecho marcado. Depois.")

	for range 3 {
		harness.publishExtracted(itemID)
	}

	var kind, dedupe string
	var count int
	if err := harness.database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_jobs WHERE kind = ?`, NotesReanchorJobKind).Scan(&count); err != nil {
		t.Fatalf("counting the re-anchor jobs: %v", err)
	}
	if count != 1 {
		t.Fatalf("three publishes left %d re-anchor jobs, want one", count)
	}
	if err := harness.database.Reader().QueryRow(
		`SELECT kind, COALESCE(dedupe_key, '') FROM core_jobs WHERE kind = ?`,
		NotesReanchorJobKind).Scan(&kind, &dedupe); err != nil {
		t.Fatalf("reading the re-anchor job: %v", err)
	}
	if want := "reanchor:" + itemID; dedupe != want {
		t.Fatalf("the dedupe key is %q, want %q", dedupe, want)
	}
}

// TestReanchoringPicksTheOccurrenceTheContextIdentifies is the criterion about
// two occurrences: the one whose surroundings match is the one the passage
// moves to, and two occurrences with the same surroundings are not chosen
// between at all.
func TestReanchoringPicksTheOccurrenceTheContextIdentifies(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Repetido", "Primeiro: a mesma frase. Segundo: a mesma frase.")

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   "a mesma frase.",
			"prefix":  "Segundo: ",
		}), http.StatusCreated)
	if created.Status != NotesAnchored || created.Hint != 34 {
		t.Fatalf("the highlight was stored %q at %d, want anchored at 34", created.Status, created.Hint)
	}

	// A re-extraction that moves the matching occurrence: the passage follows
	// its own context rather than its old offset.
	harness.setArticleText(itemID, "Zero. Primeiro: a mesma frase. Segundo: a mesma frase.")
	harness.publishExtracted(itemID)
	harness.drainJobs()
	status, hint := harness.highlightStatus(created.ID)
	if status != NotesAnchored || hint != 40 {
		t.Fatalf("after the shift the highlight is %q at %d, want anchored at 40", status, hint)
	}

	// A re-extraction that makes the two occurrences indistinguishable: the
	// passage is orphaned rather than attached to either.
	harness.setArticleText(itemID, "Segundo: a mesma frase. Segundo: a mesma frase.")
	harness.publishExtracted(itemID)
	harness.drainJobs()
	status, _ = harness.highlightStatus(created.ID)
	if status != NotesOrphaned {
		t.Fatalf("two indistinguishable occurrences left the highlight %q", status)
	}
}

// TestReanchoringLeavesAHighlightAloneWhileItsModuleIsOff is why ErrNoText is
// one error: with the library disabled there is no text to search, and the
// passage keeps the status and the offset it had.
func TestReanchoringLeavesAHighlightAloneWhileItsModuleIsOff(t *testing.T) {
	harness := newNotesHarness(t, "notes")
	// The registry row survives a module being switched off, which is what the
	// screen renders the note's origin from.
	itemID := harness.registerItem("library", "post", "Um artigo que a biblioteca guarda")

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "O trecho marcado."}), http.StatusCreated)
	if created.Status != NotesAnchored {
		t.Fatalf("a highlight on an item with no readable text was stored %q", created.Status)
	}

	reanchor := NewNotesReanchor(harness.database, harness.deps.Jobs, harness.deps.Texts, harness.deps.Logger)
	changed, err := reanchor.ReanchorItem(context.Background(), itemID)
	if err != nil {
		t.Fatalf("ReanchorItem: %v", err)
	}
	if changed != 0 {
		t.Fatalf("re-anchoring changed %d rows with the owning module off", changed)
	}
	if status, _ := harness.highlightStatus(created.ID); status != NotesAnchored {
		t.Fatalf("the highlight became %q with the owning module off", status)
	}
}

// TestNotesOnlyModeStillListsEveryNoteWithItsSourceTitle is the criterion about
// NORTE_MODULES=notes: the library's routes are not mounted, its table is not
// read, and the titles come from the registry.
func TestNotesOnlyModeStillListsEveryNoteWithItsSourceTitle(t *testing.T) {
	harness := newNotesHarness(t, "notes")
	itemID := harness.registerItem("library", "post", "Como compiladores leem código")

	highlight := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "O trecho marcado."}), http.StatusCreated)
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "highlight_id": highlight.ID, "text": "uma anotação"}),
		http.StatusCreated)
	question := notesDecode[notesQuestionBody](t, harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{"item_id": itemID, "text": "Por que isto importa?"}), http.StatusCreated)

	// The library is not mounted at all, which is the premise of the rest.
	if recorder := harness.request(http.MethodGet, "/api/library/items", nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("the library answered %d with the module disabled", recorder.Code)
	}

	highlights := notesDecode[notesHighlightListBody](t,
		harness.request(http.MethodGet, "/api/notes/highlights", nil), http.StatusOK)
	if len(highlights.Items) != 1 || highlights.Items[0].Source == nil ||
		highlights.Items[0].Source.Title != "Como compiladores leem código" {
		t.Fatalf("the highlight lost its source title: %+v", highlights.Items)
	}
	annotations := notesDecode[notesAnnotationListBody](t,
		harness.request(http.MethodGet, "/api/notes/annotations", nil), http.StatusOK)
	if len(annotations.Items) != 1 || annotations.Items[0].Source == nil ||
		annotations.Items[0].Source.Title != "Como compiladores leem código" {
		t.Fatalf("the annotation lost its source title: %+v", annotations.Items)
	}
	if annotations.Items[0].Quote != "O trecho marcado." {
		t.Fatalf("the annotation lost the passage it hangs on: %q", annotations.Items[0].Quote)
	}
	questions := notesDecode[notesQuestionListBody](t,
		harness.request(http.MethodGet, "/api/notes/questions", nil), http.StatusOK)
	if len(questions.Items) != 1 || questions.Items[0].Source == nil ||
		questions.Items[0].Source.Title != "Como compiladores leem código" {
		t.Fatalf("the question lost its source title: %+v", questions.Items)
	}
	if annotation.ID == "" || question.ID == "" {
		t.Fatal("the fixtures were not created")
	}
}

// TestStartSubscribesToTheExtractionEvent is the one thing the harness's own
// wiring cannot prove: that the module's Start is what installs the
// subscription in the shipped binary.
func TestStartSubscribesToTheExtractionEvent(t *testing.T) {
	harness := newNotesHarness(t, "library")
	itemID := harness.saveArticle("Um artigo", "Antes. O trecho marcado. Depois.")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopped := make(chan struct{})
	go func() {
		_ = (&NotesModule{}).Start(ctx, harness.deps)
		close(stopped)
	}()

	// Start subscribes and then blocks, and there is nothing to observe but the
	// job it leaves behind, so the event is published until one appears.
	deadline := time.Now().Add(10 * time.Second)
	for {
		harness.publishExtracted(itemID)
		if notesCount(t, harness, `SELECT COUNT(*) FROM core_jobs WHERE kind = ?`, NotesReanchorJobKind) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Start never subscribed to the extraction event")
		}
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
	<-stopped
}

// TestTheNotesModuleIsCompiledInAndSwitchable keeps the blank import in
// cmd/norte honest: a module nothing registers cannot be named in
// NORTE_MODULES, and the failure would otherwise only show at runtime.
func TestTheNotesModuleIsCompiledInAndSwitchable(t *testing.T) {
	names := app.CompiledNorteModuleNames()
	found := false
	for _, name := range names {
		if name == ModuleName {
			found = true
		}
	}
	if !found {
		t.Fatalf("the compiled modules are %v, without %q", names, ModuleName)
	}
}
