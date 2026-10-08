package core

import (
	"context"
	"errors"
	"net/http"

	coreapi "github.com/gabrielassisxyz/norte/server/gen/api/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/db"
)

// APIHandlers implements the subjects, focus and links half of the core's
// generated interface.
//
// It lives in this package, next to the services it calls, while the two
// always-on endpoints a client reaches before it knows anything -- /api/config
// and /api/health -- stay with the process configuration they answer from. The
// type the router mounts embeds this one, so both halves satisfy one generated
// interface without the core learning what a module registry is.
type APIHandlers struct {
	subjects *Subjects
	focus    *FocusAPI
	links    *LinkAPI
	search   *SearchAPI
}

// NewAPIHandlers wires the handlers over the services. A nil database means
// this process has none -- a test mounting the router to check the contract,
// for instance -- and every endpoint here then answers 503 rather than
// panicking inside a query.
func NewAPIHandlers(database *Database, clock Clock, providers []FocusProvider,
	searchProviders []SearchProvider, enabledModules []string) APIHandlers {
	if database == nil {
		return APIHandlers{}
	}
	subjects := NewSubjects(database, clock).CountingModules(enabledModules)
	return APIHandlers{
		subjects: subjects,
		focus:    NewFocusAPI(subjects, providers),
		links:    NewLinkAPI(database, clock),
		search:   NewSearchAPI(subjects, searchProviders),
	}
}

// errNoDatabase is what every endpoint here answers when the process was
// assembled without one. It is a 503 and not a 500 because the server is
// running and the request was fine; what is missing is the storage behind it.
var errNoDatabase = &APIError{
	Status:  http.StatusServiceUnavailable,
	Code:    "no_database",
	Message: "this server was started without a database",
}

func (h APIHandlers) ready() error {
	if h.subjects == nil {
		return errNoDatabase
	}
	return nil
}

// ListCoreSubjects answers one page of subjects.
func (h APIHandlers) ListCoreSubjects(ctx context.Context, request coreapi.ListCoreSubjectsRequestObject) (coreapi.ListCoreSubjectsResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.ListCoreSubjectsdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	in := SubjectListInput{}
	if request.Params.Q != nil {
		in.Query = *request.Params.Q
	}
	if request.Params.Cursor != nil {
		in.Cursor = *request.Params.Cursor
	}
	if request.Params.Limit != nil {
		in.Limit = *request.Params.Limit
	}
	page, err := h.subjects.List(ctx, in)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.ListCoreSubjectsdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	list := coreapi.SubjectList{Items: mapSubjects(page.Items)}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		list.NextCursor = &cursor
	}
	return coreapi.ListCoreSubjects200JSONResponse(list), nil
}

// CreateCoreSubject creates a subject and answers with it.
func (h APIHandlers) CreateCoreSubject(ctx context.Context, request coreapi.CreateCoreSubjectRequestObject) (coreapi.CreateCoreSubjectResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.CreateCoreSubjectdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	if request.Body == nil {
		return coreapi.CreateCoreSubjectdefaultJSONResponse(coreAPIRefusal(
			apiBadRequest("invalid_request", "the request carries no body", "body"), ctx)), nil
	}
	focus := false
	if request.Body.Focus != nil {
		focus = *request.Body.Focus
	}
	record, err := h.subjects.Create(ctx, request.Body.Name, focus)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.CreateCoreSubjectdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.CreateCoreSubject201JSONResponse(mapSubject(record)), nil
}

// GetCoreSubject reads one subject by id.
func (h APIHandlers) GetCoreSubject(ctx context.Context, request coreapi.GetCoreSubjectRequestObject) (coreapi.GetCoreSubjectResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.GetCoreSubjectdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	record, err := h.subjects.Get(ctx, request.Id)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.GetCoreSubjectdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.GetCoreSubject200JSONResponse(mapSubject(record)), nil
}

// GetCoreSubjectBySlug reads one subject by the slug its screen is addressed
// with.
func (h APIHandlers) GetCoreSubjectBySlug(ctx context.Context, request coreapi.GetCoreSubjectBySlugRequestObject) (coreapi.GetCoreSubjectBySlugResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.GetCoreSubjectBySlugdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	record, err := h.subjects.GetBySlug(ctx, request.Slug)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.GetCoreSubjectBySlugdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.GetCoreSubjectBySlug200JSONResponse(mapSubject(record)), nil
}

