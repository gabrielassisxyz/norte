package library

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

const libraryCookieOtherHost = "other.test"

// libraryCookieNames resolves both fake hosts to the one listener.
var libraryCookieNames = map[string][]string{
	libraryFetchTestHost:   {libraryFetchTestIP},
	libraryCookieOtherHost: {"198.51.100.8"},
	"www.pages.test":       {"198.51.100.9"},
}

// libraryHopRecorder is a fake server that remembers, per request path, whether
// a Cookie header arrived and with what value. It redirects along a fixed chain.
type libraryHopRecorder struct {
	mu        sync.Mutex
	seen      map[string][]string
	redirects map[string]string
}

func newLibraryHopRecorder(redirects map[string]string) *libraryHopRecorder {
	return &libraryHopRecorder{seen: map[string][]string{}, redirects: redirects}
}

func (h *libraryHopRecorder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	h.seen[r.URL.Path] = r.Header.Values("Cookie")
	h.mu.Unlock()
	if next, ok := h.redirects[r.URL.Path]; ok {
		http.Redirect(w, r, next, http.StatusFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(libraryTestPage("Cookie Test")))
}

// cookiesAt returns the Cookie header values the path received, and whether the
// path was requested at all.
func (h *libraryHopRecorder) cookiesAt(path string) ([]string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	values, ok := h.seen[path]
	return values, ok
}

func libraryWriteCookieFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cookies.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("writing the cookie file: %v", err)
	}
	return path
}

func libraryCookieFetcher(t *testing.T, handler http.Handler, cookieFile string) *libraryFetcher {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return libraryTestFetcherWithCookies(t, 1<<20, libraryCookieNames,
		server.Listener.Addr().String(), &libraryFetchProbe{}, cookieFile)
}

func libraryAssertNoCookie(t *testing.T, rec *libraryHopRecorder, path string) {
	t.Helper()
	values, ok := rec.cookiesAt(path)
	if !ok {
		t.Fatalf("%s was never requested", path)
	}
	if len(values) != 0 {
		t.Errorf("%s carried a Cookie header %q, want none", path, values)
	}
}

func libraryAssertCookie(t *testing.T, rec *libraryHopRecorder, path, want string) {
	t.Helper()
	values, ok := rec.cookiesAt(path)
	if !ok {
		t.Fatalf("%s was never requested", path)
	}
	if len(values) != 1 || values[0] != want {
		t.Errorf("%s carried Cookie %q, want exactly %q", path, values, want)
	}
}

// --- the header decision, one test per branch ---------------------------------

func libraryCookieRequest(t *testing.T, rawURL string) *http.Request {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Request{URL: parsed, Header: http.Header{}}
}

func TestApplyCookieLeavesAForeignHostWithoutTheHeader(t *testing.T) {
	request := libraryCookieRequest(t, "http://other.test/post")
	libraryApplyCookie(request, map[string]string{"pages.test": "a=1"})
	if got := request.Header.Values("Cookie"); len(got) != 0 {
		t.Errorf("a foreign host got Cookie %q", got)
	}
}

func TestApplyCookieStripsTheHeaderAPreviousHopCarried(t *testing.T) {
	request := libraryCookieRequest(t, "http://other.test/post")
	request.Header.Set("Cookie", "a=1")
	libraryApplyCookie(request, map[string]string{"pages.test": "a=1"})
	if got := request.Header.Values("Cookie"); len(got) != 0 {
		t.Errorf("an inherited Cookie survived onto a foreign host: %q", got)
	}
}

func TestApplyCookieDoesNotMatchASubdomain(t *testing.T) {
	request := libraryCookieRequest(t, "https://www.pages.test/post")
	libraryApplyCookie(request, map[string]string{"pages.test": "a=1"})
	if got := request.Header.Values("Cookie"); len(got) != 0 {
		t.Errorf("a subdomain got Cookie %q", got)
	}
}

func TestApplyCookieWithNoCookiesStripsAndSetsNothing(t *testing.T) {
	request := libraryCookieRequest(t, "https://pages.test/post")
	request.Header.Set("Cookie", "stale=1")
	libraryApplyCookie(request, nil)
	if got := request.Header.Values("Cookie"); len(got) != 0 {
		t.Errorf("Cookie %q with no cookie file", got)
	}
}

