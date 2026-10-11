package app_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// TestTheFirstDeliveryWalksFromASavedLinkToANoteUnderASubject is the one path
// this product exists for, in one test, over the real router: a link is
// saved, its text is extracted, the model proposes where it belongs, the
// person accepts, marks a passage and writes down a question -- and the thing
// then shows up where it was supposed to show up.
//
// It is one test and not seven because what keeps breaking is the seams, not
// the steps. Every step here already has a unit test in its own package and
// every one of those passes against a fixture of the step before it; this is
// the only thing that fails when the extraction publishes an event the
// classifier is not listening for, or when a highlight anchors against text
// the library never wrote.
func TestTheFirstDeliveryWalksFromASavedLinkToANoteUnderASubject(t *testing.T) {
	harness := newNorteVerticalHarness(t, norteVerticalOptions{Classify: true})

	// 1. A subject the person is working on now. The focus flag is what makes
	// the saved item rank in "what to read now" once it is linked here.
	subject := norteVerticalDecode[norteVerticalSubject](t, harness.request(
		http.MethodPost, "/api/core/subjects",
		map[string]any{"name": "Memória de trabalho", "focus": true}), http.StatusCreated)
	if !subject.Focus {
		t.Fatalf("the subject was created with focus = %v, want true", subject.Focus)
	}
	harness.llm.Answer(fmt.Sprintf(`{"suggestions":[{"id":%q,"confidence":0.88}]}`, subject.ID))

	// 2. The save, carrying the rendered page. The extraction refuses
	// loopback and private addresses on purpose, so the page travels as a
	// snapshot -- which is what the browser extension does for every page
	// behind a login.
	saved := norteVerticalDecode[norteVerticalSaved](t, harness.request(
		http.MethodPost, "/api/library/items", map[string]any{
			"url":    norteVerticalPageURL,
			"title":  "Memória de trabalho",
			"html":   norteVerticalPage,
			"reason": "Para decidir como terminar uma leitura.",
		}), http.StatusCreated)

	// 3. Extraction, then classification: two jobs on one queue, the second
	// enqueued by the first.
	harness.drainJobs()
	if status := harness.extractStatus(saved.ID); status != "done" {
		t.Fatalf("extract_status = %q, want done", status)
	}
	if len(harness.llm.Requests()) != 1 {
		t.Fatalf("the classifier called the model %d times, want 1", len(harness.llm.Requests()))
	}

	// 4. The suggestion, as the review queue would read it.
	suggested := norteVerticalDecode[norteVerticalLinkList](t, harness.request(
		http.MethodGet, "/api/core/links?src_id="+saved.ID+"&status=suggested", nil), http.StatusOK)
	if len(suggested.Items) != 1 {
		t.Fatalf("the item has %d suggestions, want 1", len(suggested.Items))
	}
	suggestion := suggested.Items[0]
	if suggestion.Dst.ID != subject.ID {
		t.Fatalf("the suggestion points at %s, want the subject %s", suggestion.Dst.ID, subject.ID)
	}
	if suggestion.Source != "llm" || suggestion.Kind != "about" {
		t.Fatalf("the suggestion is %s/%s, want llm/about", suggestion.Source, suggestion.Kind)
	}
	if suggestion.Confidence == nil || *suggestion.Confidence < 0.87 || *suggestion.Confidence > 0.89 {
		t.Fatalf("the suggestion's confidence is %v, want the 0.88 the model answered",
			suggestion.Confidence)
	}

	// 5. The person accepts it.
	decided := norteVerticalDecode[norteVerticalLink](t, harness.request(
		http.MethodPost, "/api/core/links/"+suggestion.ID+"/decide",
		map[string]any{"decision": "accept"}), http.StatusOK)
	if decided.Status != "confirmed" {
		t.Fatalf("the accepted link is %q, want confirmed", decided.Status)
	}

	// 6. A passage marked. It anchors against the text the library extracted,
	// which is the seam only a whole walk exercises: the notes module never
	// reads a library table, it asks the core for the item's text.
	highlight := norteVerticalDecode[norteVerticalHighlight](t, harness.request(
		http.MethodPost, "/api/notes/highlights", map[string]any{
			"item_id": saved.ID,
			"exact":   norteVerticalPhrase,
		}), http.StatusCreated)
	if highlight.Status != "anchored" {
		t.Fatalf("the highlight is %q, want anchored against the extracted text", highlight.Status)
	}
	// A passage that is nowhere in the article. With no text provider the
	// notes module stores every highlight as anchored by default, so only a
	// highlight that comes back orphaned shows the extract-to-highlight link
	// is live: the text was read and the phrase was not in it.
	absent := norteVerticalDecode[norteVerticalHighlight](t, harness.request(
		http.MethodPost, "/api/notes/highlights", map[string]any{
			"item_id": saved.ID,
			"exact":   "Uma frase que o artigo nunca escreveu.",
		}), http.StatusCreated)
	if absent.Status != "orphaned" {
		t.Fatalf("a passage absent from the article is %q, want orphaned", absent.Status)
	}

	// 7. And a question written down, which is what ends the reading.
	question := norteVerticalDecode[norteVerticalQuestion](t, harness.request(
		http.MethodPost, "/api/notes/questions", map[string]any{
			"item_id": saved.ID,
			"text":    "Que peça eu consigo formar com isso?",
		}), http.StatusCreated)
	if question.Status != "open" {
		t.Fatalf("the question is %q, want open", question.Status)
	}

	// 8. The subject's panel now holds the item.
	panel := norteVerticalDecode[norteVerticalLinkList](t, harness.request(
		http.MethodGet, "/api/core/links?dst_id="+subject.ID+"&status=confirmed", nil), http.StatusOK)
	if len(panel.Items) != 1 || panel.Items[0].Src.ID != saved.ID {
		t.Fatalf("the subject's panel is %+v, want the saved item", panel.Items)
	}
	if panel.Items[0].Src.Module != "library" {
		t.Fatalf("the panel's item comes from module %q, want library", panel.Items[0].Src.Module)
	}

	// 9. And Suggestions puts it first, because the confirmed link to a focus
	// subject is the strongest thing that view ranks by.
	suggestions := norteVerticalDecode[norteVerticalItemList](t, harness.request(
		http.MethodGet, "/api/library/items?view=suggestions", nil), http.StatusOK)
	if len(suggestions.Items) == 0 || suggestions.Items[0].ID != saved.ID {
		t.Fatalf("view=suggestions answered %+v, want the saved item first", suggestions.Items)
	}

	// 10. The search finds it by a word that is only in the article's body,
	// and finds the subject by its name.
	byBody := norteVerticalDecode[norteVerticalSearchResults](t, harness.request(
		http.MethodGet, "/api/core/search?q="+norteVerticalBodyWord, nil), http.StatusOK)
	found := false
	for _, entry := range byBody.Entries {
		if entry.ID != saved.ID {
			continue
		}
		found = true
		if entry.Module != "library" {
			t.Errorf("the item came back from module %q, want library", entry.Module)
		}
		if entry.Path != "/library/"+saved.ID {
			t.Errorf("the item's path is %q, want /library/%s", entry.Path, saved.ID)
		}
	}
	if !found {
		t.Fatalf("searching for %q answered %+v, want the saved item",
			norteVerticalBodyWord, byBody.Entries)
	}

	bySubject := norteVerticalDecode[norteVerticalSearchResults](t, harness.request(
		http.MethodGet, "/api/core/search?q=memoria+de+trabalho", nil), http.StatusOK)
	if len(bySubject.Entries) == 0 {
		t.Fatal("searching for the subject's name answered nothing")
	}
	top := bySubject.Entries[0]
	if top.ID != subject.ID || top.Type != "subject" {
		t.Fatalf("the subject's name answered %+v first, want the subject", top)
	}
	if top.Path != "/assuntos/"+subject.Slug {
		t.Fatalf("the subject's path is %q, want /assuntos/%s", top.Path, subject.Slug)
	}

	// 11. The notes written along the way are findable too, which is the only
	// thing that proves the notes module contributes to the merge at all.
	byQuestion := norteVerticalDecode[norteVerticalSearchResults](t, harness.request(
		http.MethodGet, "/api/core/search?q=peca", nil), http.StatusOK)
	foundQuestion := false
	for _, entry := range byQuestion.Entries {
		if entry.ID == question.ID && entry.Module == "notes" {
			foundQuestion = true
		}
	}
	if !foundQuestion {
		t.Fatalf("searching for a word of the question answered %+v, want the question",
			byQuestion.Entries)
	}
}

