package library

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// libraryFetchTestHost is the hostname the fetch tests use, and
// libraryFetchTestIP is the public address a test resolver maps it to.
//
// httptest listens on 127.0.0.1, which the fetcher refuses on purpose, so a
// fetch test cannot simply point at the listener's URL. The resolver answers
// with a public address and the dialer sends the connection to the listener,
// which exercises the real validation against a real server.
const (
	libraryFetchTestHost = "pages.test"
	libraryFetchTestIP   = "198.51.100.7"
)

// libraryFetchProbe records what the resolver and the dialer were asked for, so
// a test can assert on how the connection was made rather than only on its
// result.
type libraryFetchProbe struct {
	mu       sync.Mutex
	lookups  []string
	dialedTo []string
}

func (p *libraryFetchProbe) lookedUp(host string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.lookups = append(p.lookups, host)
}

func (p *libraryFetchProbe) dialed(address string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.dialedTo = append(p.dialedTo, address)
}

func (p *libraryFetchProbe) snapshot() (lookups, dialed []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string{}, p.lookups...), append([]string{}, p.dialedTo...)
}

// libraryTestFetcher builds a fetcher whose resolver answers from names and
// whose dialer sends every connection to listenerAddr, whatever address it was
// handed. A name missing from names fails to resolve.
func libraryTestFetcher(
	t *testing.T,
	maxBytes int64,
	names map[string][]string,
	listenerAddr string,
	probe *libraryFetchProbe,
) *libraryFetcher {
	t.Helper()
	return newLibraryFetcher(LibraryFetchOptions{
		MaxBytes: maxBytes,
		Resolver: func(_ context.Context, host string) ([]netip.Addr, error) {
			raw, ok := names[host]
			if !ok {
				return nil, fmt.Errorf("no test mapping for %s", host)
			}
			addrs := make([]netip.Addr, 0, len(raw))
			for _, one := range raw {
				parsed, err := netip.ParseAddr(one)
				if err != nil {
					t.Fatalf("the test mapping %q does not parse: %v", one, err)
				}
				addrs = append(addrs, parsed)
			}
			return addrs, nil
		},
		Dialer: func(ctx context.Context, network, _ string) (net.Conn, error) {
			dialer := &net.Dialer{}
			return dialer.DialContext(ctx, network, listenerAddr)
		},
		ResolverCalls:   probe.lookedUp,
		DialedAddresses: probe.dialed,
	})
}

func libraryTestPage(title string) string {
	return `<!doctype html><html><head><title>` + title + `</title>` +
		`<meta property="og:site_name" content="Pages Test"></head><body><article><h1>` + title + `</h1><p>` +
		strings.Repeat("Enough prose for the extractor to accept the page. ", 20) +
		`</p></article></body></html>`
}

// TestAFetchResolvesOnceAndDialsTheValidatedAddress is the SSRF design, stated
// as the two things a test can see: the lookup happens exactly once per
// connection, and the address handed to the dialer is the one that lookup
// returned rather than the hostname.
//
// The second half is what makes the first half worth anything. A transport left
// to resolve the name itself would look it up again after the check, and a DNS
// answer that changed in between is the whole attack.
func TestAFetchResolvesOnceAndDialsTheValidatedAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(libraryTestPage("Resolved Once")))
	}))
	defer server.Close()

	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20,
		map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
		server.Listener.Addr().String(), probe)

	result, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/article")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if !strings.Contains(string(result.HTML), "Resolved Once") {
		t.Errorf("the fetched page is not the one the server sent:\n%s", result.HTML)
	}

	lookups, dialed := probe.snapshot()
	if len(lookups) != 1 {
		t.Errorf("the resolver was called %d times, want exactly 1: %v", len(lookups), lookups)
	}
	if len(lookups) > 0 && lookups[0] != libraryFetchTestHost {
		t.Errorf("the resolver was asked for %q, want %q", lookups[0], libraryFetchTestHost)
	}
	if len(dialed) != 1 {
		t.Fatalf("the dialer was called %d times, want exactly 1: %v", len(dialed), dialed)
	}
	if want := net.JoinHostPort(libraryFetchTestIP, "80"); dialed[0] != want {
		t.Errorf("the dialer was handed %q, want the validated address %q", dialed[0], want)
	}
	if strings.Contains(dialed[0], libraryFetchTestHost) {
		t.Errorf("the dialer was handed the hostname %q, which is a second lookup waiting to happen", dialed[0])
	}
}

