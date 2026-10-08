package notes

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
)

// notesHighlightBody is the answer to a highlight call, read loosely so a test
// asserts on the fields it is about rather than on the whole contract.
type notesHighlightBody struct {
	ID        string `json:"id"`
	ItemID    string `json:"item_id"`
	Exact     string `json:"exact"`
	Status    string `json:"status"`
	Hint      int    `json:"position_hint"`
	Ambiguous bool   `json:"ambiguous"`
	Source    *struct {
		ID     string `json:"id"`
		Module string `json:"module"`
		Title  string `json:"title"`
	} `json:"source"`
}

type notesHighlightListBody struct {
	Items      []notesHighlightBody `json:"items"`
	NextCursor string               `json:"next_cursor"`
}

type notesQuestionBody struct {
	ID           string  `json:"id"`
	ItemID       string  `json:"item_id"`
	AnnotationID string  `json:"annotation_id"`
	SetID        string  `json:"set_id"`
	Kind         *string `json:"kind"`
	Text         string  `json:"text"`
	Status       string  `json:"status"`
	Source       *struct {
		Title string `json:"title"`
	} `json:"source"`
}

type notesQuestionListBody struct {
	Items      []notesQuestionBody `json:"items"`
	NextCursor string              `json:"next_cursor"`
}

type notesAnnotationBody struct {
	ID          string `json:"id"`
	ItemID      string `json:"item_id"`
	HighlightID string `json:"highlight_id"`
	Quote       string `json:"quote"`
	Text        string `json:"text"`
	Source      *struct {
		Title string `json:"title"`
	} `json:"source"`
}

type notesAnnotationListBody struct {
	Items      []notesAnnotationBody `json:"items"`
	NextCursor string                `json:"next_cursor"`
}

type notesQuestionSetBody struct {
	ID            string              `json:"id"`
	Topic         string              `json:"topic"`
	QuestionCount int                 `json:"question_count"`
	Questions     []notesQuestionBody `json:"questions"`
}

type notesQuestionSetListBody struct {
	Items      []notesQuestionSetBody `json:"items"`
	NextCursor string                 `json:"next_cursor"`
}

type notesItemNoteBody struct {
	ID     *string `json:"id"`
	ItemID string  `json:"item_id"`
	Text   string  `json:"text"`
}

// TestAHighlightMadeInTheReaderIsThereAfterAReload is the first criterion, as
// the reader actually exercises it: a POST while reading, and then the list the
// reader asks for again when the page is loaded from nothing.
func TestAHighlightMadeInTheReaderIsThereAfterAReload(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Como ler devagar", "Antes do trecho. O trecho marcado. Depois do trecho.")

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   "O trecho marcado.",
			"prefix":  "Antes do trecho. ",
			"suffix":  " Depois do trecho.",
		}), http.StatusCreated)
	if created.Status != NotesAnchored {
		t.Fatalf("the highlight came back %q, want anchored", created.Status)
	}
	if created.Hint != 17 {
		t.Fatalf("the highlight was anchored at %d, want 17", created.Hint)
	}

	// A reload is a fresh read of the list, over a router that holds no state
	// between the two calls.
	listed := notesDecode[notesHighlightListBody](t,
		harness.request(http.MethodGet, "/api/notes/highlights?item_id="+itemID, nil), http.StatusOK)
	if len(listed.Items) != 1 || listed.Items[0].ID != created.ID {
		t.Fatalf("the reload listed %d highlights: %+v", len(listed.Items), listed.Items)
	}
	if listed.Items[0].Source == nil || listed.Items[0].Source.Title != "Como ler devagar" {
		t.Fatalf("the highlight came back without its source title: %+v", listed.Items[0].Source)
	}
}

// TestSelectingTheSecondOfTwoIdenticalOccurrences is the criterion that says
// what must never happen: the highlight must not come back anchored to the
// first occurrence, because that would move the person's mark to words they
// were not reading.
func TestSelectingTheSecondOfTwoIdenticalOccurrences(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Repetido",
		"Igual: a mesma frase. fim. Igual: a mesma frase. fim.")

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   "a mesma frase.",
			"prefix":  "Igual: ",
			"suffix":  " fim.",
		}), http.StatusCreated)
	if created.Status != NotesOrphaned {
		t.Fatalf("the highlight came back %q, want orphaned", created.Status)
	}
	if !created.Ambiguous {
		t.Fatal("the answer did not say the passage was ambiguous rather than missing")
	}
	if created.Hint != 0 {
		t.Fatalf("an orphaned highlight was given the offset %d", created.Hint)
	}
	if created.Exact != "a mesma frase." {
		t.Fatalf("the passage was not kept: %q", created.Exact)
	}
}

