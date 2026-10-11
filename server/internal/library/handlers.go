package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	libraryapi "github.com/gabrielassisxyz/norte/server/gen/api/library"
	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// LibraryHandlers implements the library's generated strict interface: plain
// functions taking a typed request and returning a typed response, with
// routing, decoding and contract validation done by the time one is called.
type LibraryHandlers struct {
	service *LibraryService
}

// SaveLibraryItem saves a link, 201 on a creation and 200 on a duplicate. The
// source is adapter-owned: an absent source is Norte's own dialog, and the
// contract lets a request carry only the extension's.
func (h LibraryHandlers) SaveLibraryItem(ctx context.Context, request libraryapi.SaveLibraryItemRequestObject) (libraryapi.SaveLibraryItemResponseObject, error) {
	if request.Body == nil {
		return librarySaveDefault(http.StatusBadRequest, "invalid_request", "the save carries no body", "body", ctx), nil
	}
	body := request.Body
	source := LibrarySourceApp
	if body.Source != nil {
		source = string(*body.Source)
	}
	var selection *string
	if body.Selection != nil {
		encoded, err := json.Marshal(body.Selection)
		if err != nil {
			return librarySaveDefault(http.StatusBadRequest, "invalid_request", "the selection does not encode", "selection", ctx), nil
		}
		text := string(encoded)
		selection = &text
	}
	var linkTo []string
	if body.LinkTo != nil {
		linkTo = *body.LinkTo
	}
	var title, reason string
	if body.Title != nil {
		title = *body.Title
	}
	if body.Reason != nil {
		reason = *body.Reason
	}
	var html []byte
	if body.Html != nil {
		html = []byte(*body.Html)
	}
	outcome, err := h.service.Save(ctx, SaveInput{
		URL:       body.Url,
		Title:     title,
		HTML:      html,
		Selection: selection,
		Reason:    reason,
		LinkTo:    linkTo,
		Source:    source,
	})
	if err != nil {
		return librarySaveError(err, ctx)
	}
	if outcome.Created {
		return libraryapi.SaveLibraryItem201JSONResponse{Id: outcome.ID}, nil
	}
	return libraryapi.SaveLibraryItem200JSONResponse{Id: outcome.ID}, nil
}

// ListLibraryItems answers one page of summaries.
func (h LibraryHandlers) ListLibraryItems(ctx context.Context, request libraryapi.ListLibraryItemsRequestObject) (libraryapi.ListLibraryItemsResponseObject, error) {
	params := request.Params
	in := ListInput{}
	if params.View != nil {
		in.View = string(*params.View)
	}
	if params.Kind != nil {
		in.Kind = string(*params.Kind)
	}
	in.Unread = params.Unread
	if params.Sort != nil {
		in.Sort = string(*params.Sort)
		in.SortExplicit = true
	}
	if params.Q != nil {
		in.Query = *params.Q
	}
	if params.Cursor != nil {
		in.Cursor = *params.Cursor
	}
	if params.Limit != nil {
		in.Limit = *params.Limit
	}
	result, err := h.service.List(ctx, in)
	if err != nil {
		return libraryListError(err, ctx)
	}
	items := make([]libraryapi.LibraryItemSummary, 0, len(result.Items))
	for _, row := range result.Items {
		items = append(items, libraryMapSummary(row))
	}
	list := libraryapi.LibraryItemList{Items: items}
	if result.NextCursor != "" {
		cursor := result.NextCursor
		list.NextCursor = &cursor
	}
	return libraryapi.ListLibraryItems200JSONResponse(list), nil
}

// DrawLibraryItems answers the serendipity button: unread items drawn at
// random, weighted away from the focus unless the call asked for a uniform
// draw. An absent away_from_focus means the weighted draw, which is what the
// button is for.
func (h LibraryHandlers) DrawLibraryItems(ctx context.Context, request libraryapi.DrawLibraryItemsRequestObject) (libraryapi.DrawLibraryItemsResponseObject, error) {
	in := DrawInput{AwayFromFocus: true, N: request.Params.N, Seed: request.Params.Seed}
	if request.Params.AwayFromFocus != nil {
		in.AwayFromFocus = *request.Params.AwayFromFocus
	}
	result, err := h.service.Draw(ctx, in)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.DrawLibraryItemsdefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	items := make([]libraryapi.LibraryItemSummary, 0, len(result.Items))
	for _, row := range result.Items {
		items = append(items, libraryMapSummary(row))
	}
	return libraryapi.DrawLibraryItems200JSONResponse{Items: items}, nil
}

