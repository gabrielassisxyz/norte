package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// Server timeouts. A read header timeout bounds a connection that opens and
// says nothing; the idle timeout bounds keep-alive connections.
const (
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 60 * time.Second
	idleTimeout       = 120 * time.Second
	// shutdownDrainTimeout is how long in-flight requests get to finish after
	// SIGTERM before the process stops waiting for them.
	shutdownDrainTimeout = 15 * time.Second
)

// RouterOptions is everything the HTTP surface needs. Assets is injected rather
// than read from webassets directly so a test can mount a frontend of its own.
type RouterOptions struct {
	Config *Config
	Logger *slog.Logger
	Assets fs.FS
	// Modules are the enabled feature modules in the configured order. Their
	// routes land under /api/<name>/; the stub mounts none.
	Modules []Module
	// ModuleDeps is what each module's Register receives.
	ModuleDeps Deps
	// TestRoutes registers the slow route the shutdown test needs. It is off
	// unless NORTE_TEST_ROUTES=1, and `serve` warns when it is on.
	TestRoutes bool
}

// NewRouter assembles the mux and the middleware chain. It fails rather than
// serving when a module's contract cannot be mounted, because a server missing
// a route answers 404 to a frontend that was compiled against it.
func NewRouter(opts RouterOptions) (http.Handler, error) {
	mux := http.NewServeMux()
	// The API routes live on a mux of their own so that a request no route
	// matched stays distinguishable from one whose method is wrong:
	// http.ServeMux answers 405 only when no pattern at all matches, and the
	// /api/ fallback below matches every one of them.
	apiMux := http.NewServeMux()
	if err := mountCoreAPI(apiMux, opts); err != nil {
		return nil, err
	}
	for _, module := range opts.Modules {
		module.Register(NewNorteModuleRouter(apiMux, module.Name()), opts.ModuleDeps)
	}
	if opts.TestRoutes {
		registerNorteTestOnlyRoutes(apiMux)
	}
	mux.Handle("/api/", newNorteAPIHandler(apiMux))
	mux.Handle("/", newFrontendHandler(opts.Assets))
	return withStandardMiddleware(opts, mux), nil
}

// withStandardMiddleware wraps a handler in the chain every request goes
// through. The order is deliberate: the request id and the access log see every
// request, the security headers are set even on the responses the allowlist and
// the body cap reject, the media type is folded before any contract validator
// reads it, and the body cap is innermost so only handlers run under it.
func withStandardMiddleware(opts RouterOptions, handler http.Handler) http.Handler {
	handler = core.WithBodyLimit(opts.Config.BodyMaxBytes, handler)
	handler = core.WithCanonicalMediaType(handler)
	handler = core.WithHostAllowlist(opts.Config.AllowedHosts(), handler)
	handler = core.WithSecurityHeaders(handler)
	handler = core.WithPanicRecovery(opts.Logger, handler)
	handler = core.WithAccessLog(opts.Logger, handler)
	handler = core.WithRequestID(handler)
	return handler
}

// newNorteAPIHandler serves everything under /api/, and answers a request no
// route matched in the error envelope -- never in the frontend's HTML, and
// never in the plain text net/http would have written.
func newNorteAPIHandler(apiMux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := apiMux.Handler(r); pattern != "" {
			// Served through the mux rather than through the handler it just
			// returned: only ServeHTTP binds a pattern's wildcards, so a
			// handler reached any other way reads every path value as empty.
			apiMux.ServeHTTP(w, r)
			return
		}
		writeNorteAPIRoutingError(w, r, apiMux)
	})
}

