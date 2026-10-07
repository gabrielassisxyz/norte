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
	// TestRoutes registers the slow route the shutdown test needs. It is off
	// unless NORTE_TEST_ROUTES=1, and `serve` warns when it is on.
	TestRoutes bool
}

// NewRouter assembles the mux and the middleware chain. It fails rather than
// serving when a module's contract cannot be mounted, because a server missing
// a route answers 404 to a frontend that was compiled against it.
func NewRouter(opts RouterOptions) (http.Handler, error) {
	mux := http.NewServeMux()
	if err := mountCoreAPI(mux); err != nil {
		return nil, err
	}
	mux.Handle("/api/", http.HandlerFunc(handleAPINotFound))
	mux.Handle("/", newFrontendHandler(opts.Assets))
	if opts.TestRoutes {
		registerNorteTestOnlyRoutes(mux)
	}
	return withStandardMiddleware(opts, mux), nil
}

// withStandardMiddleware wraps a handler in the chain every request goes
// through. The order is deliberate: the request id and the access log see every
// request, the security headers are set even on the responses the allowlist and
// the body cap reject, and the body cap is innermost so only handlers run under
// it.
func withStandardMiddleware(opts RouterOptions, handler http.Handler) http.Handler {
	handler = core.WithBodyLimit(opts.Config.BodyMaxBytes, handler)
	handler = core.WithHostAllowlist(opts.Config.AllowedHosts(), handler)
	handler = core.WithSecurityHeaders(handler)
	handler = core.WithPanicRecovery(opts.Logger, handler)
	handler = core.WithAccessLog(opts.Logger, handler)
	handler = core.WithRequestID(handler)
	return handler
}

// handleAPINotFound answers unknown /api/ paths with the error envelope, so an
// API client never receives the frontend's HTML.
func handleAPINotFound(w http.ResponseWriter, r *http.Request) {
	core.WriteJSONError(w, r, http.StatusNotFound, "not_found", "no such endpoint")
}

// newFrontendHandler serves the embedded frontend, falling back to index.html
// for any path that is not a file, because Vue Router uses HTML5 history and a
// deep link such as /biblioteca exists only in the browser.
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