// PatchCoreSubject renames a subject or flips its focus.
func (h APIHandlers) PatchCoreSubject(ctx context.Context, request coreapi.PatchCoreSubjectRequestObject) (coreapi.PatchCoreSubjectResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.PatchCoreSubjectdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	if request.Body == nil {
		return coreapi.PatchCoreSubjectdefaultJSONResponse(coreAPIRefusal(
			apiBadRequest("invalid_request", "the patch carries no body", "body"), ctx)), nil
	}
	record, err := h.subjects.Patch(ctx, request.Id, request.Body.Name, request.Body.Focus)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.PatchCoreSubjectdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.PatchCoreSubject200JSONResponse(mapSubject(record)), nil
}

// DeleteCoreSubject deletes a subject and everything linking to it.
func (h APIHandlers) DeleteCoreSubject(ctx context.Context, request coreapi.DeleteCoreSubjectRequestObject) (coreapi.DeleteCoreSubjectResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.DeleteCoreSubjectdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	if err := h.subjects.Delete(ctx, request.Id); err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.DeleteCoreSubjectdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.DeleteCoreSubject204Response{}, nil
}

// GetCoreFocus answers what the person is working on now.
func (h APIHandlers) GetCoreFocus(ctx context.Context, _ coreapi.GetCoreFocusRequestObject) (coreapi.GetCoreFocusResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.GetCoreFocusdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	result, err := h.focus.Current(ctx)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.GetCoreFocusdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	targets := make([]coreapi.FocusTarget, 0, len(result.Targets))
	for _, target := range result.Targets {
		targets = append(targets, coreapi.FocusTarget{Id: target.ID, Type: target.Type, Title: target.Title})
	}
	return coreapi.GetCoreFocus200JSONResponse(coreapi.Focus{
		Subjects: mapSubjects(result.Subjects),
		Targets:  targets,
	}), nil
}

// ListCoreLinks answers one page of links.
func (h APIHandlers) ListCoreLinks(ctx context.Context, request coreapi.ListCoreLinksRequestObject) (coreapi.ListCoreLinksResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.ListCoreLinksdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	in := LinkListInput{}
	if request.Params.SrcId != nil {
		in.SrcID = *request.Params.SrcId
	}
	if request.Params.DstId != nil {
		in.DstID = *request.Params.DstId
	}
	if request.Params.Kind != nil {
		in.Kind = string(*request.Params.Kind)
	}
	if request.Params.Status != nil {
		in.Status = string(*request.Params.Status)
	}
	if request.Params.Cursor != nil {
		in.Cursor = *request.Params.Cursor
	}
	if request.Params.Limit != nil {
		in.Limit = *request.Params.Limit
	}
	page, err := h.links.List(ctx, in)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.ListCoreLinksdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	list := coreapi.LinkList{Items: mapLinks(page.Items)}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		list.NextCursor = &cursor
	}
	return coreapi.ListCoreLinks200JSONResponse(list), nil
}

// CreateCoreLink asserts that a link holds.
func (h APIHandlers) CreateCoreLink(ctx context.Context, request coreapi.CreateCoreLinkRequestObject) (coreapi.CreateCoreLinkResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.CreateCoreLinkdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	if request.Body == nil {
		return coreapi.CreateCoreLinkdefaultJSONResponse(coreAPIRefusal(
			apiBadRequest("invalid_request", "the request carries no body", "body"), ctx)), nil
	}
	kind := ""
	if request.Body.Kind != nil {
		kind = string(*request.Body.Kind)
	}
	record, err := h.links.Create(ctx, request.Body.SrcId, request.Body.DstId, kind)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.CreateCoreLinkdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.CreateCoreLink201JSONResponse(mapLink(record)), nil
}

