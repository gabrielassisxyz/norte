package core

import (
	"fmt"
	"net/http"
)

// APIError is a failure the core's own endpoints answer with: a status, the
// stable code a client branches on, the sentence a person reads, and the one
// input it is attributable to when there is one.
//
// It exists so a service can refuse a request without importing net/http
// semantics into every call site, and so a handler can tell a refusal it
// should render from a fault it should log.
type APIError struct {
	Status  int
	Code    string
	Message string
	Field   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func apiBadRequest(code, message, field string) *APIError {
	return &APIError{Status: http.StatusBadRequest, Code: code, Message: message, Field: field}
}

func apiNotFound(what, id string) *APIError {
	return &APIError{
		Status:  http.StatusNotFound,
		Code:    "not_found",
		Message: fmt.Sprintf("there is no %s %s", what, id),
	}
}

func apiConflict(code, message, field string) *APIError {
	return &APIError{Status: http.StatusConflict, Code: code, Message: message, Field: field}
}