// TestWhitespaceAndNonBMPContextStillAnchorThroughTheAPI is the other half of
// the same criterion, over the wire rather than over the search: what the
// browser hands back is not spaced the way the extracted text is.
func TestWhitespaceAndNonBMPContextStillAnchorThroughTheAPI(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Espaços", "Começo 𝄞𝄢 o trecho marcado 𝄞𝄢 fim.")

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   "o   trecho\n\nmarcado",
			"prefix":  "Começo 𝄞𝄢\t",
			"suffix":  "\n𝄞𝄢 fim.",
		}), http.StatusCreated)
	if created.Status != NotesAnchored {
		t.Fatalf("the highlight came back %q, want anchored", created.Status)
	}
	if created.Hint != 10 {
		t.Fatalf("the highlight was anchored at %d code points, want 10", created.Hint)
	}
}

// TestVirarHighlightOnASavedSelection is the reader's action on the box that
// shows what was selected when the link was saved: the same create call, with
// the stored selection's three fields.
func TestVirarHighlightOnASavedSelection(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Com seleção", "Antes do trecho. O trecho marcado. Depois do trecho.")
	if _, err := harness.database.Writer().Exec(
		`UPDATE library_items SET selection = ? WHERE id = ?`,
		`{"exact":"O trecho marcado.","prefix":"Antes do trecho. ","suffix":" Depois do trecho."}`,
		itemID); err != nil {
		t.Fatalf("storing the saved selection: %v", err)
	}

	created := notesDecode[notesHighlightBody](t, harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{
			"item_id": itemID,
			"exact":   "O trecho marcado.",
			"prefix":  "Antes do trecho. ",
			"suffix":  " Depois do trecho.",
		}), http.StatusCreated)
	if created.Exact != "O trecho marcado." || created.Status != NotesAnchored {
		t.Fatalf("virar highlight stored %q as %q", created.Exact, created.Status)
	}
}

// TestAQuestionSetStoresOnlyThePromptsThePersonWroteInto is the criterion
// about the six prompts: the set is a form with six boxes, and an empty box is
// not a question.
func TestAQuestionSetStoresOnlyThePromptsThePersonWroteInto(t *testing.T) {
	harness := newNotesHarness(t)

	set := notesDecode[notesQuestionSetBody](t, harness.request(http.MethodPost, "/api/notes/question-sets",
		map[string]any{
			"topic": "Kubernetes",
			"questions": []map[string]string{
				{"kind": "why", "text": "Por que um pod é a unidade de agendamento?"},
				{"kind": "how", "text": "Como um serviço encontra seus pods?"},
				{"kind": "what", "text": "   "},
			},
		}), http.StatusCreated)

	if set.Topic != "Kubernetes" {
		t.Fatalf("the set came back on topic %q", set.Topic)
	}
	if set.QuestionCount != 2 || len(set.Questions) != 2 {
		t.Fatalf("the set stored %d questions: %+v", set.QuestionCount, set.Questions)
	}
	kinds := map[string]bool{}
	for _, question := range set.Questions {
		if question.Kind == nil {
			t.Fatalf("a question of the set carries no kind: %+v", question)
		}
		kinds[*question.Kind] = true
	}
	if !kinds["why"] || !kinds["how"] || len(kinds) != 2 {
		t.Fatalf("the stored kinds are %v, want why and how", kinds)
	}

	var module, itemType, title string
	if err := harness.database.Reader().QueryRow(
		`SELECT module, type, title FROM core_items WHERE id = ?`, set.ID).Scan(&module, &itemType, &title); err != nil {
		t.Fatalf("reading the set's registry row: %v", err)
	}
	if module != ModuleName || itemType != NotesQuestionSetItemType || title != "Kubernetes" {
		t.Fatalf("the registry row is %s/%s/%q", module, itemType, title)
	}
}