// DecideCoreLink accepts or rejects a suggested link.
func (h APIHandlers) DecideCoreLink(ctx context.Context, request coreapi.DecideCoreLinkRequestObject) (coreapi.DecideCoreLinkResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.DecideCoreLinkdefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	if request.Body == nil {
		return coreapi.DecideCoreLinkdefaultJSONResponse(coreAPIRefusal(
			apiBadRequest("invalid_request", "the request carries no body", "body"), ctx)), nil
	}
	record, err := h.links.Decide(ctx, request.Id, string(request.Body.Decision))
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.DecideCoreLinkdefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.DecideCoreLink200JSONResponse(mapLink(record)), nil
}

// coreAPIErrorFields is the shape every generated `...defaultJSONResponse`
// has. Naming it once lets one renderer serve fourteen endpoints: each
// generated type is a distinct struct with these exact fields, so the value
// converts into whichever one the handler has to return.
type coreAPIErrorFields struct {
	Body       coreapi.Error
	StatusCode int
}

// coreAPIFailure renders a refusal the client should be told about, in the one
// envelope the API returns and with the request id the same failure was logged
// under. It reports false for a fault that belongs in the log and nowhere
// else, which the generated router then answers as a bare 500.
func coreAPIFailure(err error, ctx context.Context) (coreAPIErrorFields, bool) {
	var domain *APIError
	if !errors.As(err, &domain) {
		return coreAPIErrorFields{}, false
	}
	return coreAPIRefusal(domain, ctx), true
}

// coreAPIRefusal renders a refusal this package built itself, which is always
// one the client should see.
func coreAPIRefusal(domain *APIError, ctx context.Context) coreAPIErrorFields {
	detail := coreapi.ErrorDetail{
		Code:      domain.Code,
		Message:   domain.Message,
		RequestId: RequestIDFromContext(ctx),
	}
	if domain.Field != "" {
		field := domain.Field
		detail.Field = &field
	}
	return coreAPIErrorFields{
		Body:       coreapi.Error{Error: detail},
		StatusCode: domain.Status,
	}
}

func mapSubjects(records []SubjectRecord) []coreapi.Subject {
	out := make([]coreapi.Subject, 0, len(records))
	for _, record := range records {
		out = append(out, mapSubject(record))
	}
	return out
}

func mapSubject(record SubjectRecord) coreapi.Subject {
	byType := make([]coreapi.SubjectTypeCount, 0, len(record.ByType))
	for _, count := range record.ByType {
		byType = append(byType, coreapi.SubjectTypeCount{
			Module: count.Module,
			Type:   count.Type,
			Count:  count.Count,
		})
	}
	return coreapi.Subject{
		Id:        record.Row.ID,
		Name:      record.Row.Name,
		Slug:      record.Row.Slug,
		Focus:     SubjectFocus(record.Row),
		CreatedAt: record.Row.CreatedAt,
		Counts:    coreapi.SubjectCounts{Total: record.Total, ByType: byType},
		LinkCount: record.LinkCount,
	}
}

func mapLinks(records []LinkRecord) []coreapi.Link {
	out := make([]coreapi.Link, 0, len(records))
	for _, record := range records {
		out = append(out, mapLink(record))
	}
	return out
}

func mapLink(record LinkRecord) coreapi.Link {
	link := coreapi.Link{
		Id:        record.Row.ID,
		Kind:      coreapi.LinkKind(record.Row.Kind),
		Source:    coreapi.LinkSource(record.Row.Source),
		Status:    coreapi.LinkStatus(record.Row.Status),
		CreatedAt: record.Row.CreatedAt,
		Src:       mapRegistryItem(record.Src),
		Dst:       mapRegistryItem(record.Dst),
	}
	if record.Row.Confidence.Valid {
		confidence := float32(record.Row.Confidence.Float64)
		link.Confidence = &confidence
	}
	if record.Row.DecidedAt.Valid {
		decided := record.Row.DecidedAt.String
		link.DecidedAt = &decided
	}
	return link
}

func mapRegistryItem(row db.CoreItem) coreapi.RegistryItem {
	item := coreapi.RegistryItem{
		Id:     row.ID,
		Module: row.Module,
		Type:   row.Type,
		Title:  row.Title,
	}
	if row.Url.Valid {
		url := row.Url.String
		item.Url = &url
	}
	return item
}
