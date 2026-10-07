package library

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// The fetcher's bounds. A page that needs more than any of these is a page
// Norte declines to read rather than one it waits for.
const (
	// libraryFetchMaxRedirects is how many hops a chain may take. Each one is
	// re-validated, so the limit is about a redirect loop rather than safety.
	libraryFetchMaxRedirects = 5
	// libraryFetchConnectTimeout bounds opening the connection alone, so a
	// host that accepts nothing fails in seconds instead of in a minute.
	libraryFetchConnectTimeout = 10 * time.Second
	// libraryFetchTotalTimeout bounds the whole request, redirects included.
	libraryFetchTotalTimeout = 60 * time.Second
	// libraryFetchMaxHeaderBytes caps the response headers. A server that
	// streams headers forever would otherwise never reach the body cap.
	libraryFetchMaxHeaderBytes = 64 << 10
	// libraryFetchUserAgent identifies Norte to the sites it reads.
	libraryFetchUserAgent = "Norte/0.1 (+personal reading app)"
)

// libraryFetchAcceptedMediaTypes are the content types a page may come back as.
// Anything else -- a PDF, an image, an octet stream -- is refused permanently
// rather than handed to an HTML parser that would find nothing in it.
var libraryFetchAcceptedMediaTypes = map[string]bool{
	"text/html":             true,
	"application/xhtml+xml": true,
}

// errLibraryTooManyRedirects ends a chain that will not settle. It is a
// sentinel because the client wraps every CheckRedirect failure in a
// *url.Error, and the classifier has to recognise this one through that wrapper
// rather than by reading its message.
var errLibraryTooManyRedirects = errors.New("the redirect chain is too long")

// libraryRefusedAddressError reports an address the fetcher will not dial. It
// is its own type so the dialer, the redirect policy and the pre-flight check
// all produce the one failure a caller recognises, and so the message never
// carries anything but the address and the reason.
type libraryRefusedAddressError struct {
	address string
	reason  string
}

func (e *libraryRefusedAddressError) Error() string {
	return fmt.Sprintf("refusing to fetch %s: %s", e.address, e.reason)
}

// libraryFetchResult is what a successful fetch produced: the bytes, the
// content type the server declared, and the URL the chain actually ended at.
type libraryFetchResult struct {
	HTML      []byte
	MediaType string
	FinalURL  string
}

// libraryHostResolver turns a hostname into addresses. It is injected so a test
// can map a public test hostname at a listener on the loopback interface, which
// the fetcher otherwise refuses on purpose.
type libraryHostResolver func(ctx context.Context, host string) ([]netip.Addr, error)

// libraryDialer opens a connection to an address that has already been
// validated. It is injected for the same reason the resolver is.
type libraryDialer func(ctx context.Context, network, address string) (net.Conn, error)

// LibraryFetchOptions is everything the fetcher needs that is not a constant.
type LibraryFetchOptions struct {
	// MaxBytes is NORTE_FETCH_MAX_BYTES. Zero takes the configured default
	// from Deps, which is what production always passes.
	MaxBytes int64
	// Resolver and Dialer default to the real ones.
	Resolver libraryHostResolver
	Dialer   libraryDialer
	// ResolverCalls, when not nil, is incremented once per lookup. A test
	// reads it to prove the hostname is resolved exactly once per connection.
	ResolverCalls func(host string)
	// DialedAddresses, when not nil, receives the address the base dialer was
	// handed, which is how a test proves the dial went to the validated IP and
	// never to the hostname.
	DialedAddresses func(address string)
}

// libraryFetcher downloads a page over a client that will not reach into the
// person's own network.
//
// The hostname is resolved exactly once, by this type, and the connection is
// dialed to the address that lookup returned -- never to the hostname. A
// transport left to resolve the name itself would look it up a second time,
// after the check, and a DNS answer that changed in between is the whole attack.
type libraryFetcher struct {
	client   *http.Client
	maxBytes int64
}

