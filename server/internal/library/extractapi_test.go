package library

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// TestTheExtractEndpointRetriesAFailedItem drives the retry through the real
// router, so the contract validator, the error envelope and the handler are the
// ones production mounts.
func TestTheExtractEndpointRetriesAFailedItem(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	id := harness.save("http://127.0.0.1/private", nil)
	if err := harness.run(id, 1, false, 1); err == nil {
		t.Fatal("the extraction succeeded")
	}
	if status := harness.item(id).ExtractStatus; status != "failed" {
		t.Fatalf("extract_status = %q, want failed", status)
	}
	before := harness.countJobs(LibraryExtractJobKind)

	router := newLibraryTestRouter(t, harness.database, harness.dataDir, harness.clock)
	recorder := doLibraryRequest(t, router, http.MethodPost,
		"/api/library/items/"+id+"/extract", map[string]any{})
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("the retry answered %d, want 202: %s", recorder.Code, recorder.Body.String())
	}
	var answered struct {
		ItemID            string `json:"item_id"`
		JobID             string `json:"job_id"`
		ExtractGeneration int    `json:"extract_generation"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &answered); err != nil {
		t.Fatalf("reading the answer: %v", err)
	}
	if answered.ItemID != id {
		t.Errorf("item_id = %q, want %q", answered.ItemID, id)
	}
	if answered.JobID == "" {
		t.Error("job_id is empty, so a failure cannot be found in `norte jobs list`")
	}
	if answered.ExtractGeneration != 2 {
		t.Errorf("extract_generation = %d, want 2", answered.ExtractGeneration)
	}
	if status := harness.item(id).ExtractStatus; status != "pending" {
		t.Errorf("extract_status = %q after the retry, want pending", status)
	}
	if got := harness.countJobs(LibraryExtractJobKind) - before; got != 1 {
		t.Errorf("the retry enqueued %d jobs, want exactly 1", got)
	}
}

func TestTheExtractEndpointWithNoBodyIsAccepted(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	id := harness.save("https://example.org/no-body", nil)
	router := newLibraryTestRouter(t, harness.database, harness.dataDir, harness.clock)
	recorder := doLibraryRequest(t, router, http.MethodPost, "/api/library/items/"+id+"/extract", nil)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("the retry answered %d, want 202: %s", recorder.Code, recorder.Body.String())
	}
}

func TestTheExtractEndpointRefusesAnUnknownItem(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	router := newLibraryTestRouter(t, harness.database, harness.dataDir, harness.clock)
	recorder := doLibraryRequest(t, router, http.MethodPost,
		"/api/library/items/missing/extract", map[string]any{"refresh": true})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("the retry answered %d, want 404: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"not_found"`) {
		t.Errorf("the answer carries no not_found code: %s", recorder.Body.String())
	}
}

// TestTheExtractEndpointRefusesAFieldTheContractDoesNotName is the
// additionalProperties rule, which is what keeps a client's typo from being
// dropped in silence.
func TestTheExtractEndpointRefusesAFieldTheContractDoesNotName(t *testing.T) {
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{})
	id := harness.save("https://example.org/strict", nil)
	router := newLibraryTestRouter(t, harness.database, harness.dataDir, harness.clock)
	recorder := doLibraryRequest(t, router, http.MethodPost,
		"/api/library/items/"+id+"/extract", map[string]any{"refetch": true})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("the retry answered %d, want 400: %s", recorder.Code, recorder.Body.String())
	}
}

// TestTheExtractCommandEnqueuesTheSameWork covers the other retry entry point
// against the real command line, in this process, with its own data directory.
func TestTheExtractCommandEnqueuesTheSameWork(t *testing.T) {
	// The command line opens the data directory itself, so this test drives
	// both halves through it rather than sharing a database handle: two
	// writers on one SQLite file is not what is under test here.
	dataDir := t.TempDir()
	saved, err := runLibraryCLI(t, dataDir, "save", "https://example.org/from-the-command-line")
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, saved)
	}
	id := strings.TrimSpace(saved)
	if id == "" {
		t.Fatal("norte save printed no id")
	}

	out, err := runLibraryCLI(t, dataDir, "extract", id)
	if err != nil {
		t.Fatalf("norte extract: %v\n%s", err, out)
	}
	if !strings.Contains(out, id) {
		t.Errorf("the command printed %q, want it to name the item", out)
	}
	if !strings.Contains(out, "generation 2") {
		t.Errorf("the command printed %q, want the generation it queued", out)
	}

	refreshOut, err := runLibraryCLI(t, dataDir, "extract", id, "--refresh")
	if err != nil {
		t.Fatalf("norte extract --refresh: %v\n%s", err, refreshOut)
	}
	if !strings.Contains(refreshOut, "generation 3") {
		t.Errorf("the refreshing command printed %q, want generation 3", refreshOut)
	}

	if _, err := runLibraryCLI(t, dataDir, "extract", "missing"); err == nil {
		t.Error("extracting an item that does not exist succeeded")
	}
}
