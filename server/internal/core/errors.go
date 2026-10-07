package core

import (
	"encoding/json"
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
