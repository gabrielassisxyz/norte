package notes

import (
	"fmt"
	"net/http"
)

// NotesError is a domain failure with the status the handler answers with.
// Anything that is not one is a bug, and answers 500 without its message.
type NotesError struct {
	Status  int
	Code    string
	Message string
	Field   string
}

func (e *NotesError) Error() string { return e.Message }

func notesBadRequest(code, message, field string) *NotesError {
	return &NotesError{Status: http.StatusBadRequest, Code: code, Message: message, Field: field}
}

func notesNotFound(what, id string) *NotesError {
	return &NotesError{
		Status:  http.StatusNotFound,
		Code:    "not_found",
		Message: fmt.Sprintf("no %s %s", what, id),
	}
}