// TestASingleLookupReturningAPrivateAddressIsRefusedBeforeAnyDial is the other
// half of the same criterion: the check runs between the lookup and the dial,
// so the base dialer is never reached.
func TestASingleLookupReturningAPrivateAddressIsRefusedBeforeAnyDial(t *testing.T) {
	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20,
		map[string][]string{"internal.test": {"10.0.0.5"}},
		"127.0.0.1:1", probe)

	_, err := fetcher.Fetch(context.Background(), "http://internal.test/secrets")
	if err == nil {
		t.Fatal("fetching a name that resolves to a private address succeeded")
	}
	if !core.IsPermanent(err) {
		t.Errorf("the error is retryable; a refused address will be refused again: %v", err)
	}
	var refused *libraryRefusedAddressError
	if !errors.As(err, &refused) {
		t.Errorf("error = %v, want a refused address", err)
	}
	lookups, dialed := probe.snapshot()
	if len(lookups) != 1 {
		t.Errorf("the resolver was called %d times, want exactly 1: %v", len(lookups), lookups)
	}
	if len(dialed) != 0 {
		t.Errorf("the dialer was reached with %v; a refused address must not be dialed at all", dialed)
	}
}

// TestAMixedAnswerIsRefusedEvenThoughOneAddressIsPublic covers the case a
// check on only the address about to be dialed would let through: a host that
// answers with a public address and a private one.
func TestAMixedAnswerIsRefusedEvenThoughOneAddressIsPublic(t *testing.T) {
	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20,
		map[string][]string{"mixed.test": {libraryFetchTestIP, "192.168.1.9"}},
		"127.0.0.1:1", probe)

	_, err := fetcher.Fetch(context.Background(), "http://mixed.test/article")
	var refused *libraryRefusedAddressError
	if !errors.As(err, &refused) {
		t.Fatalf("error = %v, want a refused address", err)
	}
	if _, dialed := probe.snapshot(); len(dialed) != 0 {
		t.Errorf("the dialer was reached with %v", dialed)
	}
}

func TestALoopbackLiteralIsRefusedBeforeTheFirstRequest(t *testing.T) {
	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20, map[string][]string{}, "127.0.0.1:1", probe)

	for _, target := range []string{
		"http://127.0.0.1/",
		"http://[::1]/",
		"http://0.0.0.0/",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::ffff:127.0.0.1]/",
		"http://10.0.0.5/",
	} {
		_, err := fetcher.Fetch(context.Background(), target)
		var refused *libraryRefusedAddressError
		if !errors.As(err, &refused) {
			t.Errorf("fetching %s gave %v, want a refused address", target, err)
		}
		if !core.IsPermanent(err) {
			t.Errorf("fetching %s gave a retryable error: %v", target, err)
		}
	}
	if lookups, dialed := probe.snapshot(); len(lookups) != 0 || len(dialed) != 0 {
		t.Errorf("a literal address was looked up (%v) or dialed (%v) before being refused", lookups, dialed)
	}
}

func TestANonHTTPSchemeIsRefused(t *testing.T) {
	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20, map[string][]string{}, "127.0.0.1:1", probe)
	for _, target := range []string{"file:///etc/passwd", "gopher://pages.test/1", "ftp://pages.test/x"} {
		_, err := fetcher.Fetch(context.Background(), target)
		var refused *libraryRefusedAddressError
		if !errors.As(err, &refused) {
			t.Errorf("fetching %s gave %v, want a refused address", target, err)
		}
	}
}

