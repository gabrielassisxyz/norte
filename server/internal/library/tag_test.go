// The tagger's tests: the normalizer, the job against the stub LLM endpoint,
// and the extraction side that enqueues the job when an LLM is configured.
package library

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/llmtest"
)

// TestTheTagNormalizerKeepsOneSpellingOfEveryName is the vocabulary rule: the
// same words in the same order always reach the same tag, whatever the model
// or the person typed. One row per case, because each rule is separately
// violated by a plausible answer.
func TestTheTagNormalizerKeepsOneSpellingOfEveryName(t *testing.T) {
	long := strings.Repeat("a", libraryTagMaxNameRunes)
	tooLong := strings.Repeat("a", libraryTagMaxNameRunes+1)
	for _, tc := range []struct {
		name    string
		raw     string
		removed map[string]bool
		want    string
		wantKept bool
	}{
		{"case folds", "LLM", nil, "llm", true},
		{"inner whitespace collapses", "machine   learning", nil, "machine learning", true},
		{"surrounding whitespace goes", "  rust  ", nil, "rust", true},
		{"surrounding punctuation goes", "-machine learning-", nil, "machine learning", true},
		{"punctuation on both ends goes", "--LLM?!", nil, "llm", true},
		{"an empty answer", "   ", nil, "", false},
		{"a tag that is only punctuation", "!!!", nil, "", false},
		{"a name past the cap", tooLong, nil, "", false},
		{"a name exactly at the cap", long, nil, long, true},
		{"a removed tag", "llm", map[string]bool{"llm": true}, "", false},
		{"a removal is spelled by the normalized name", "LLM!!", map[string]bool{"llm": true}, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := libraryNormalizeTags([]string{tc.raw}, tc.removed)
			if tc.wantKept && (len(got) != 1 || got[0] != tc.want) {
				t.Fatalf("libraryNormalizeTags(%q) = %v, want [%q]", tc.raw, got, tc.want)
			}
			if !tc.wantKept && len(got) != 0 {
				t.Fatalf("libraryNormalizeTags(%q) = %v, want nothing kept", tc.raw, got)
			}
		})
	}

	t.Run("the same name twice is one opinion", func(t *testing.T) {
		got := libraryNormalizeTags([]string{"llm", " LLM ", "LLM!"}, nil)
		if len(got) != 1 || got[0] != "llm" {
			t.Fatalf("the duplicates collapsed to %v, want [llm]", got)
		}
	})

	t.Run("more than eight keeps the model's first eight in order", func(t *testing.T) {
		proposed := []string{}
		for i := 1; i <= libraryTagMaxTags+3; i++ {
			proposed = append(proposed, fmt.Sprintf("tag-%02d", i))
		}
		got := libraryNormalizeTags(proposed, nil)
		want := []string{"tag-01", "tag-02", "tag-03", "tag-04", "tag-05", "tag-06", "tag-07", "tag-08"}
		if len(got) != libraryTagMaxTags {
			t.Fatalf("%d tags survived, want %d", len(got), libraryTagMaxTags)
		}
		for i, name := range want {
			if got[i] != name {
				t.Fatalf("the %dth kept tag is %q, want %q (the answer's %dth)", i, got[i], name, i)
			}
		}
	})
}

