package core

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorBody is the only error shape the API returns, so a client can parse one
// envelope for every failure.
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail carries a machine-readable code, a human message, the offending
// field when there is one, and the request id the same failure was logged under.
type ErrorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Field     string `json:"field,omitempty"`
	RequestID string `json:"request_id"`
}

// WriteJSONError answers a request with the canonical error envelope. The
// request id comes from the request context so that a user reporting an error
// body can be matched to a log line.
func WriteJSONError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSONErrorField(w, r, status, code, message, "")
}

// WriteJSONFieldError is WriteJSONError for a failure attributable to one input.
func WriteJSONFieldError(w http.ResponseWriter, r *http.Request, status int, code, message, field string) {
	writeJSONErrorField(w, r, status, code, message, field)
}

func writeJSONErrorField(w http.ResponseWriter, r *http.Request, status int, code, message, field string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorBody{Error: ErrorDetail{
		Code:      code,
		Message:   message,
		Field:     field,
		RequestID: RequestIDFromContext(r.Context()),
	}})
}

// NewInternalErrorResponder builds the handler a generated strict server calls
// when a module's handler returned an error it had no response for. The cause
// is logged and the body carries only the generic message, so the request id
// both of them quote is the only thing that ties a reported failure to the
// line that recorded it.
func NewInternalErrorResponder(logger *slog.Logger) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		WriteInternalError(logger, w, r, err)
	}
}

// WriteInternalError logs the cause of a failure the client is deliberately
// told nothing about, then answers the generic envelope.
func WriteInternalError(logger *slog.Logger, w http.ResponseWriter, r *http.Request, err error) {
	if logger == nil {
		// A handler reached without a logger is still a handler that failed,
		// and a 500 nobody can explain is the defect this exists to close.
		logger = slog.Default()
	}
	cause := "the handler reported no error"
	if err != nil {
		cause = err.Error()
	}
	logger.ErrorContext(r.Context(), "internal error serving request",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("request_id", RequestIDFromContext(r.Context())),
		slog.String("error", cause),
	)
	WriteJSONError(w, r, http.StatusInternalServerError, "internal", "internal error")
}