// TestARedirectChainEndingAtAPrivateAddressIsRefused is the "after every
// redirect" half of the validation. The chain starts at a public name and ends
// at a private literal, which is the shape a server uses to send a fetcher
// somewhere it would never have gone directly.
func TestARedirectChainEndingAtAPrivateAddressIsRefused(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/start":
			http.Redirect(w, r, "http://"+libraryFetchTestHost+"/second", http.StatusFound)
		case "/second":
			http.Redirect(w, r, "http://10.0.0.5/metadata", http.StatusFound)
		default:
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(libraryTestPage("Should Not Be Reached")))
		}
	}))
	defer server.Close()
	_ = server

	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20,
		map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
		server.Listener.Addr().String(), probe)

	_, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/start")
	var refused *libraryRefusedAddressError
	if !errors.As(err, &refused) {
		t.Fatalf("error = %v, want the redirect target refused", err)
	}
	if !core.IsPermanent(err) {
		t.Errorf("the error is retryable: %v", err)
	}
}

func TestATooLongRedirectChainIsRefused(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://"+libraryFetchTestHost+r.URL.Path+"x", http.StatusFound)
	}))
	defer server.Close()

	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20,
		map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
		server.Listener.Addr().String(), probe)

	_, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/loop")
	if !errors.Is(err, errLibraryTooManyRedirects) {
		t.Fatalf("error = %v, want the redirect limit", err)
	}
	if !core.IsPermanent(err) {
		t.Errorf("the error is retryable: %v", err)
	}
}

// TestTheRedirectLimitIsFiveHopsInclusive pins the off-by-one: five redirects
// are followed and the sixth is the one refused.
func TestTheRedirectLimitIsFiveHopsInclusive(t *testing.T) {
	for _, tc := range []struct {
		hops    int
		refused bool
	}{{5, false}, {6, true}} {
		t.Run(fmt.Sprintf("%d redirects", tc.hops), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var at int
				if _, err := fmt.Sscanf(r.URL.Path, "/hop%d", &at); err == nil && at < tc.hops {
					http.Redirect(w, r, fmt.Sprintf("/hop%d", at+1), http.StatusFound)
					return
				}
				w.Header().Set("Content-Type", "text/html")
				_, _ = w.Write([]byte(libraryTestPage("Arrived")))
			}))
			defer server.Close()

			fetcher := libraryTestFetcher(t, 1<<20,
				map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
				server.Listener.Addr().String(), &libraryFetchProbe{})
			_, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/hop0")
			if tc.refused && !errors.Is(err, errLibraryTooManyRedirects) {
				t.Fatalf("error = %v, want the redirect limit", err)
			}
			if !tc.refused && err != nil {
				t.Fatalf("a chain of %d redirects was refused: %v", tc.hops, err)
			}
		})
	}
}

// TestABodyOverTheCapIsRefusedWhileStreaming generates the oversized body in
// the test rather than committing one: thirty megabytes of fixture would be in
// every clone of the repository forever to prove one comparison.
func TestABodyOverTheCapIsRefusedWhileStreaming(t *testing.T) {
	const chunk = 1 << 20
	const total = 30 * chunk
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		filler := strings.Repeat("a", chunk)
		for written := 0; written < total; written += chunk {
			if _, err := w.Write([]byte(filler)); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	probe := &libraryFetchProbe{}
	// The default NORTE_FETCH_MAX_BYTES, which is what the criterion names.
	fetcher := libraryTestFetcher(t, 20*1024*1024,
		map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
		server.Listener.Addr().String(), probe)

	_, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/huge")
	if err == nil {
		t.Fatal("a 30 MB body was accepted under a 20 MB cap")
	}
	if !core.IsPermanent(err) {
		t.Errorf("the error is retryable; the page will be the same size next time: %v", err)
	}
	if !strings.Contains(err.Error(), "larger than") {
		t.Errorf("error = %v, want it to name the limit", err)
	}
}

func TestABodyExactlyAtTheCapIsAccepted(t *testing.T) {
	page := libraryTestPage("At The Cap")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(page))
	}))
	defer server.Close()

	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, int64(len(page)),
		map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
		server.Listener.Addr().String(), probe)

	result, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/exact")
	if err != nil {
		t.Fatalf("a body exactly at the cap was refused: %v", err)
	}
	if len(result.HTML) != len(page) {
		t.Errorf("fetched %d bytes, want the page's %d", len(result.HTML), len(page))
	}
}

