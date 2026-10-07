package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	coreapi "github.com/gabrielassisxyz/norte/server/gen/api/core"
)

// mountCoreAPI registers the core module's routes on mux. Every module lands
// the same way once it exists: its own contract, its own validator built from
// that contract, its own routes -- which is what makes switching a module off
// a matter of not mounting it.
func mountCoreAPI(mux *http.ServeMux) error {
	spec, err := coreapi.GetSwagger()
	if err != nil {
		return fmt.Errorf("loading the embedded core contract: %w", err)
	}
	strict := coreapi.NewStrictHandlerWithOptions(coreHandlers{}, nil, coreapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  writeRequestDecodeError,
		ResponseErrorHandlerFunc: writeHandlerError,
	})
	coreapi.HandlerWithOptions(strict, coreapi.StdHTTPServerOptions{
		BaseRouter:       mux,
		Middlewares:      []coreapi.MiddlewareFunc{newContractValidator(spec)},
		ErrorHandlerFunc: writeRequestDecodeError,
	})
	return nil
}

// newContractValidator rejects, before any handler runs, a request that does
// not match the contract the handlers were generated from. A handler therefore
// never sees a body with a field the contract does not name, and the shapes the
// frontend was typed against are the shapes the server actually enforces.
//
// It panics when the spec cannot produce a router. The spec is embedded in the
// binary from the same file the handlers came from, so that can only mean the
// binary itself is broken, and a server that would accept anything is worse
// than one that refuses to start.
func newContractValidator(spec *openapi3.T) func(http.Handler) http.Handler {
	return nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		ErrorHandlerWithOpts: writeContractValidationError,
		// Norte is reached over whatever host the browser used; the Host
		// allowlist in core is what decides that, with the configured public
		// URL in view, which the contract has no way to know.
		DoNotValidateServers:  true,
		SilenceServersWarning: true,
	})
}

// coreHandlers implements the core module's generated interface. This is the
// only hand-written HTTP code the core has: plain functions taking a typed
// request and returning a typed response, with routing, decoding and
// contract validation already done by the time one is called.
type coreHandlers struct{}

func (coreHandlers) GetHealth(context.Context, coreapi.GetHealthRequestObject) (coreapi.GetHealthResponseObject, error) {
	return coreapi.GetHealth200JSONResponse{Status: coreapi.Ok}, nil
}