// newLibraryTagTestItem produces one saved and extracted item, with the
// reason the tagger is asked to read, on the harness's own clock.
func newLibraryTagTestItem(t *testing.T, harness *libraryExtractHarness, pageURL string, reason string) string {
	t.Helper()
	page, err := os.ReadFile("testdata/pages/essay.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}
	outcome, err := harness.service.Save(context.Background(), SaveInput{
		URL: pageURL, HTML: page, Reason: reason, Source: LibrarySourceCLI,
	})
	if err != nil {
		t.Fatalf("saving %s: %v", pageURL, err)
	}
	if err := harness.run(outcome.ID, 1, false, 1); err != nil {
		t.Fatalf("extracting %s: %v", outcome.ID, err)
	}
	return outcome.ID
}

// seedTag writes one tag the way the tagger leaves it, straight into the
// tables, on an item the test has already saved.
func seedTag(t *testing.T, database *core.Database, itemID, name string) {
	t.Helper()
	stamp := core.FormatTime(libraryFixedInstant)
	if _, err := database.Writer().Exec(
		`INSERT INTO library_tags (name, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`,
		name, stamp); err != nil {
		t.Fatalf("seeding the tag %s: %v", name, err)
	}
	if _, err := database.Writer().Exec(
		`INSERT INTO library_item_tags (item_id, tag_name, origin, created_at)
		 VALUES (?, ?, 'auto', ?) ON CONFLICT DO NOTHING`,
		itemID, name, stamp); err != nil {
		t.Fatalf("seeding %s's tag %s: %v", itemID, name, err)
	}
}

// readTagRows reads an item's stored tags with their origins, ordered by
// name, which is the order the endpoint answers in.
func readTagRows(t *testing.T, database *core.Database, itemID string) []struct {
	name   string
	origin string
} {
	t.Helper()
	rows, err := database.Reader().Query(
		`SELECT tag_name, origin FROM library_item_tags WHERE item_id = ? ORDER BY tag_name ASC`, itemID)
	if err != nil {
		t.Fatalf("reading the tags of %s: %v", itemID, err)
	}
	defer rows.Close()
	out := []struct {
		name   string
		origin string
	}{}
	for rows.Next() {
		var name, origin string
		if err := rows.Scan(&name, &origin); err != nil {
			t.Fatalf("scanning a tag row: %v", err)
		}
		out = append(out, struct {
			name   string
			origin string
		}{name, origin})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading the tags of %s: %v", itemID, err)
	}
	return out
}

// runTagger runs the handler over the payload an extraction would have queued.
func runTagger(t *testing.T, tagger *LibraryTagger, itemID string) error {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"item_id": itemID})
	if err != nil {
		t.Fatalf("encoding the tag payload: %v", err)
	}
	return tagger.Handle(context.Background(), core.Job{
		ID:          "job-" + itemID,
		Kind:        LibraryTagJobKind,
		Payload:     string(payload),
		Attempt:     1,
		MaxAttempts: core.JobsMaxAttempts,
	})
}