// GetLibraryCounts answers every library count in one query.
func (h LibraryHandlers) GetLibraryCounts(ctx context.Context, _ libraryapi.GetLibraryCountsRequestObject) (libraryapi.GetLibraryCountsResponseObject, error) {
	counts, err := h.service.Counts(ctx)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.GetLibraryCountsdefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return libraryapi.GetLibraryCounts200JSONResponse(counts), nil
}

// GetLibraryItem reads one item in full. A read never writes.
func (h LibraryHandlers) GetLibraryItem(ctx context.Context, request libraryapi.GetLibraryItemRequestObject) (libraryapi.GetLibraryItemResponseObject, error) {
	row, err := h.service.Get(ctx, request.Id)
	if err != nil {
		return libraryItemError(err, ctx)
	}
	return libraryapi.GetLibraryItem200JSONResponse(libraryMapItem(row)), nil
}

// PatchLibraryItem applies the fields present and returns the item after.
func (h LibraryHandlers) PatchLibraryItem(ctx context.Context, request libraryapi.PatchLibraryItemRequestObject) (libraryapi.PatchLibraryItemResponseObject, error) {
	if request.Body == nil {
		return libraryPatchDefault(http.StatusBadRequest, "invalid_request", "the patch carries no body", "body", ctx), nil
	}
	body := request.Body
	in := PatchInput{}
	if body.Location != nil {
		location := string(*body.Location)
		in.Location = &location
	}
	in.Unread = body.Unread
	in.Reason = body.Reason
	if body.Kind != nil {
		kind := string(*body.Kind)
		in.Kind = &kind
	}
	in.Title = body.Title
	if body.ReadPosition != nil {
		encoded, err := json.Marshal(body.ReadPosition)
		if err != nil {
			return libraryPatchDefault(http.StatusBadRequest, "invalid_request", "the read position does not encode", "read_position", ctx), nil
		}
		text := string(encoded)
		in.ReadPosition = &text
	}
	row, err := h.service.Patch(ctx, request.Id, in)
	if err != nil {
		return libraryPatchError(err, ctx)
	}
	return libraryapi.PatchLibraryItem200JSONResponse(libraryMapItem(row)), nil
}

// ExtractLibraryItem puts an item back to pending and enqueues the extraction,
// answering 202 as soon as the job is queued. The answer never waits for the
// text: that is the whole reason extraction is a job.
func (h LibraryHandlers) ExtractLibraryItem(ctx context.Context, request libraryapi.ExtractLibraryItemRequestObject) (libraryapi.ExtractLibraryItemResponseObject, error) {
	refresh := false
	if request.Body != nil && request.Body.Refresh != nil {
		refresh = *request.Body.Refresh
	}
	outcome, err := h.service.RequestExtraction(ctx, request.Id, refresh)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.ExtractLibraryItemdefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return libraryapi.ExtractLibraryItem202JSONResponse{
		ItemId:            outcome.ItemID,
		JobId:             outcome.JobID,
		ExtractGeneration: int(outcome.Generation),
	}, nil
}