// TestVirarPerguntaFromAnAnnotation is the reader's action at the end of a
// reading: a question that remembers the margin note it came out of.
func TestVirarPerguntaFromAnAnnotation(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Um artigo", "Antes. O trecho marcado. Depois.")
	annotation := notesDecode[notesAnnotationBody](t, harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "text": "isto merece uma pergunta"}), http.StatusCreated)

	question := notesDecode[notesQuestionBody](t, harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{
			"item_id":       itemID,
			"annotation_id": annotation.ID,
			"text":          "Por que isto merece uma pergunta?",
		}), http.StatusCreated)

	if question.AnnotationID != annotation.ID {
		t.Fatalf("the question points at %q, want the annotation %q", question.AnnotationID, annotation.ID)
	}
	if question.Kind != nil {
		t.Fatalf("a question turned from an annotation was given the kind %q", *question.Kind)
	}
}

// TestASingleQuestionHasNoKindAndASetsPromptDoes is the criterion about the
// kind column, over the API: the kind means "this came from that prompt", so a
// question written on its own must not be given one.
func TestASingleQuestionHasNoKindAndASetsPromptDoes(t *testing.T) {
	harness := newNotesHarness(t)

	single := notesDecode[notesQuestionBody](t, harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{"text": "O que eu ainda não entendi aqui?"}), http.StatusCreated)
	if single.Kind != nil {
		t.Fatalf("a single question was stored with kind %q", *single.Kind)
	}
	if notesCount(t, harness, `SELECT COUNT(*) FROM notes_questions WHERE id = ? AND kind IS NULL`,
		single.ID) != 1 {
		t.Fatal("the single question's kind is not NULL in the table")
	}

	set := notesDecode[notesQuestionSetBody](t, harness.request(http.MethodPost, "/api/notes/question-sets",
		map[string]any{
			"topic":     "Kubernetes",
			"questions": []map[string]string{{"kind": "why", "text": "Por que isto existe?"}},
		}), http.StatusCreated)
	if notesCount(t, harness, `SELECT COUNT(*) FROM notes_questions WHERE set_id = ? AND kind = 'why'`,
		set.ID) != 1 {
		t.Fatal("the set's why prompt did not store kind = why")
	}
}

// TestAKindTheContractDoesNotNameIsRefusedBeforeTheHandler is the contract
// doing its half of the same job: the validator rejects it, so the CHECK never
// has to.
func TestAKindTheContractDoesNotNameIsRefusedBeforeTheHandler(t *testing.T) {
	harness := newNotesHarness(t)
	recorder := harness.request(http.MethodPost, "/api/notes/questions",
		map[string]any{"text": "Uma pergunta?", "kind": "other"})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("kind 'other' answered %d: %s", recorder.Code, recorder.Body.String())
	}
}

// TestTheItemNoteIsOneBoxPerItem is the reader's "Nota" tab: an item with no
// note reads as an empty one, a write replaces whatever was there, and emptying
// it leaves no row behind.
func TestTheItemNoteIsOneBoxPerItem(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Um artigo", "Antes. O trecho marcado. Depois.")
	path := "/api/notes/items/" + itemID + "/note"

	empty := notesDecode[notesItemNoteBody](t, harness.request(http.MethodGet, path, nil), http.StatusOK)
	if empty.Text != "" || empty.ID != nil {
		t.Fatalf("an item with no note answered %+v", empty)
	}

	written := notesDecode[notesItemNoteBody](t, harness.request(http.MethodPut, path,
		map[string]any{"text": "a primeira versão"}), http.StatusOK)
	if written.Text != "a primeira versão" || written.ID == nil {
		t.Fatalf("the written note came back as %+v", written)
	}

	rewritten := notesDecode[notesItemNoteBody](t, harness.request(http.MethodPut, path,
		map[string]any{"text": "a segunda versão"}), http.StatusOK)
	if rewritten.Text != "a segunda versão" {
		t.Fatalf("the rewrite came back as %+v", rewritten)
	}
	if count := notesCount(t, harness, `SELECT COUNT(*) FROM notes_notes WHERE item_id = ?`, itemID); count != 1 {
		t.Fatalf("the item carries %d notes, want one", count)
	}

	cleared := notesDecode[notesItemNoteBody](t, harness.request(http.MethodPut, path,
		map[string]any{"text": "   "}), http.StatusOK)
	if cleared.Text != "" || cleared.ID != nil {
		t.Fatalf("emptying the note answered %+v", cleared)
	}
	if count := notesCount(t, harness, `SELECT COUNT(*) FROM notes_notes WHERE item_id = ?`, itemID); count != 0 {
		t.Fatalf("emptying the note left %d rows behind", count)
	}
}

