package library

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// libraryDeciderStub is a sidecar that answers one canned body, and records
// the request it was asked, so a test can assert on what Norte sent as well
// as on what it made of the reply.
type libraryDeciderStub struct {
	t      *testing.T
	status int
	body   string
	// requests is every decoded request body the stub received.
	requests []map[string]json.RawMessage
	paths    []string
}

func newLibraryDeciderStub(t *testing.T, status int, body string) (*libraryDeciderStub, *libraryDecider) {
	t.Helper()
	stub := &libraryDeciderStub{t: t, status: status, body: body}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stub.paths = append(stub.paths, r.URL.Path)
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("reading the decide request: %v", err)
		}
		var decoded map[string]json.RawMessage
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Errorf("the decide request is not a JSON object: %v", err)
		}
		stub.requests = append(stub.requests, decoded)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stub.status)
		_, _ = w.Write([]byte(stub.body))
	}))
	t.Cleanup(server.Close)
	return stub, newLibraryDecider(server.URL)
}

// libraryTestDecide asks the stub the router's own two questions over a small
// state, which is the shape every case here shares.
func libraryTestDecide(t *testing.T, decider *libraryDecider) (map[string]libraryDeciderAnswer, error) {
	t.Helper()
	return decider.Decide(context.Background(),
		map[string]string{"url": "https://example.org/a", "host": "example.org"},
		libraryRouteQuestions())
}

// TestTheDeciderClientSendsTheStateAndReadsTheProbabilities is the happy path:
// the sidecar's contract is state plus questions in, answers out, and the
// probabilities are what the router thresholds on.
func TestTheDeciderClientSendsTheStateAndReadsTheProbabilities(t *testing.T) {
	stub, decider := newLibraryDeciderStub(t, http.StatusOK, `{
		"answers": {
			"where": {"choice": "stash", "probabilities": {"stash": 0.94, "inbox": 0.06}},
			"kind":  {"choice": "video", "probabilities": {"video": 0.71, "article": 0.2}}
		},
		"usage": {"input_tokens": 267}
	}`)

	answers, err := libraryTestDecide(t, decider)
	if err != nil {
		t.Fatalf("deciding: %v", err)
	}
	if got := answers[libraryRouteWhereQuestion].probability(libraryLocationStash); got != 0.94 {
		t.Errorf("P(stash) = %v, want 0.94", got)
	}
	if got := answers[libraryRouteWhereQuestion].probability("nothing_scored_this"); got != 0 {
		t.Errorf("an unscored option read %v, want 0", got)
	}
	kind, probability := answers[libraryRouteKindQuestion].top()
	if kind != "video" || probability != 0.71 {
		t.Errorf("the top kind is %q at %v, want video at 0.71", kind, probability)
	}

	if len(stub.requests) != 1 {
		t.Fatalf("the sidecar saw %d requests, want 1", len(stub.requests))
	}
	if got := stub.paths[0]; got != libraryDecidePath {
		t.Errorf("the request went to %q, want %q", got, libraryDecidePath)
	}
	request := stub.requests[0]
	var state map[string]string
	if err := json.Unmarshal(request["state"], &state); err != nil {
		t.Fatalf("reading the state the sidecar saw: %v", err)
	}
	if state["host"] != "example.org" {
		t.Errorf("the state's host is %q, want example.org", state["host"])
	}
	var questions map[string]libraryDeciderQuestion
	if err := json.Unmarshal(request["questions"], &questions); err != nil {
		t.Fatalf("reading the questions the sidecar saw: %v", err)
	}
	for _, name := range []string{libraryRouteWhereQuestion, libraryRouteKindQuestion} {
		question, ok := questions[name]
		if !ok {
			t.Fatalf("the request asked no %q question", name)
		}
		if question.Type != "choice" {
			t.Errorf("%s is a %q question, want choice", name, question.Type)
		}
		if len(question.Criteria) == 0 {
			t.Errorf("%s arrived with no options", name)
		}
	}
	if _, ok := questions[libraryRouteWhereQuestion].Criteria[libraryLocationStash]; !ok {
		t.Error("the where question does not offer the stash")
	}
	for kind := range libraryValidKinds {
		if _, ok := questions[libraryRouteKindQuestion].Criteria[kind]; !ok {
			t.Errorf("the kind question does not offer %q", kind)
		}
	}
}

// TestADeciderWithNoURLIsNeverCalled: an empty NORTE_DECIDER_URL is not a
// client that fails on the wire, it is a client that says there is nobody to
// ask -- which is what lets the wiring skip the branch.
func TestADeciderWithNoURLIsNeverCalled(t *testing.T) {
	for _, raw := range []string{"", "   "} {
		decider := newLibraryDecider(raw)
		if decider.Configured() {
			t.Errorf("a decider built from %q reports itself configured", raw)
		}
		if _, err := libraryTestDecide(t, decider); !errors.Is(err, errLibraryNoDecider) {
			t.Errorf("deciding with %q answered %v, want errLibraryNoDecider", raw, err)
		}
	}
}