// writeNorteAPIRoutingError answers an /api/ request that matched no route. It
// asks the mux what it would have said rather than consulting a route table of
// Norte's own: the mux already tells a wrong method apart from an unknown path
// and already knows which methods that path does answer, and the table would
// be a second copy of the generated routes, free to drift from them.
func writeNorteAPIRoutingError(w http.ResponseWriter, r *http.Request, apiMux *http.ServeMux) {
	verdict := &norteDiscardedResponse{header: http.Header{}, status: http.StatusOK}
	apiMux.ServeHTTP(verdict, r)
	if verdict.status != http.StatusMethodNotAllowed {
		core.WriteJSONError(w, r, http.StatusNotFound, "not_found", "no such endpoint")
		return
	}
	// RFC 9110 section 15.5.6 makes Allow mandatory on a 405, and it is the
	// only way a client learns what the path does accept.
	if allow := verdict.header.Get("Allow"); allow != "" {
		w.Header().Set("Allow", allow)
	}
	core.WriteJSONError(w, r, http.StatusMethodNotAllowed, "method_not_allowed",
		"this endpoint does not answer "+r.Method)
}

// norteDiscardedResponse records the status and the headers of an answer that
// is never sent, which is how the mux's verdict on an unmatched request is
// read without that answer reaching the client.
type norteDiscardedResponse struct {
	header http.Header
	status int
	wrote  bool
}

func (d *norteDiscardedResponse) Header() http.Header { return d.header }

func (d *norteDiscardedResponse) WriteHeader(status int) {
	if !d.wrote {
		d.status = status
		d.wrote = true
	}
}

func (d *norteDiscardedResponse) Write(b []byte) (int, error) {
	d.wrote = true
	return len(b), nil
}

// newFrontendHandler serves the embedded frontend, falling back to index.html
// for any path that is not a file, because Vue Router uses HTML5 history and a
// deep link such as /library exists only in the browser.
func newFrontendHandler(assets fs.FS) http.Handler {
	files := http.FileServerFS(assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if assetFileExists(assets, r.URL.Path) {
			files.ServeHTTP(w, r)
			return
		}
		serveFrontendIndex(w, r, assets)
	})
}

func assetFileExists(assets fs.FS, urlPath string) bool {
	name := strings.TrimPrefix(path.Clean("/"+urlPath), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	if !fs.ValidPath(name) {
		return false
	}
	info, err := fs.Stat(assets, name)
	return err == nil && !info.IsDir()
}

func serveFrontendIndex(w http.ResponseWriter, r *http.Request, assets fs.FS) {
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		core.WriteJSONError(w, r, http.StatusNotFound, "frontend_not_built",
			"this binary carries no frontend: run bin/generate and build again")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(index)
}

// registerNorteTestOnlyRoutes adds a route that stays in flight for a given
// number of milliseconds. The graceful-shutdown criterion needs a request the
// server is still answering when SIGTERM arrives, and after Shutdown starts no
// new connection is accepted, so the request cannot be released from outside.
func registerNorteTestOnlyRoutes(mux *http.ServeMux) {
	const maxHold = 10 * time.Second
	mux.HandleFunc("GET /api/test/hold", func(w http.ResponseWriter, r *http.Request) {
		hold := time.Second
		if raw := r.URL.Query().Get("ms"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 0 {
				core.WriteJSONFieldError(w, r, http.StatusBadRequest, "invalid_query",
					"ms must be a non-negative integer", "ms")
				return
			}
			hold = time.Duration(parsed) * time.Millisecond
		}
		if hold > maxHold {
			hold = maxHold
		}
		time.Sleep(hold)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"held": true})
	})
}

// Serve listens, serves, and on a cancelled context drains in-flight requests
// before returning. The address actually bound is logged, which is both useful
// with a port of 0 and how the subprocess test finds the server.
func Serve(ctx context.Context, opts RouterOptions) error {
	handler, err := NewRouter(opts)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", opts.Config.Listen)
	if err != nil {
		return fmt.Errorf("listening on %s: %w", opts.Config.Listen, err)
	}

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Serve(listener)
	}()
	opts.Logger.Info("listening", slog.String("addr", listener.Addr().String()))

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	opts.Logger.Info("shutting down", slog.String("drain", shutdownDrainTimeout.String()))
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownDrainTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("draining in-flight requests: %w", err)
	}
	opts.Logger.Info("stopped")
	return nil
}