// TestANoteOnAnItemTheRegistryDoesNotKnow refuses a typo rather than storing a
// row whose origin can never be rendered.
func TestANoteOnAnItemTheRegistryDoesNotKnow(t *testing.T) {
	harness := newNotesHarness(t)
	recorder := harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": "nao-existe", "exact": "um trecho"})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("a highlight on an unknown item answered %d: %s", recorder.Code, recorder.Body.String())
	}
}

// TestEveryNotesListPagesWithoutRepeatingOrSkippingARow is the paging
// criterion, over all four lists: 120 rows come back as 50, 50 and 20, and the
// 120 ids are 120 distinct ids.
func TestEveryNotesListPagesWithoutRepeatingOrSkippingARow(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Um artigo longo", "Antes. O trecho marcado. Depois.")
	const fixtures = 120

	for index := range fixtures {
		// The clock does not move on its own here, so the rows would share a
		// created_at and the id alone would order them. Moving it a second per
		// row is what makes the primary sort key do its half of the work.
		harness.clock.Advance(notesWorkerStep)
		if _, err := harness.service.CreateHighlight(t.Context(), NewHighlightInput{
			ItemID: itemID, Exact: fmt.Sprintf("trecho %d", index),
		}); err != nil {
			t.Fatalf("creating the highlight %d: %v", index, err)
		}
		if _, err := harness.service.CreateAnnotation(t.Context(), NewAnnotationInput{
			ItemID: itemID, Text: fmt.Sprintf("anotação %d", index),
		}); err != nil {
			t.Fatalf("creating the annotation %d: %v", index, err)
		}
		if _, err := harness.service.CreateQuestion(t.Context(), NewQuestionInput{
			ItemID: itemID, Text: fmt.Sprintf("pergunta %d?", index),
		}); err != nil {
			t.Fatalf("creating the question %d: %v", index, err)
		}
		if _, err := harness.service.CreateQuestionSet(t.Context(), NewQuestionSetInput{
			Topic: fmt.Sprintf("tópico %d", index),
		}); err != nil {
			t.Fatalf("creating the question set %d: %v", index, err)
		}
	}

	for _, list := range []struct {
		name  string
		path  string
		pages func(cursor string) ([]string, string)
	}{
		{
			name: "highlights",
			pages: func(cursor string) ([]string, string) {
				page := notesDecode[notesHighlightListBody](t, harness.request(http.MethodGet,
					notesListPath("/api/notes/highlights", cursor), nil), http.StatusOK)
				ids := make([]string, 0, len(page.Items))
				for _, item := range page.Items {
					ids = append(ids, item.ID)
				}
				return ids, page.NextCursor
			},
		},
		{
			name: "annotations",
			pages: func(cursor string) ([]string, string) {
				page := notesDecode[notesAnnotationListBody](t, harness.request(http.MethodGet,
					notesListPath("/api/notes/annotations", cursor), nil), http.StatusOK)
				ids := make([]string, 0, len(page.Items))
				for _, item := range page.Items {
					ids = append(ids, item.ID)
				}
				return ids, page.NextCursor
			},
		},
		{
			name: "questions",
			pages: func(cursor string) ([]string, string) {
				page := notesDecode[notesQuestionListBody](t, harness.request(http.MethodGet,
					notesListPath("/api/notes/questions", cursor), nil), http.StatusOK)
				ids := make([]string, 0, len(page.Items))
				for _, item := range page.Items {
					ids = append(ids, item.ID)
				}
				return ids, page.NextCursor
			},
		},
		{
			name: "question sets",
			pages: func(cursor string) ([]string, string) {
				page := notesDecode[notesQuestionSetListBody](t, harness.request(http.MethodGet,
					notesListPath("/api/notes/question-sets", cursor), nil), http.StatusOK)
				ids := make([]string, 0, len(page.Items))
				for _, item := range page.Items {
					ids = append(ids, item.ID)
				}
				return ids, page.NextCursor
			},
		},
	} {
		t.Run(list.name, func(t *testing.T) {
			seen := map[string]bool{}
			sizes := []int{}
			cursor := ""
			for page := 0; page < 10; page++ {
				ids, next := list.pages(cursor)
				sizes = append(sizes, len(ids))
				for _, id := range ids {
					if seen[id] {
						t.Fatalf("the row %s came back on two pages", id)
					}
					seen[id] = true
				}
				cursor = next
				if cursor == "" {
					break
				}
			}
			if fmt.Sprint(sizes) != "[50 50 20]" {
				t.Fatalf("the pages were %v, want [50 50 20]", sizes)
			}
			if len(seen) != fixtures {
				t.Fatalf("%d distinct rows came back, want %d", len(seen), fixtures)
			}
		})
	}
}