// OpenLibraryItem records that an item was opened, leaving unread alone.
func (h LibraryHandlers) OpenLibraryItem(ctx context.Context, request libraryapi.OpenLibraryItemRequestObject) (libraryapi.OpenLibraryItemResponseObject, error) {
	row, err := h.service.Open(ctx, request.Id)
	if err != nil {
		var domain *LibraryError
		if errors.As(err, &domain) {
			return libraryapi.OpenLibraryItemdefaultJSONResponse{
				Body:       libraryErrorBody(domain, ctx),
				StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return libraryapi.OpenLibraryItem200JSONResponse(libraryMapItem(row)), nil
}

// libraryErrorBody renders a domain failure in the one envelope the API
// returns, with the request id the same failure was logged under.
func libraryErrorBody(domain *LibraryError, ctx context.Context) libraryapi.Error {
	detail := libraryapi.ErrorDetail{
		Code:      domain.Code,
		Message:   domain.Message,
		RequestId: core.RequestIDFromContext(ctx),
	}
	if domain.Field != "" {
		field := domain.Field
		detail.Field = &field
	}
	return libraryapi.Error{Error: detail}
}

func librarySaveDefault(status int, code, message, field string, ctx context.Context) libraryapi.SaveLibraryItemdefaultJSONResponse {
	return libraryapi.SaveLibraryItemdefaultJSONResponse{
		Body:       libraryErrorBody(&LibraryError{Status: status, Code: code, Message: message, Field: field}, ctx),
		StatusCode: status,
	}
}

func libraryListError(err error, ctx context.Context) (libraryapi.ListLibraryItemsResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryapi.ListLibraryItemsdefaultJSONResponse{
			Body:       libraryErrorBody(domain, ctx),
			StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}

func librarySaveError(err error, ctx context.Context) (libraryapi.SaveLibraryItemResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return librarySaveDefault(domain.Status, domain.Code, domain.Message, domain.Field, ctx), nil
	}
	return nil, err
}

func libraryItemError(err error, ctx context.Context) (libraryapi.GetLibraryItemResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryapi.GetLibraryItemdefaultJSONResponse{
			Body:       libraryErrorBody(domain, ctx),
			StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}

func libraryPatchDefault(status int, code, message, field string, ctx context.Context) libraryapi.PatchLibraryItemdefaultJSONResponse {
	return libraryapi.PatchLibraryItemdefaultJSONResponse{
		Body:       libraryErrorBody(&LibraryError{Status: status, Code: code, Message: message, Field: field}, ctx),
		StatusCode: status,
	}
}

func libraryPatchError(err error, ctx context.Context) (libraryapi.PatchLibraryItemResponseObject, error) {
	var domain *LibraryError
	if errors.As(err, &domain) {
		return libraryPatchDefault(domain.Status, domain.Code, domain.Message, domain.Field, ctx), nil
	}
	return nil, err
}

// libraryRouterAdapter mounts the generated routes on the module's scoped
// router. The generated package wants a ServeMux; the adapter delegates the
// registration and never serves, so ServeHTTP panics if it is ever reached.
type libraryRouterAdapter struct {
	router *app.Router
}

func (a libraryRouterAdapter) HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request)) {
	a.router.HandleFunc(pattern, handler)
}

func (a libraryRouterAdapter) ServeHTTP(http.ResponseWriter, *http.Request) {
	panic("the library router adapter registers routes and never serves")
}

// mountLibraryAPI registers the library's routes behind the same validator,
// the same error mapping and the same envelope production uses, so what the
// core proves about the contract holds for this module too.
func mountLibraryAPI(router *app.Router, logger *slog.Logger, handlers LibraryHandlers) {
	spec, err := libraryapi.GetSwagger()
	if err != nil {
		panic(fmt.Sprintf("loading the embedded library contract: %v", err))
	}
	strict := libraryapi.NewStrictHandlerWithOptions(handlers, nil, libraryapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  core.WriteRequestDecodeError,
		ResponseErrorHandlerFunc: core.NewInternalErrorResponder(logger),
	})
	libraryapi.HandlerWithOptions(strict, libraryapi.StdHTTPServerOptions{
		BaseRouter:       libraryRouterAdapter{router: router},
		Middlewares:      []libraryapi.MiddlewareFunc{newLibraryContractValidator(spec)},
		ErrorHandlerFunc: core.WriteRequestDecodeError,
	})
}

// newLibraryContractValidator rejects, before any handler runs, a request that
// does not match the contract the handlers were generated from. A handler
// therefore never sees a body with a field the contract does not name.
//
// It panics when the spec cannot produce a router. The spec is embedded in the
// binary from the same file the handlers came from, so that can only mean the
// binary itself is broken, and a server that would accept anything is worse
// than one that refuses to start.
func newLibraryContractValidator(spec *openapi3.T) func(http.Handler) http.Handler {
	return nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		ErrorHandlerWithOpts: core.WriteContractValidationError,
		// Norte is reached over whatever host the browser used; the Host
		// allowlist in core is what decides that, with the configured public
		// URL in view, which the contract has no way to know.
		DoNotValidateServers:  true,
		SilenceServersWarning: true,
	})
}
