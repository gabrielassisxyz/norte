package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// These two reasons are the only way to tell a wrong content type and an
// unparseable body apart from a schema violation: the validator reports all
// three as one *openapi3filter.RequestError and does not export the strings it
// builds them with. The version they come from is pinned by server/go.mod, and
// a rename there surfaces as the content-type case answering 400 instead of
// 415, which is what TestContentTypeThatTheContractDoesNotDeclare asserts.
const (
	unexpectedContentTypeReason = "header Content-Type has unexpected value"
	undecodableBodyReason       = "failed to decode request body"
)

// writeContractValidationError answers a request the contract rejected, in the
// same envelope a domain failure comes back in, so a client parses one shape.
func writeContractValidationError(
	_ context.Context,
	err error,
	w http.ResponseWriter,
	r *http.Request,
	opts nethttpmiddleware.ErrorHandlerOpts,
) {
	status, code, field := classifyValidationError(err, opts.StatusCode)
	core.WriteJSONFieldError(w, r, status, code, validationMessage(err), field)
}

// writeRequestDecodeError answers a request the generated router could not
// decode -- a path or query parameter of the wrong type, before any contract
// validation gets a say.
func writeRequestDecodeError(w http.ResponseWriter, r *http.Request, err error) {
	core.WriteJSONError(w, r, http.StatusBadRequest, "invalid_request", singleLine(err.Error()))
}

// writeHandlerError answers a handler that returned an error it had no response
// for. The message is deliberately not the error: that one is for the log.
func writeHandlerError(w http.ResponseWriter, r *http.Request, _ error) {
	core.WriteJSONError(w, r, http.StatusInternalServerError, "internal", "internal error")
}

// classifyValidationError picks the status, the code and the offending field.
// The validator suggests 400 for every bad request, so the cases that are not
// one -- a content type the contract does not declare, a body past the cap --
// are recognised from the error itself rather than from its suggestion.
func classifyValidationError(err error, suggested int) (status int, code, field string) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge, "body_too_large", ""
	}

	var requestErr *openapi3filter.RequestError
	if errors.As(err, &requestErr) {
		return classifyRequestError(requestErr)
	}

	if errors.Is(err, routers.ErrPathNotFound) {
		return http.StatusNotFound, "not_found", ""
	}
	if errors.Is(err, routers.ErrMethodNotAllowed) {
		return http.StatusMethodNotAllowed, "method_not_allowed", ""
	}

	if suggested == 0 {
		suggested = http.StatusBadRequest
	}
	return suggested, "invalid_request", ""
}

func classifyRequestError(requestErr *openapi3filter.RequestError) (status int, code, field string) {
	if requestErr.RequestBody != nil && strings.HasPrefix(requestErr.Reason, unexpectedContentTypeReason) {
		return http.StatusUnsupportedMediaType, "unsupported_media_type", ""
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(requestErr.Err, &schemaErr) {
		return http.StatusBadRequest, "invalid_request", strings.Join(schemaErr.JSONPointer(), ".")
	}

	if requestErr.Reason == undecodableBodyReason {
		return http.StatusBadRequest, "invalid_json", ""
	}
	if requestErr.Parameter != nil {
		return http.StatusBadRequest, "invalid_request", requestErr.Parameter.Name
	}
	return http.StatusBadRequest, "invalid_request", ""
}

// validationMessage keeps the envelope's message to one readable line. The
// validator's own Error() embeds the offending schema and the value it rejected
// across several lines, which belongs in a log and not in a JSON field a screen
// may show.
func validationMessage(err error) string {
	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		if at := strings.Join(schemaErr.JSONPointer(), "."); at != "" {
			return fmt.Sprintf("%s: %s", at, singleLine(schemaErr.Reason))
		}
		return singleLine(schemaErr.Reason)
	}

	var requestErr *openapi3filter.RequestError
	if errors.As(err, &requestErr) {
		if requestErr.Err != nil {
			return singleLine(requestErr.Reason + ": " + requestErr.Err.Error())
		}
		return singleLine(requestErr.Reason)
	}
	return singleLine(err.Error())
}

func singleLine(message string) string {
	return strings.Join(strings.Fields(message), " ")
}