// TestTheTagJobReadsThePersonAndTheVocabularyAndStoresItsAnswer is the one
// run of the job, end to end against the stub endpoint: the prompt carries
// what the bead names, the answer is normalized into rows, and the schema is
// part of the request the endpoint sees.
func TestTheTagJobReadsThePersonAndTheVocabularyAndStoresItsAnswer(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	mine := newLibraryTagTestItem(t, harness, "https://example.org/tag-me", "to quote later in the reading log")
	other := newLibraryTagTestItem(t, harness, "https://example.org/tag-source", "")
	seedTag(t, harness.database, other, "llm")
	seedTag(t, harness.database, other, "long form model")

	item := harness.item(mine)
	if !item.ContentText.Valid || item.ContentText.String == "" {
		t.Fatal("the item extracted to no text, so the prompt below is empty")
	}

	stub := llmtest.New(`{"tags":[" LLM ","Machine Learning!!","llm","",` +
		fmt.Sprintf(`"%s",`, strings.Repeat("a", libraryTagMaxNameRunes+1)) +
		`"memory"]}`)
	defer stub.Close()
	tagger := NewLibraryTagger(LibraryTagOptions{
		Database: harness.database,
		Clock:    harness.clock,
		LLM:      core.NewLLM(stub.URL(), "a-test-model", "sk-tag-test"),
	})
	if err := runTagger(t, tagger, mine); err != nil {
		t.Fatalf("the tag job failed: %v", err)
	}

	requests := stub.Requests()
	if len(requests) != 1 {
		t.Fatalf("the stub answered %d completions, want 1", len(requests))
	}
	call := requests[0]
	if call.SchemaName != libraryTagSchemaName {
		t.Errorf("the request names the schema %q, want %q", call.SchemaName, libraryTagSchemaName)
	}
	if !strings.Contains(call.System, `{"tags": ["<tag>", "<tag>"]}`) {
		t.Error("the system prompt never spells the answer shape in words")
	}
	if !strings.Contains(call.System, "5 to 8") {
		t.Error("the system prompt never says how many tags it wants")
	}
	for _, want := range []string{libraryClassifyContentOpen, "TITLE: " + item.Title,
		"WHY SAVED: " + item.Reason.String, libraryClassifyContentClose} {
		if !strings.Contains(call.User, want) {
			t.Errorf("the user message lacks %q:\n%.400s", want, call.User)
		}
	}
	// The text is what the model reads the page through: the fence holds the
	// item's own extracted text, not another item's or a placeholder.
	first := item.ContentText.String
	if len([]rune(first)) > 40 {
		first = string([]rune(first)[:40])
	}
	if !strings.Contains(call.User, first) {
		t.Errorf("the user message never carries the item's own extracted text (%q)", first)
	}
	for _, want := range []string{"- llm", "- long form model"} {
		if !strings.Contains(call.User, want) {
			t.Errorf("the user message lacks the existing tag line %q", want)
		}
	}

	rows := readTagRows(t, harness.database, mine)
	got := []string{}
	for _, row := range rows {
		got = append(got, row.name)
		if row.origin != libraryTagOriginAuto {
			t.Errorf("the tag %s was stored as %q, want auto", row.name, row.origin)
		}
	}
	// " LLM " and "llm" normalize to one row; the empty answer and the name
	// past the cap are dropped by the normalizer, not stored.
	want := []string{"llm", "machine learning", "memory"}
	if len(got) != len(want) {
		t.Fatalf("the item carries %v, want %v", got, want)
	}
	for i, name := range want {
		if got[i] != name {
			t.Fatalf("the item carries %v, want %v", got, want)
		}
	}
}

// TestTheTagJobReplacesTheAutomaticRowsAndKeepsTheHandOnes is the edit rule:
// a second answer is a replacement of what the model may speak for, and
// nothing else in the item's tag row set.
func TestTheTagJobReplacesTheAutomaticRowsAndKeepsTheHandOnes(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	id := newLibraryTagTestItem(t, harness, "https://example.org/rewrite", "")

	stub := llmtest.New(`{"tags":["llm","rust"]}`)
	defer stub.Close()
	tagger := NewLibraryTagger(LibraryTagOptions{
		Database: harness.database, Clock: harness.clock,
		LLM: core.NewLLM(stub.URL(), "a-test-model", ""),
	})
	if err := runTagger(t, tagger, id); err != nil {
		t.Fatalf("the first run failed: %v", err)
	}
	if _, err := harness.service.AddItemTag(context.Background(), id, "docker"); err != nil {
		t.Fatalf("the hand add failed: %v", err)
	}

	stub.Answer(`{"tags":["rust","memory"]}`)
	if err := runTagger(t, tagger, id); err != nil {
		t.Fatalf("the second run failed: %v", err)
	}

	rows := readTagRows(t, harness.database, id)
	got := map[string]string{}
	for _, row := range rows {
		got[row.name] = row.origin
	}
	if len(got) != 3 {
		t.Fatalf("the item carries %v, want docker, memory and rust", got)
	}
	if got["rust"] != libraryTagOriginAuto {
		t.Errorf("rust, in both answers, is %q, want auto", got["rust"])
	}
	if got["memory"] != libraryTagOriginAuto {
		t.Errorf("memory, new in the second answer, is %q, want auto", got["memory"])
	}
	if got["docker"] != libraryTagOriginManual {
		t.Errorf("docker, added by hand and absent from the answer, is %q, want manual",
			got["docker"])
	}
}