// newLibraryFetcher assembles the client. Keep-alives are off because the
// fetcher makes one request per page and a pooled connection would outlive the
// validation that admitted it.
func newLibraryFetcher(opts LibraryFetchOptions) *libraryFetcher {
	resolver := opts.Resolver
	if resolver == nil {
		resolver = func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}
	}
	dialer := opts.Dialer
	if dialer == nil {
		base := &net.Dialer{Timeout: libraryFetchConnectTimeout}
		dialer = base.DialContext
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			return libraryDialValidated(ctx, network, address, resolver, dialer, opts)
		},
		MaxResponseHeaderBytes: libraryFetchMaxHeaderBytes,
		DisableKeepAlives:      true,
	}
	return &libraryFetcher{
		client: &http.Client{
			Transport: transport,
			Timeout:   libraryFetchTotalTimeout,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= libraryFetchMaxRedirects {
					return fmt.Errorf("%w: it passed %d hops", errLibraryTooManyRedirects, libraryFetchMaxRedirects)
				}
				return libraryValidateFetchURL(request.URL)
			},
		},
		maxBytes: opts.MaxBytes,
	}
}

// libraryDialValidated is the custom DialContext: one lookup, every address it
// returned checked, and the dial aimed at the first of them.
//
// Every address of the answer has to be public, not merely the one that gets
// dialed. A host that resolves to a public and a private address would
// otherwise be reachable by whichever one the resolver happened to put first.
func libraryDialValidated(
	ctx context.Context,
	network, address string,
	resolver libraryHostResolver,
	dialer libraryDialer,
	opts LibraryFetchOptions,
) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("reading the address to dial: %w", err)
	}
	resolved, err := libraryResolveOnce(ctx, host, resolver, opts)
	if err != nil {
		return nil, err
	}
	if len(resolved) == 0 {
		return nil, &libraryRefusedAddressError{address: host, reason: "the hostname resolved to no address"}
	}
	for _, addr := range resolved {
		if err := libraryCheckAddress(addr); err != nil {
			return nil, err
		}
	}
	dialTarget := net.JoinHostPort(resolved[0].String(), port)
	if opts.DialedAddresses != nil {
		opts.DialedAddresses(dialTarget)
	}
	return dialer(ctx, network, dialTarget)
}

// libraryResolveOnce returns the addresses of host, calling the resolver at most
// once. A host that is already a literal address is not a lookup at all, which
// is why the counter does not move for one.
func libraryResolveOnce(
	ctx context.Context,
	host string,
	resolver libraryHostResolver,
	opts LibraryFetchOptions,
) ([]netip.Addr, error) {
	if literal, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		return []netip.Addr{literal}, nil
	}
	if opts.ResolverCalls != nil {
		opts.ResolverCalls(host)
	}
	resolved, err := resolver(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolving %s: %w", host, err)
	}
	return resolved, nil
}

// libraryCheckAddress refuses everything that is not a public address.
//
// An IPv4 address carried as an IPv4-mapped IPv6 one is unwrapped first: the
// predicates below answer about the form they are given, and ::ffff:127.0.0.1
// is loopback in every sense that matters while being neither IsLoopback nor
// IsPrivate as a v6 value.
func libraryCheckAddress(addr netip.Addr) error {
	addr = addr.Unmap()
	switch {
	case !addr.IsValid():
		return &libraryRefusedAddressError{address: addr.String(), reason: "not a usable address"}
	case addr.IsUnspecified():
		return &libraryRefusedAddressError{address: addr.String(), reason: "the unspecified address"}
	case addr.IsLoopback():
		return &libraryRefusedAddressError{address: addr.String(), reason: "a loopback address"}
	case addr.IsPrivate():
		return &libraryRefusedAddressError{address: addr.String(), reason: "a private address"}
	case addr.IsLinkLocalUnicast(), addr.IsLinkLocalMulticast():
		return &libraryRefusedAddressError{address: addr.String(), reason: "a link-local address"}
	case addr.IsInterfaceLocalMulticast(), addr.IsMulticast():
		return &libraryRefusedAddressError{address: addr.String(), reason: "a multicast address"}
	}
	return nil
}

