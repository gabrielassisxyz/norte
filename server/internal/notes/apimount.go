package notes

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

	notesapi "github.com/gabrielassisxyz/norte/server/gen/api/notes"
	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// notesRouterAdapter mounts the generated routes on the module's scoped
// router. The generated package wants a ServeMux; the adapter delegates the
// registration and never serves, so ServeHTTP panics if it is ever reached.
type notesRouterAdapter struct {
	router *app.Router
}

func (a notesRouterAdapter) HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request)) {
	a.router.HandleFunc(pattern, handler)
}

func (a notesRouterAdapter) ServeHTTP(http.ResponseWriter, *http.Request) {
	panic("the notes router adapter registers routes and never serves")
}

// mountNotesAPI registers the notes routes behind the same validator, the same
// error mapping and the same envelope production uses, so what the core proves
// about the contract holds for this module too.
func mountNotesAPI(router *app.Router, handlers NotesHandlers) {
	spec, err := notesapi.GetSwagger()
	if err != nil {
		panic(fmt.Sprintf("loading the embedded notes contract: %v", err))
	}
	strict := notesapi.NewStrictHandlerWithOptions(handlers, nil, notesapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  writeNotesDecodeError,
		ResponseErrorHandlerFunc: writeNotesHandlerError,
	})
	notesapi.HandlerWithOptions(strict, notesapi.StdHTTPServerOptions{
		BaseRouter:       notesRouterAdapter{router: router},
		Middlewares:      []notesapi.MiddlewareFunc{newNotesContractValidator(spec)},
		ErrorHandlerFunc: writeNotesDecodeError,
	})
}

// newNotesContractValidator rejects, before any handler runs, a request that
// does not match the contract the handlers were generated from. A handler
// therefore never sees a body with a field the contract does not name.
//
// It panics when the spec cannot produce a router. The spec is embedded in the
// binary from the same file the handlers came from, so that can only mean the
// binary itself is broken, and a server that would accept anything is worse
// than one that refuses to start.
func newNotesContractValidator(spec *openapi3.T) func(http.Handler) http.Handler {
	return nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		ErrorHandlerWithOpts:  writeNotesValidationError,
		DoNotValidateServers:  true,
		SilenceServersWarning: true,
	})
}

// These two reasons are the only way to tell a wrong content type and an
// unparseable body apart from a schema violation: the validator reports all
// three as one *openapi3filter.RequestError and does not export the strings it
// builds them with.
const (
	notesUnexpectedContentTypeReason = "header Content-Type has unexpected value"
	notesUndecodableBodyReason       = "failed to decode request body"
)

func writeNotesValidationError(
	_ context.Context,
	err error,
	w http.ResponseWriter,
	r *http.Request,
	opts nethttpmiddleware.ErrorHandlerOpts,
) {
	status, code, field := notesClassifyValidationError(err, opts.StatusCode)
	core.WriteJSONFieldError(w, r, status, code, notesValidationMessage(err), field)
}

func writeNotesDecodeError(w http.ResponseWriter, r *http.Request, err error) {
	core.WriteJSONError(w, r, http.StatusBadRequest, "invalid_request", notesSingleLine(err.Error()))
}

// writeNotesHandlerError answers a handler that returned an error it had no
// response for. The message is deliberately not the error: that one is for the
// log.
func writeNotesHandlerError(w http.ResponseWriter, r *http.Request, _ error) {
	core.WriteJSONError(w, r, http.StatusInternalServerError, "internal", "internal error")
}

func notesClassifyValidationError(err error, suggested int) (status int, code, field string) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge, "body_too_large", ""
	}
	var requestErr *openapi3filter.RequestError
	if errors.As(err, &requestErr) {
		return notesClassifyRequestError(requestErr)
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

func notesClassifyRequestError(requestErr *openapi3filter.RequestError) (status int, code, field string) {
	if requestErr.RequestBody != nil && strings.HasPrefix(requestErr.Reason, notesUnexpectedContentTypeReason) {
		return http.StatusUnsupportedMediaType, "unsupported_media_type", ""
	}
	var schemaErr *openapi3.SchemaError
	if errors.As(requestErr.Err, &schemaErr) {
		return http.StatusBadRequest, "invalid_request", strings.Join(schemaErr.JSONPointer(), ".")
	}
	if requestErr.Reason == notesUndecodableBodyReason {
		return http.StatusBadRequest, "invalid_json", ""
	}
	if requestErr.Parameter != nil {
		return http.StatusBadRequest, "invalid_request", requestErr.Parameter.Name
	}
	return http.StatusBadRequest, "invalid_request", ""
}

// notesValidationMessage keeps the envelope's message to one readable line. The
// validator's own Error() embeds the offending schema and the value it rejected
// across several lines, which belongs in a log and not in a JSON field a screen
// may show.
func notesValidationMessage(err error) string {
	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		if at := strings.Join(schemaErr.JSONPointer(), "."); at != "" {
			return fmt.Sprintf("%s: %s", at, notesSingleLine(schemaErr.Reason))
		}
		return notesSingleLine(schemaErr.Reason)
	}
	var requestErr *openapi3filter.RequestError
	if errors.As(err, &requestErr) {
		if requestErr.Err != nil {
			return notesSingleLine(requestErr.Reason + ": " + requestErr.Err.Error())
		}
		return notesSingleLine(requestErr.Reason)
	}
	return notesSingleLine(err.Error())
}

func notesSingleLine(message string) string {
	return strings.Join(strings.Fields(message), " ")
}