// TestADeciderAnsweringOutsideTwoHundredFails covers the non-2xx case, with
// the status in the message because that is the whole diagnosis: a 404 is a
// URL missing its path and a 503 is a model still loading.
func TestADeciderAnsweringOutsideTwoHundredFails(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusServiceUnavailable, http.StatusInternalServerError} {
		_, decider := newLibraryDeciderStub(t, status, `{"error": "no"}`)
		_, err := libraryTestDecide(t, decider)
		if err == nil {
			t.Fatalf("a %d answer succeeded", status)
		}
		if !strings.Contains(err.Error(), strconv.Itoa(status)) {
			t.Errorf("the %d failure reads %q, want the status in it", status, err)
		}
	}
}

// TestADeciderAnsweringSomethingElseFails: a 200 carrying a body that is not
// the answers envelope is a failure and never an empty opinion, for the
// reason the LLM client refuses one -- a broken sidecar must not read as a
// model with nothing to say.
func TestADeciderAnsweringSomethingElseFails(t *testing.T) {
	cases := map[string]string{
		"not JSON at all":        `<html>no</html>`,
		"no answers key":         `{"usage": {"input_tokens": 1}}`,
		"an empty answers":       `{"answers": {}}`,
		"answers of wrong shape": `{"answers": []}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			_, decider := newLibraryDeciderStub(t, http.StatusOK, body)
			if _, err := libraryTestDecide(t, decider); err == nil {
				t.Fatalf("%s succeeded", name)
			}
		})
	}
}

// TestADeciderThatNeverAnswersTimesOut: the call is bounded, and the bound is
// the five seconds the bead names. The test shrinks it rather than waiting it
// out, and asserts the constant separately so shrinking it here cannot hide a
// production default that drifted.
func TestADeciderThatNeverAnswersTimesOut(t *testing.T) {
	if libraryDecideTimeout != 5*time.Second {
		t.Errorf("libraryDecideTimeout is %v, want 5s", libraryDecideTimeout)
	}
	if got := newLibraryDecider("http://127.0.0.1:1").timeout; got != libraryDecideTimeout {
		t.Errorf("a built client's timeout is %v, want %v", got, libraryDecideTimeout)
	}

	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	// Registered after the server's own cleanup, so it runs first: a handler
	// still parked on the channel would hold Close for ever.
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(release) })

	decider := newLibraryDecider(server.URL)
	decider.timeout = 20 * time.Millisecond
	started := time.Now()
	if _, err := libraryTestDecide(t, decider); err == nil {
		t.Fatal("a decider that never answered succeeded")
	}
	if waited := time.Since(started); waited > 2*time.Second {
		t.Errorf("the call waited %v, want the client's own timeout", waited)
	}
}

// TestADeciderFailureNamesTheHostAndNotTheURL: the message travels into a log
// line, and a configured URL can carry a token in its query or its userinfo.
func TestADeciderFailureNamesTheHostAndNotTheURL(t *testing.T) {
	// Port 1 on the loopback refuses, which is the transport failure this is
	// about, and no test ever reaches anything else.
	decider := newLibraryDecider("http://user:s3cret@127.0.0.1:1/laya?token=s3cret")
	_, err := libraryTestDecide(t, decider)
	if err == nil {
		t.Fatal("asking a refused endpoint succeeded")
	}
	if strings.Contains(err.Error(), "s3cret") {
		t.Errorf("the failure leaks the credentials: %q", err)
	}
	if !strings.Contains(err.Error(), "127.0.0.1:1") {
		t.Errorf("the failure reads %q, want the host in it", err)
	}
}

// TestTheDecideEndpointIsSpelledOnce: both spellings of the setting are in the
// wild -- the base the sidecar hangs off and the decide endpoint itself -- and
// a query token must stay a query rather than swallowing the path.
func TestTheDecideEndpointIsSpelledOnce(t *testing.T) {
	cases := map[string]string{
		"http://decider:8091":          "http://decider:8091/decide",
		"http://decider:8091/":         "http://decider:8091/decide",
		"http://decider:8091/decide":   "http://decider:8091/decide",
		"http://decider:8091/decide/":  "http://decider:8091/decide",
		"http://decider:8091/l?k=v":    "http://decider:8091/l/decide?k=v",
		"http://decider:8091?k=v":      "http://decider:8091/decide?k=v",
		"http://decider:8091/a/decide": "http://decider:8091/a/decide",
	}
	for raw, want := range cases {
		if got := libraryDecideEndpoint(raw); got != want {
			t.Errorf("libraryDecideEndpoint(%q) = %q, want %q", raw, got, want)
		}
	}
}

// TestTheTopOptionIsReadFromTheProbabilities: the threshold is about the
// number, so the top option is the highest-scoring one even when the reply's
// own choice disagrees, and an equal pair resolves the same way every run.
func TestTheTopOptionIsReadFromTheProbabilities(t *testing.T) {
	answer := libraryDeciderAnswer{
		Choice:        "inbox",
		Probabilities: map[string]float64{"inbox": 0.2, "stash": 0.8},
	}
	if option, probability := answer.top(); option != "stash" || probability != 0.8 {
		t.Errorf("top() = %q at %v, want stash at 0.8", option, probability)
	}
	tied := libraryDeciderAnswer{Probabilities: map[string]float64{"video": 0.5, "article": 0.5}}
	for i := 0; i < 20; i++ {
		if option, _ := tied.top(); option != "article" {
			t.Fatalf("a tie resolved to %q, want article every time", option)
		}
	}
	empty := libraryDeciderAnswer{}
	if option, probability := empty.top(); option != "" || probability != 0 {
		t.Errorf("an answer with no probabilities read %q at %v, want none", option, probability)
	}
}