// TestTheTagJobNeverBringsBackAHandRemoval is the rule a tag removed from one
// item must survive: every later answer for that item is short the name.
func TestTheTagJobNeverBringsBackAHandRemoval(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	id := newLibraryTagTestItem(t, harness, "https://example.org/removed", "")

	stub := llmtest.New(`{"tags":["llm","rust"]}`)
	defer stub.Close()
	tagger := NewLibraryTagger(LibraryTagOptions{
		Database: harness.database, Clock: harness.clock,
		LLM: core.NewLLM(stub.URL(), "a-test-model", ""),
	})
	if err := runTagger(t, tagger, id); err != nil {
		t.Fatalf("the first run failed: %v", err)
	}
	if _, err := harness.service.RemoveItemTag(context.Background(), id, "llm"); err != nil {
		t.Fatalf("the hand removal failed: %v", err)
	}

	stub.Answer(`{"tags":["llm","docker"]}`)
	if err := runTagger(t, tagger, id); err != nil {
		t.Fatalf("the second run failed: %v", err)
	}
	rows := readTagRows(t, harness.database, id)
	have := map[string]bool{}
	for _, row := range rows {
		have[row.name] = true
	}
	if have["llm"] {
		t.Error("llm, removed by hand, came back in a later answer")
	}
	if !have["docker"] {
		t.Error("docker, answered and never removed, is missing")
	}
	if have["rust"] {
		t.Error("rust, owned by the first answer and absent from the second, was kept instead of replaced")
	}
}