// TestTheWalkStopsAtTheAcceptStepWithNoClassifier is the negative control the
// walk above needs to mean anything.
//
// Every assertion in that test would still pass if the classifier had been
// skipped and something else had written the link -- a leftover fixture, a
// default, the save's own link_to. This is the same walk with no LLM
// configured: the extraction still finishes, the text is still extracted and
// still searchable, and the walk then has nothing to accept, because there is
// no suggestion and no confirmed link. A suggestion appearing here would mean
// the main test was not exercising the classifier.
func TestTheWalkStopsAtTheAcceptStepWithNoClassifier(t *testing.T) {
	harness := newNorteVerticalHarness(t, norteVerticalOptions{Classify: false})

	subject := norteVerticalDecode[norteVerticalSubject](t, harness.request(
		http.MethodPost, "/api/core/subjects",
		map[string]any{"name": "Memória de trabalho", "focus": true}), http.StatusCreated)
	saved := norteVerticalDecode[norteVerticalSaved](t, harness.request(
		http.MethodPost, "/api/library/items", map[string]any{
			"url":   norteVerticalPageURL,
			"title": "Memória de trabalho",
			"html":  norteVerticalPage,
		}), http.StatusCreated)

	harness.drainJobs()

	// The extraction is not what was switched off, so it still has to finish:
	// a walk that stopped one step earlier would prove nothing about the
	// classifier.
	if status := harness.extractStatus(saved.ID); status != "done" {
		t.Fatalf("extract_status = %q, want done even with no classifier", status)
	}
	if calls := len(harness.llm.Requests()); calls != 0 {
		t.Fatalf("the model was called %d times with no LLM configured, want 0", calls)
	}

	suggested := norteVerticalDecode[norteVerticalLinkList](t, harness.request(
		http.MethodGet, "/api/core/links?src_id="+saved.ID+"&status=suggested", nil), http.StatusOK)
	if len(suggested.Items) != 0 {
		t.Fatalf("there are %d suggestions with no classifier, want none: %+v",
			len(suggested.Items), suggested.Items)
	}
	panel := norteVerticalDecode[norteVerticalLinkList](t, harness.request(
		http.MethodGet, "/api/core/links?dst_id="+subject.ID+"&status=confirmed", nil), http.StatusOK)
	if len(panel.Items) != 0 {
		t.Fatalf("the subject's panel holds %d items with no classifier, want none: %+v",
			len(panel.Items), panel.Items)
	}

	// The walk stops here: with no classifier there is nothing to accept, and
	// the two empty reads above are what say so.

	// What did not depend on the classifier still works, which is what makes
	// this a control and not just a broken server.
	found := norteVerticalDecode[norteVerticalSearchResults](t, harness.request(
		http.MethodGet, "/api/core/search?q="+norteVerticalBodyWord, nil), http.StatusOK)
	if !strings.Contains(fmt.Sprintf("%+v", found.Entries), saved.ID) {
		t.Fatalf("searching for %q answered %+v, want the saved item",
			norteVerticalBodyWord, found.Entries)
	}
}