func TestANonHTMLContentTypeIsRefused(t *testing.T) {
	for _, mediaType := range []string{"application/pdf", "image/png", "application/octet-stream", "text/plain"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", mediaType)
			_, _ = w.Write([]byte("not a page"))
		}))
		probe := &libraryFetchProbe{}
		fetcher := libraryTestFetcher(t, 1<<20,
			map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
			server.Listener.Addr().String(), probe)
		_, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/file")
		server.Close()
		if err == nil {
			t.Errorf("a %s response was accepted as a page", mediaType)
			continue
		}
		if !core.IsPermanent(err) {
			t.Errorf("a %s response gave a retryable error: %v", mediaType, err)
		}
	}
}

// TestAServerErrorStaysRetryableAndAClientErrorDoesNot is the one distinction
// the status code decides: a 503 is often a bad minute and a 404 is the site's
// settled answer.
func TestAServerErrorStaysRetryableAndAClientErrorDoesNot(t *testing.T) {
	for _, tc := range []struct {
		status    int
		permanent bool
	}{
		{http.StatusNotFound, true},
		{http.StatusForbidden, true},
		{http.StatusServiceUnavailable, false},
		{http.StatusBadGateway, false},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
		}))
		probe := &libraryFetchProbe{}
		fetcher := libraryTestFetcher(t, 1<<20,
			map[string][]string{libraryFetchTestHost: {libraryFetchTestIP}},
			server.Listener.Addr().String(), probe)
		_, err := fetcher.Fetch(context.Background(), "http://"+libraryFetchTestHost+"/status")
		server.Close()
		if err == nil {
			t.Errorf("a %d response was accepted", tc.status)
			continue
		}
		if core.IsPermanent(err) != tc.permanent {
			t.Errorf("a %d response: permanent = %v, want %v (%v)",
				tc.status, core.IsPermanent(err), tc.permanent, err)
		}
	}
}

// TestAStoredErrorCarriesNoQueryString is the redaction the stored
// extract_error depends on: a page saved with a signed address must not leave
// that address in a column.
func TestAStoredErrorCarriesNoQueryString(t *testing.T) {
	probe := &libraryFetchProbe{}
	fetcher := libraryTestFetcher(t, 1<<20,
		map[string][]string{"internal.test": {"10.0.0.5"}}, "127.0.0.1:1", probe)

	_, err := fetcher.Fetch(context.Background(),
		"http://internal.test/doc?token=super-secret-value&sig=abc123")
	if err == nil {
		t.Fatal("the fetch succeeded")
	}
	redacted := core.RedactError(err)
	for _, secret := range []string{"super-secret-value", "abc123", "token=", "sig="} {
		if strings.Contains(redacted, secret) {
			t.Errorf("the redacted error still carries %q: %s", secret, redacted)
		}
	}
}

func TestAddressValidationCoversEveryRefusedRange(t *testing.T) {
	for _, refused := range []string{
		"0.0.0.0", "127.0.0.1", "127.1.2.3", "10.1.2.3", "172.16.0.1", "192.168.0.1",
		"169.254.169.254", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
		"224.0.0.1", "ff02::1", "::ffff:10.0.0.1",
		"100.64.0.1", "100.127.255.254", "0.1.2.3", "192.0.0.8", "198.18.0.1", "198.19.255.1",
		"240.0.0.1", "255.255.255.255", "64:ff9b::808:808", "2002:808:808::1",
		"239.255.255.250", "ff0e::1",
	} {
		addr, err := netip.ParseAddr(refused)
		if err != nil {
			t.Fatalf("the test address %q does not parse: %v", refused, err)
		}
		if err := libraryCheckAddress(addr); err == nil {
			t.Errorf("libraryCheckAddress(%s) accepted it", refused)
		}
	}
	for _, allowed := range []string{
		"198.51.100.7", "93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946",
	} {
		addr, err := netip.ParseAddr(allowed)
		if err != nil {
			t.Fatalf("the test address %q does not parse: %v", allowed, err)
		}
		if err := libraryCheckAddress(addr); err != nil {
			t.Errorf("libraryCheckAddress(%s) refused it: %v", allowed, err)
		}
	}
}
