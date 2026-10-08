package notes

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
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
func mountNotesAPI(router *app.Router, logger *slog.Logger, handlers NotesHandlers) {
	spec, err := notesapi.GetSwagger()
	if err != nil {
		panic(fmt.Sprintf("loading the embedded notes contract: %v", err))
	}
	strict := notesapi.NewStrictHandlerWithOptions(handlers, nil, notesapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  core.WriteRequestDecodeError,
		ResponseErrorHandlerFunc: core.NewInternalErrorResponder(logger),
	})
	notesapi.HandlerWithOptions(strict, notesapi.StdHTTPServerOptions{
		BaseRouter:       notesRouterAdapter{router: router},
		Middlewares:      []notesapi.MiddlewareFunc{newNotesContractValidator(spec)},
		ErrorHandlerFunc: core.WriteRequestDecodeError,
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
		ErrorHandlerWithOpts:  core.WriteContractValidationError,
		DoNotValidateServers:  true,
		SilenceServersWarning: true,
	})
}
