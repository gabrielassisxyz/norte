package core

import (
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

// ContentSecurityPolicy is sent on every response. Inline styles are allowed
// because the design system and extracted articles carry them; scripts get no
// such exception, which is why the theme bootstrap is a served file.
const ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

// WithRequestID gives every request an id, in the context and in the response
// header, generating one when the client sent none.
func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if id == "" || len(id) > 128 {
			id = NewRequestID()
		}
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(ContextWithRequestID(r.Context(), id)))
	})
}

// WithSecurityHeaders sets the content security policy and the companion headers
// on every response, including the ones later middleware rejects.
func WithSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", ContentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// WithPanicRecovery turns a panicking handler into a logged 500 with the normal
// error envelope instead of a dropped connection.
func WithPanicRecovery(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(r.Context(), "panic serving request",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.String("request_id", RequestIDFromContext(r.Context())),
					slog.Any("panic", recovered),
				)
				WriteJSONError(w, r, http.StatusInternalServerError, "internal", "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// WithCanonicalMediaType lowercases the type and subtype of Content-Type
// before any contract validation sees it. A media type is case-insensitive
// (RFC 9110 section 8.3.1), but the validator looks the header up in the
// contract's content map by plain string equality, so "Application/JSON" would
// otherwise be refused as a media type the contract never declared. The
// parameters are forwarded exactly as sent, because a multipart boundary is
// case-sensitive.
func WithCanonicalMediaType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := r.Header.Get("Content-Type")
		canonical := canonicalMediaType(raw)
		if raw == "" || canonical == raw {
			next.ServeHTTP(w, r)
			return
		}
		// A copy rather than a mutation: the header map belongs to the request
		// the outer middleware is still holding, and the access log reads from
		// it after this handler returns.
		forwarded := *r
		forwarded.Header = r.Header.Clone()
		forwarded.Header.Set("Content-Type", canonical)
		next.ServeHTTP(w, &forwarded)
	})
}

func canonicalMediaType(value string) string {
	mediaType, parameters, hasParameters := strings.Cut(value, ";")
	lowered := strings.ToLower(strings.TrimSpace(mediaType))
	if !hasParameters {
		return lowered
	}
	return lowered + ";" + parameters
}

// WithHostAllowlist rejects requests whose Host is not one this server answers
// for. Norte has no authentication, so without this check a page in the user's
// browser could reach the server over DNS rebinding.
func WithHostAllowlist(allowed []string, next http.Handler) http.Handler {
	set := make(map[string]struct{}, len(allowed))
	for _, host := range allowed {
		if normalized := normalizeHost(host); normalized != "" {
			set[normalized] = struct{}{}
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := set[normalizeHost(r.Host)]; !ok {
			WriteJSONError(w, r, http.StatusMisdirectedRequest, "host_not_allowed",
				"this server does not answer for the requested host")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// normalizeHost reduces "localhost:8080", "[::1]:8080" and "::1" to the bare
// hostname the allowlist is keyed by.
func normalizeHost(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if stripped, _, err := net.SplitHostPort(host); err == nil {
		host = stripped
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	return strings.ToLower(host)
}

// ErrBodyTooLarge is what ReadLimitedBody reports when a request body ran past
// NORTE_BODY_MAX_BYTES.
var ErrBodyTooLarge = errors.New("request body too large")

// WithBodyLimit caps request bodies. A declared Content-Length over the limit is
// refused before the handler runs; a chunked body that only reveals its size
// while being read is cut off by the reader, and the handler learns about it
// through ReadLimitedBody.
func WithBodyLimit(limit int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > limit {
			WriteBodyTooLargeError(w, r)
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		next.ServeHTTP(w, r)
	})
}

// WriteBodyTooLargeError answers with the 413 every over-sized body gets,
// whether the size was declared up front or discovered mid-read.
func WriteBodyTooLargeError(w http.ResponseWriter, r *http.Request) {
	WriteJSONError(w, r, http.StatusRequestEntityTooLarge, "body_too_large",
		"request body is larger than this server accepts")
}

// ReadLimitedBody reads a capped body. On overflow it has already answered 413
// and returns ErrBodyTooLarge, so a handler only has to return.
func ReadLimitedBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	body, err := io.ReadAll(r.Body)
	if err == nil {
		return body, nil
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		WriteBodyTooLargeError(w, r)
		return nil, ErrBodyTooLarge
	}
	return nil, err
}

// statusRecorder remembers what the handler answered so the access log can
// report it. The default is 200 because a handler that writes without calling
// WriteHeader has answered 200.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if !s.wrote {
		s.status = status
		s.wrote = true
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	s.wrote = true
	return s.ResponseWriter.Write(b)
}

// WithAccessLog logs one line per request. The path is logged without its query
// string, because query strings carry tokens; bodies are never logged at all.
func WithAccessLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		logger.InfoContext(r.Context(), "request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", recorder.status),
			slog.Int64("duration_ms", time.Since(started).Milliseconds()),
			slog.String("request_id", RequestIDFromContext(r.Context())),
		)
	})
}