// TestACursorPresentedWithOtherFiltersIsRefused is why the filters are hashed
// into the cursor: continuing after a position in one query's order is
// meaningless in another's, and answering anyway would silently skip rows.
func TestACursorPresentedWithOtherFiltersIsRefused(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Um artigo", "Antes. O trecho marcado. Depois.")
	for index := range 60 {
		harness.clock.Advance(notesWorkerStep)
		if _, err := harness.service.CreateHighlight(t.Context(), NewHighlightInput{
			ItemID: itemID, Exact: fmt.Sprintf("trecho %d", index),
		}); err != nil {
			t.Fatalf("creating the highlight %d: %v", index, err)
		}
	}
	first := notesDecode[notesHighlightListBody](t,
		harness.request(http.MethodGet, "/api/notes/highlights", nil), http.StatusOK)
	if first.NextCursor == "" {
		t.Fatal("the first page offered no cursor")
	}

	recorder := harness.request(http.MethodGet,
		"/api/notes/highlights?q=trecho&cursor="+url.QueryEscape(first.NextCursor), nil)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("the reused cursor answered %d: %s", recorder.Code, recorder.Body.String())
	}
}

// TestTheTextFilterNarrowsByTheNotesOwnTextAndBySource is the Notas filter box,
// which has to find a note by what it says and by where it came from.
func TestTheTextFilterNarrowsByTheNotesOwnTextAndBySource(t *testing.T) {
	harness := newNotesHarness(t)
	compilation := harness.saveArticle("Como compiladores leem código", "Antes. Uma frase sobre parsing. Depois.")
	garden := harness.saveArticle("O jardim digital", "Antes. Uma frase sobre jardins. Depois.")

	for _, seed := range []struct {
		item string
		text string
	}{
		{compilation, "registrar exemplos ajuda"},
		{garden, "plantar ideias devagar"},
	} {
		harness.clock.Advance(notesWorkerStep)
		if _, err := harness.service.CreateAnnotation(t.Context(), NewAnnotationInput{
			ItemID: seed.item, Text: seed.text,
		}); err != nil {
			t.Fatalf("creating an annotation: %v", err)
		}
	}

	byText := notesDecode[notesAnnotationListBody](t, harness.request(http.MethodGet,
		"/api/notes/annotations?q="+url.QueryEscape("registrar exemplos"), nil), http.StatusOK)
	if len(byText.Items) != 1 || byText.Items[0].Text != "registrar exemplos ajuda" {
		t.Fatalf("the text filter found %+v", byText.Items)
	}

	bySource := notesDecode[notesAnnotationListBody](t, harness.request(http.MethodGet,
		"/api/notes/annotations?q="+url.QueryEscape("jardim"), nil), http.StatusOK)
	if len(bySource.Items) != 1 || bySource.Items[0].Text != "plantar ideias devagar" {
		t.Fatalf("the source filter found %+v", bySource.Items)
	}
}

// TestTheCountsAreOneCallRatherThanThreeLists is what the sidebar and the tabs
// read.
func TestTheCountsAreOneCallRatherThanThreeLists(t *testing.T) {
	harness := newNotesHarness(t)
	itemID := harness.saveArticle("Um artigo", "Antes. O trecho marcado. Depois.")
	harness.request(http.MethodPost, "/api/notes/highlights",
		map[string]any{"item_id": itemID, "exact": "O trecho marcado."})
	harness.request(http.MethodPost, "/api/notes/annotations",
		map[string]any{"item_id": itemID, "text": "uma anotação"})
	harness.request(http.MethodPost, "/api/notes/questions", map[string]any{"text": "uma pergunta?"})
	harness.request(http.MethodPost, "/api/notes/question-sets", map[string]any{"topic": "Kubernetes"})

	counts := notesDecode[map[string]int](t,
		harness.request(http.MethodGet, "/api/notes/counts", nil), http.StatusOK)
	for name, want := range map[string]int{
		"highlights": 1, "anotacoes": 1, "perguntas": 1, "conjuntos": 1,
	} {
		if counts[name] != want {
			t.Fatalf("%s counted %d, want %d (all: %v)", name, counts[name], want, counts)
		}
	}
}

func notesListPath(base, cursor string) string {
	if cursor == "" {
		return base
	}
	return base + "?cursor=" + url.QueryEscape(cursor)
}