// libraryValidateFetchURL is the check that runs before the first request and
// again on every redirect: the scheme, and a host written as a literal address.
// A hostname is checked by the dialer, which is the only place the address it
// will actually be connected to is known.
func libraryValidateFetchURL(target *url.URL) error {
	if target == nil {
		return &libraryRefusedAddressError{address: "", reason: "no address to fetch"}
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return &libraryRefusedAddressError{
			address: target.Redacted(),
			reason:  fmt.Sprintf("the scheme %q is not http or https", target.Scheme),
		}
	}
	if target.Hostname() == "" {
		return &libraryRefusedAddressError{address: target.Redacted(), reason: "the address carries no host"}
	}
	if literal, err := netip.ParseAddr(target.Hostname()); err == nil {
		return libraryCheckAddress(literal)
	}
	return nil
}

// Fetch downloads pageURL and reports the HTML. Every refusal -- a private
// address, a body over the cap, a content type that is not HTML -- comes back
// permanent, because retrying it would reach the same answer three times.
func (f *libraryFetcher) Fetch(ctx context.Context, pageURL string) (libraryFetchResult, error) {
	parsed, err := url.Parse(pageURL)
	if err != nil {
		return libraryFetchResult{}, core.Permanent(fmt.Errorf("reading the page address: %w", err))
	}
	if err := libraryValidateFetchURL(parsed); err != nil {
		return libraryFetchResult{}, core.Permanent(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return libraryFetchResult{}, core.Permanent(fmt.Errorf("preparing the fetch: %w", err))
	}
	request.Header.Set("User-Agent", libraryFetchUserAgent)
	request.Header.Set("Accept", "text/html,application/xhtml+xml")

	response, err := f.client.Do(request)
	if err != nil {
		// A CheckRedirect refusal comes back with the response as well as the
		// error, and that body still has to be closed.
		if response != nil {
			_ = response.Body.Close()
		}
		return libraryFetchResult{}, libraryClassifyFetchError(err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<10))
		_ = response.Body.Close()
	}()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		fetchErr := fmt.Errorf("fetching %s answered %d", parsed.Redacted(), response.StatusCode)
		// A 4xx is the site's settled answer; a 5xx may well be a bad minute,
		// so that one is left for the worker's retries.
		if response.StatusCode >= 400 && response.StatusCode < 500 {
			return libraryFetchResult{}, core.Permanent(fetchErr)
		}
		return libraryFetchResult{}, fetchErr
	}

	mediaType, err := libraryResponseMediaType(response)
	if err != nil {
		return libraryFetchResult{}, core.Permanent(err)
	}

	// One byte past the cap: reading it is how a body exactly at the cap is
	// told from one that is over it.
	body, err := io.ReadAll(io.LimitReader(response.Body, f.maxBytes+1))
	if err != nil {
		return libraryFetchResult{}, fmt.Errorf("reading the page at %s: %w", parsed.Redacted(), err)
	}
	if int64(len(body)) > f.maxBytes {
		return libraryFetchResult{}, core.Permanent(fmt.Errorf(
			"the page at %s is larger than the %d byte limit", parsed.Redacted(), f.maxBytes))
	}

	final := parsed.String()
	if response.Request != nil && response.Request.URL != nil {
		final = response.Request.URL.String()
	}
	return libraryFetchResult{HTML: body, MediaType: mediaType, FinalURL: final}, nil
}

// libraryResponseMediaType reads the declared type. A response with no
// Content-Type at all is refused rather than guessed at: a server that does not
// say what it sent is not a server to sniff HTML out of.
func libraryResponseMediaType(response *http.Response) (string, error) {
	raw := response.Header.Get("Content-Type")
	if raw == "" {
		return "", fmt.Errorf("the response declared no content type")
	}
	mediaType, _, err := mime.ParseMediaType(raw)
	if err != nil {
		return "", fmt.Errorf("reading the content type %q: %w", raw, err)
	}
	mediaType = strings.ToLower(mediaType)
	if !libraryFetchAcceptedMediaTypes[mediaType] {
		return "", fmt.Errorf("the page is %s, not HTML", mediaType)
	}
	return mediaType, nil
}

// libraryClassifyFetchError keeps a refused address permanent through the
// *url.Error the client wraps every transport failure in. A timeout or a reset
// connection stays retryable.
func libraryClassifyFetchError(err error) error {
	var refused *libraryRefusedAddressError
	if errors.As(err, &refused) {
		return core.Permanent(err)
	}
	if errors.Is(err, errLibraryTooManyRedirects) {
		return core.Permanent(err)
	}
	return fmt.Errorf("fetching the page: %w", err)
}