func TestApplyCookieSetsTheHeaderOnAnExactMatchIgnoringCaseAndPort(t *testing.T) {
	for _, target := range []string{"https://pages.test/post", "https://PAGES.test:443/post"} {
		request := libraryCookieRequest(t, target)
		libraryApplyCookie(request, map[string]string{"pages.test": "a=1; b=2"})
		if got := request.Header.Values("Cookie"); len(got) != 1 || got[0] != "a=1; b=2" {
			t.Errorf("%s: Cookie %q, want a=1; b=2", target, got)
		}
	}
}

// --- the fetcher end to end: the negative cases first -------------------------

func TestAForeignHostReceivesNoCookie(t *testing.T) {
	rec := newLibraryHopRecorder(nil)
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
	fetcher := libraryCookieFetcher(t, rec, file)

	if _, err := fetcher.Fetch(context.Background(), "http://other.test/post"); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	libraryAssertNoCookie(t, rec, "/post")
}

func TestARedirectToAForeignHostDropsTheCookieAndTheReturnRestoresIt(t *testing.T) {
	rec := newLibraryHopRecorder(map[string]string{
		"/hop1": "http://other.test/hop2",
		"/hop2": "http://pages.test/hop3",
	})
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
	fetcher := libraryCookieFetcher(t, rec, file)

	if _, err := fetcher.Fetch(context.Background(), "http://pages.test/hop1"); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	libraryAssertCookie(t, rec, "/hop1", "a=1; b=2")
	libraryAssertNoCookie(t, rec, "/hop2")
	libraryAssertCookie(t, rec, "/hop3", "a=1; b=2")
}

// net/http itself would carry the header to a subdomain of the original host,
// which is the rule this bead declines to rely on.
func TestARedirectToASubdomainDropsTheCookie(t *testing.T) {
	rec := newLibraryHopRecorder(map[string]string{"/hop1": "http://www.pages.test/hop2"})
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
	fetcher := libraryCookieFetcher(t, rec, file)

	if _, err := fetcher.Fetch(context.Background(), "http://pages.test/hop1"); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	libraryAssertCookie(t, rec, "/hop1", "a=1; b=2")
	libraryAssertNoCookie(t, rec, "/hop2")
}

func TestARedirectIntoACookieHostSendsTheCookieOnThatHopOnly(t *testing.T) {
	rec := newLibraryHopRecorder(map[string]string{"/hop1": "http://pages.test/hop2"})
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
	fetcher := libraryCookieFetcher(t, rec, file)

	if _, err := fetcher.Fetch(context.Background(), "http://other.test/hop1"); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	libraryAssertNoCookie(t, rec, "/hop1")
	libraryAssertCookie(t, rec, "/hop2", "a=1; b=2")
}

func TestAFailedCookieReadNamesThePathAndHostButNoValue(t *testing.T) {
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
	rec := newLibraryHopRecorder(nil)
	fetcher := libraryCookieFetcher(t, rec, file)
	if _, err := fetcher.Fetch(context.Background(), "http://pages.test/ok"); err != nil {
		t.Fatalf("the first fetch, with the file in place: %v", err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}

	_, err := fetcher.Fetch(context.Background(), "http://pages.test/gone")
	if err == nil {
		t.Fatal("fetching with the cookie file deleted succeeded")
	}
	if !core.IsPermanent(err) {
		t.Errorf("the error is retryable: %v", err)
	}
	for _, want := range []string{file, "pages.test"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error %q does not name %q", err, want)
		}
	}
	libraryAssertNoCookieValue(t, err.Error())
	if _, ok := rec.cookiesAt("/gone"); ok {
		t.Error("a fetch whose cookie read failed still reached the server")
	}
}