// TestTheTagJobRetriesAnAnswerItCannotRead is the broken-endpoint rule: an
// answer that is prose, or JSON that is not the shape the schema asked for,
// is returned to the queue rather than written down as an opinion of no tags.
func TestTheTagJobRetriesAnAnswerItCannotRead(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
	}{
		{"prose", "I would tag this llm, rust and memory."},
		{"valid JSON of another shape", `{"suggestions":[]}`},
		{"a null list", `{"tags":null}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
			id := newLibraryTagTestItem(t, harness, "https://example.org/prose", "")

			stub := llmtest.New(`{"tags":["llm"]}`)
			defer stub.Close()
			tagger := NewLibraryTagger(LibraryTagOptions{
				Database: harness.database, Clock: harness.clock,
				LLM: core.NewLLM(stub.URL(), "a-test-model", ""),
			})
			if err := runTagger(t, tagger, id); err != nil {
				t.Fatalf("the first run failed: %v", err)
			}

			stub.Answer(tc.content)
			err := runTagger(t, tagger, id)
			if err == nil {
				t.Fatalf("the %s answer was stored", tc.name)
			}
			if core.IsPermanent(err) {
				t.Fatalf("the unreadable answer failed permanently (%v); the queue must retry it", err)
			}
			rows := readTagRows(t, harness.database, id)
			if len(rows) != 1 || rows[0].name != "llm" {
				t.Fatalf("the first answer's rows did not survive the second run: %v", rows)
			}
		})
	}
}

// TestExtractionEnqueuesOneTagJobWithItsDedupeKey is the extraction side: the
// job is enqueued inside the extraction's transaction, under the key the
// queue collapses replays on, and no success writes a second one.
func TestExtractionEnqueuesOneTagJobWithItsDedupeKey(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	page, err := os.ReadFile("testdata/pages/bliki.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}
	id := harness.save("https://haldonsoftware.example/tag-once", page)

	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the extraction failed: %v", err)
	}
	if got := harness.countJobs(LibraryTagJobKind); got != 1 {
		t.Fatalf("one extraction left %d tag jobs, want 1", got)
	}
	var key string
	if err := harness.database.Reader().QueryRow(
		`SELECT dedupe_key FROM core_jobs WHERE kind = ? LIMIT 1`, LibraryTagJobKind).Scan(&key); err != nil {
		t.Fatalf("reading the enqueued tag job: %v", err)
	}
	if key != "tag:"+id {
		t.Errorf("the tag job's dedupe key is %q, want tag:%s", key, id)
	}

	// A replay of the same run is collapsed on the key, not written again.
	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the replay failed: %v", err)
	}
	if got := harness.countJobs(LibraryTagJobKind); got != 1 {
		t.Errorf("two runs left %d tag jobs, want 1", got)
	}
}

// TestExtractionEnqueuesTaggingEvenForALinkedItem pins the one place the
// tag job differs from the classify job: a confirmed link is a person's
// decision about where an item belongs, not about how it is named, so a
// linked item still gets tagged.
func TestExtractionEnqueuesTaggingEvenForALinkedItem(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: true})
	page, err := os.ReadFile("testdata/pages/bliki.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}
	target := harness.save("https://haldonsoftware.example/linked-target", page)
	id := harness.save("https://haldonsoftware.example/linked-source", page)

	tx, err := harness.database.Writer().Begin()
	if err != nil {
		t.Fatalf("beginning: %v", err)
	}
	if err := core.Links.Confirm(context.Background(), tx, harness.clock.Now(),
		id, target, core.LinkKindAbout); err != nil {
		t.Fatalf("confirming the link: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("committing: %v", err)
	}

	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the extraction failed: %v", err)
	}
	if got := harness.countJobs(LibraryTagJobKind); got != 1 {
		t.Errorf("a linked item got %d tag jobs, want 1", got)
	}
	if got := harness.countJobs(LibraryClassifyJobKind); got != 0 {
		t.Errorf("a linked item got %d classify jobs, want 0", got)
	}
}

// TestExtractionWithNoLLMEnqueuesNoTagJob is the configuration rule: the job
// has nothing to call, so a successful extraction enqueues none.
func TestExtractionWithNoLLMEnqueuesNoTagJob(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{LLM: false})
	page, err := os.ReadFile("testdata/pages/bliki.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}
	id := harness.save("https://haldonsoftware.example/untagged", page)
	if err := harness.run(id, 1, false, 1); err != nil {
		t.Fatalf("the extraction failed: %v", err)
	}
	if got := harness.countJobs(LibraryTagJobKind); got != 0 {
		t.Errorf("%d tag jobs with no LLM configured, want 0", got)
	}
}

// TestTheTaggerRefusesAJobItCannotServe names the two permanent failures: a
// payload that names no item, and an endpoint that is gone.
func TestTheTaggerRefusesAJobItCannotServe(t *testing.T) {
	stub := llmtest.New(`{"tags":["llm"]}`)
	defer stub.Close()
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	tagger := NewLibraryTagger(LibraryTagOptions{
		Database: harness.database, Clock: harness.clock,
		LLM: core.NewLLM(stub.URL(), "a-test-model", ""),
	})

	if err := runTagger(t, tagger, ""); err == nil {
		t.Error("a payload naming no item was accepted")
	} else if !core.IsPermanent(err) {
		t.Errorf("an unreadable payload failed retryably (%v), want permanent", err)
	}

	page, err := os.ReadFile("testdata/pages/bliki.html")
	if err != nil {
		t.Fatalf("reading the fixture: %v", err)
	}
	id := harness.save("https://haldonsoftware.example/marker", page)
	if err := runTagger(t, tagger, id+"-gone"); err == nil {
		t.Error("a job for an item that does not exist was accepted")
	} else if !core.IsPermanent(err) {
		t.Errorf("a job for a vanished item failed retryably (%v), want permanent", err)
	}

	gone := NewLibraryTagger(LibraryTagOptions{
		Database: harness.database, Clock: harness.clock,
		LLM: core.NewLLM("", "a-test-model", ""),
	})
	if err := runTagger(t, gone, id); err == nil {
		t.Error("a job ran with no endpoint configured")
	} else if !core.IsPermanent(err) {
		t.Errorf("the absent endpoint failed retryably (%v), want permanent", err)
	}
}