func TestAMalformedOrLooseCookieFileFailsTheFetchWithoutItsContent(t *testing.T) {
	for name, content := range map[string]string{
		"bad json":       `{"pages.test": "a=1; b=2",}`,
		"non-string":     `{"pages.test": 12345, "x.test": "a=1; b=2"}`,
		"not an object":  `["a=1; b=2"]`,
		"truncated file": `{"pages.test": "a=1; b=2`,
	} {
		t.Run(name, func(t *testing.T) {
			fetcher := libraryCookieFetcher(t, newLibraryHopRecorder(nil), libraryWriteCookieFile(t, content))
			_, err := fetcher.Fetch(context.Background(), "http://pages.test/x")
			if err == nil {
				t.Fatal("the fetch succeeded")
			}
			libraryAssertNoCookieValue(t, err.Error())
			for _, leak := range []string{"12345", "x.test"} {
				if strings.Contains(err.Error(), leak) {
					t.Errorf("the error carries file content %q: %v", leak, err)
				}
			}
		})
	}

	t.Run("loose mode", func(t *testing.T) {
		file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
		if err := os.Chmod(file, 0o644); err != nil {
			t.Fatal(err)
		}
		rec := newLibraryHopRecorder(nil)
		_, err := libraryCookieFetcher(t, rec, file).Fetch(context.Background(), "http://pages.test/x")
		if err == nil {
			t.Fatal("a world-readable cookie file was used")
		}
		libraryAssertNoCookieValue(t, err.Error())
		if _, ok := rec.cookiesAt("/x"); ok {
			t.Error("the request went out with a cookie file that is too open")
		}
	})
}

func libraryAssertNoCookieValue(t *testing.T, text string) {
	t.Helper()
	for _, value := range []string{"a=1", "b=2"} {
		if strings.Contains(text, value) {
			t.Errorf("%q carries the cookie value %q", text, value)
		}
	}
}

func TestAFailedCookieReadStoresNoValueInExtractError(t *testing.T) {
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`)
	harness := newLibraryExtractHarness(t, libraryHarnessOptions{
		FetchHandler: newLibraryHopRecorder(nil),
		CookieFile:   file,
	})
	if err := os.WriteFile(file, []byte(`{"pages.test": "a=1; b=2",}`), 0o600); err != nil {
		t.Fatal(err)
	}
	id := harness.save("http://"+libraryFetchTestHost+"/post", nil)

	err := harness.run(id, 1, false, 1)
	if err == nil {
		t.Fatal("the extraction succeeded")
	}
	row := harness.item(id)
	if row.ExtractStatus != "failed" {
		t.Errorf("extract_status = %q, want failed", row.ExtractStatus)
	}
	stored := row.ExtractError.String
	for _, want := range []string{file, libraryFetchTestHost} {
		if !strings.Contains(stored, want) {
			t.Errorf("extract_error %q does not name %q", stored, want)
		}
	}
	libraryAssertNoCookieValue(t, stored)
	libraryAssertNoCookieValue(t, err.Error())
}

// --- the positive cases -------------------------------------------------------

func TestAMatchingHostReceivesTheCookieIgnoringCaseAndPort(t *testing.T) {
	for _, target := range []string{"http://pages.test/post", "http://PAGES.test:80/post"} {
		rec := newLibraryHopRecorder(nil)
		fetcher := libraryCookieFetcher(t, rec, libraryWriteCookieFile(t, `{"pages.test": "a=1; b=2"}`))
		if _, err := fetcher.Fetch(context.Background(), target); err != nil {
			t.Fatalf("Fetch %s: %v", target, err)
		}
		libraryAssertCookie(t, rec, "/post", "a=1; b=2")
	}
}

func TestWithTheSettingUnsetNoCookieIsSentAndNoFileIsOpened(t *testing.T) {
	t.Setenv("NORTE_COOKIE_FILE", filepath.Join(t.TempDir(), "does-not-exist.json"))
	rec := newLibraryHopRecorder(nil)
	fetcher := libraryCookieFetcher(t, rec, "")
	if _, err := fetcher.Fetch(context.Background(), "http://pages.test/post"); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	libraryAssertNoCookie(t, rec, "/post")
}

func TestEditingTheCookieFileChangesTheNextFetchWithoutARebuild(t *testing.T) {
	file := libraryWriteCookieFile(t, `{"pages.test": "a=1"}`)
	rec := newLibraryHopRecorder(nil)
	fetcher := libraryCookieFetcher(t, rec, file)

	if _, err := fetcher.Fetch(context.Background(), "http://pages.test/first"); err != nil {
		t.Fatalf("first Fetch: %v", err)
	}
	if err := os.WriteFile(file, []byte(`{"pages.test": "renewed=9"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fetcher.Fetch(context.Background(), "http://pages.test/second"); err != nil {
		t.Fatalf("second Fetch: %v", err)
	}
	libraryAssertCookie(t, rec, "/first", "a=1")
	libraryAssertCookie(t, rec, "/second", "renewed=9")
}
