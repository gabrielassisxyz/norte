package notes

import (
	"context"
	"errors"
	"net/http"

	notesapi "github.com/gabrielassisxyz/norte/server/gen/api/notes"
)

// NotesHandlers implements the notes module's generated strict interface: plain
// functions taking a typed request and returning a typed response, with
// routing, decoding and contract validation done by the time one is called.
type NotesHandlers struct {
	service *NotesService
}

/* ------------------------------------------------------------- highlights */

// CreateNoteHighlight stores a selected passage and answers with the highlight
// as it was anchored, so the reader learns at once that a passage came back
// orphaned and why.
func (h NotesHandlers) CreateNoteHighlight(ctx context.Context, request notesapi.CreateNoteHighlightRequestObject) (notesapi.CreateNoteHighlightResponseObject, error) {
	if request.Body == nil {
		return notesHighlightCreateError(
			notesBadRequest("invalid_request", "the highlight carries no body", "body"), ctx)
	}
	record, err := h.service.CreateHighlight(ctx, NewHighlightInput{
		ItemID: request.Body.ItemId,
		Exact:  request.Body.Exact,
		Prefix: notesOptional(request.Body.Prefix),
		Suffix: notesOptional(request.Body.Suffix),
	})
	if err != nil {
		return notesHighlightCreateError(err, ctx)
	}
	return notesapi.CreateNoteHighlight201JSONResponse(notesMapHighlight(record)), nil
}

// ListNoteHighlights answers one page of highlights.
func (h NotesHandlers) ListNoteHighlights(ctx context.Context, request notesapi.ListNoteHighlightsRequestObject) (notesapi.ListNoteHighlightsResponseObject, error) {
	page, err := h.service.ListHighlights(ctx, NotesListInput{
		ItemID: notesOptional(request.Params.ItemId),
		Query:  notesOptional(request.Params.Q),
		Cursor: notesOptional(request.Params.Cursor),
		Limit:  notesOptionalInt(request.Params.Limit),
	})
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.ListNoteHighlightsdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	list := notesapi.HighlightList{Items: make([]notesapi.Highlight, 0, len(page.Items))}
	for _, record := range page.Items {
		list.Items = append(list.Items, notesMapHighlight(record))
	}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		list.NextCursor = &cursor
	}
	return notesapi.ListNoteHighlights200JSONResponse(list), nil
}

// DeleteNoteHighlight removes a passage and the annotations hanging on it.
func (h NotesHandlers) DeleteNoteHighlight(ctx context.Context, request notesapi.DeleteNoteHighlightRequestObject) (notesapi.DeleteNoteHighlightResponseObject, error) {
	if err := h.service.DeleteHighlight(ctx, request.Id); err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.DeleteNoteHighlightdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.DeleteNoteHighlight204Response{}, nil
}

/* ------------------------------------------------------------ annotations */

// CreateNoteAnnotation writes a note in the margin.
func (h NotesHandlers) CreateNoteAnnotation(ctx context.Context, request notesapi.CreateNoteAnnotationRequestObject) (notesapi.CreateNoteAnnotationResponseObject, error) {
	if request.Body == nil {
		return notesAnnotationCreateError(
			notesBadRequest("invalid_request", "the annotation carries no body", "body"), ctx)
	}
	record, err := h.service.CreateAnnotation(ctx, NewAnnotationInput{
		ItemID:      request.Body.ItemId,
		HighlightID: notesOptional(request.Body.HighlightId),
		Text:        request.Body.Text,
	})
	if err != nil {
		return notesAnnotationCreateError(err, ctx)
	}
	return notesapi.CreateNoteAnnotation201JSONResponse(notesMapAnnotation(record)), nil
}

// ListNoteAnnotations answers one page of margin notes.
func (h NotesHandlers) ListNoteAnnotations(ctx context.Context, request notesapi.ListNoteAnnotationsRequestObject) (notesapi.ListNoteAnnotationsResponseObject, error) {
	page, err := h.service.ListAnnotations(ctx, NotesListInput{
		ItemID: notesOptional(request.Params.ItemId),
		Query:  notesOptional(request.Params.Q),
		Cursor: notesOptional(request.Params.Cursor),
		Limit:  notesOptionalInt(request.Params.Limit),
	})
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.ListNoteAnnotationsdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	list := notesapi.AnnotationList{Items: make([]notesapi.Annotation, 0, len(page.Items))}
	for _, record := range page.Items {
		list.Items = append(list.Items, notesMapAnnotation(record))
	}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		list.NextCursor = &cursor
	}
	return notesapi.ListNoteAnnotations200JSONResponse(list), nil
}

// UpdateNoteAnnotation rewrites a margin note.
func (h NotesHandlers) UpdateNoteAnnotation(ctx context.Context, request notesapi.UpdateNoteAnnotationRequestObject) (notesapi.UpdateNoteAnnotationResponseObject, error) {
	if request.Body == nil {
		return notesapi.UpdateNoteAnnotationdefaultJSONResponse{
			Body: notesErrorBody(notesBadRequest("invalid_request",
				"the change carries no body", "body"), ctx),
			StatusCode: http.StatusBadRequest,
		}, nil
	}
	record, err := h.service.UpdateAnnotation(ctx, request.Id, request.Body.Text)
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.UpdateNoteAnnotationdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.UpdateNoteAnnotation200JSONResponse(notesMapAnnotation(record)), nil
}

// DeleteNoteAnnotation removes a margin note.
func (h NotesHandlers) DeleteNoteAnnotation(ctx context.Context, request notesapi.DeleteNoteAnnotationRequestObject) (notesapi.DeleteNoteAnnotationResponseObject, error) {
	if err := h.service.DeleteAnnotation(ctx, request.Id); err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.DeleteNoteAnnotationdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.DeleteNoteAnnotation204Response{}, nil
}

/* -------------------------------------------------------- the item's note */

// GetNoteItemNote reads the one freeform note an item carries.
func (h NotesHandlers) GetNoteItemNote(ctx context.Context, request notesapi.GetNoteItemNoteRequestObject) (notesapi.GetNoteItemNoteResponseObject, error) {
	row, stored, err := h.service.ItemNote(ctx, request.ItemId)
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.GetNoteItemNotedefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.GetNoteItemNote200JSONResponse(notesMapItemNote(request.ItemId, row, stored)), nil
}

// PutNoteItemNote replaces the item's note, or clears it when the text is empty.
func (h NotesHandlers) PutNoteItemNote(ctx context.Context, request notesapi.PutNoteItemNoteRequestObject) (notesapi.PutNoteItemNoteResponseObject, error) {
	if request.Body == nil {
		return notesapi.PutNoteItemNotedefaultJSONResponse{
			Body: notesErrorBody(notesBadRequest("invalid_request",
				"the note carries no body", "body"), ctx),
			StatusCode: http.StatusBadRequest,
		}, nil
	}
	row, stored, err := h.service.PutItemNote(ctx, request.ItemId, request.Body.Text)
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.PutNoteItemNotedefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.PutNoteItemNote200JSONResponse(notesMapItemNote(request.ItemId, row, stored)), nil
}

/* --------------------------------------------------------------- questions */

// CreateNoteQuestion stores one question.
func (h NotesHandlers) CreateNoteQuestion(ctx context.Context, request notesapi.CreateNoteQuestionRequestObject) (notesapi.CreateNoteQuestionResponseObject, error) {
	if request.Body == nil {
		return notesapi.CreateNoteQuestiondefaultJSONResponse{
			Body: notesErrorBody(notesBadRequest("invalid_request",
				"the question carries no body", "body"), ctx),
			StatusCode: http.StatusBadRequest,
		}, nil
	}
	kind := ""
	if request.Body.Kind != nil {
		kind = string(*request.Body.Kind)
	}
	record, err := h.service.CreateQuestion(ctx, NewQuestionInput{
		ItemID:       notesOptional(request.Body.ItemId),
		AnnotationID: notesOptional(request.Body.AnnotationId),
		SetID:        notesOptional(request.Body.SetId),
		Kind:         kind,
		Text:         request.Body.Text,
	})
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.CreateNoteQuestiondefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.CreateNoteQuestion201JSONResponse(notesMapQuestion(record)), nil
}

// ListNoteQuestions answers one page of questions.
func (h NotesHandlers) ListNoteQuestions(ctx context.Context, request notesapi.ListNoteQuestionsRequestObject) (notesapi.ListNoteQuestionsResponseObject, error) {
	status := ""
	if request.Params.Status != nil {
		status = string(*request.Params.Status)
	}
	page, err := h.service.ListQuestions(ctx, NotesListInput{
		ItemID: notesOptional(request.Params.ItemId),
		SetID:  notesOptional(request.Params.SetId),
		Status: status,
		Query:  notesOptional(request.Params.Q),
		Cursor: notesOptional(request.Params.Cursor),
		Limit:  notesOptionalInt(request.Params.Limit),
	})
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.ListNoteQuestionsdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	list := notesapi.QuestionList{Items: make([]notesapi.Question, 0, len(page.Items))}
	for _, record := range page.Items {
		list.Items = append(list.Items, notesMapQuestion(record))
	}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		list.NextCursor = &cursor
	}
	return notesapi.ListNoteQuestions200JSONResponse(list), nil
}

// UpdateNoteQuestion applies only the fields the request carried.
func (h NotesHandlers) UpdateNoteQuestion(ctx context.Context, request notesapi.UpdateNoteQuestionRequestObject) (notesapi.UpdateNoteQuestionResponseObject, error) {
	if request.Body == nil {
		return notesapi.UpdateNoteQuestiondefaultJSONResponse{
			Body: notesErrorBody(notesBadRequest("invalid_request",
				"the change carries no body", "body"), ctx),
			StatusCode: http.StatusBadRequest,
		}, nil
	}
	patch := NotesQuestionPatch{Text: request.Body.Text, Answer: request.Body.Answer}
	if request.Body.Status != nil {
		status := string(*request.Body.Status)
		patch.Status = &status
	}
	record, err := h.service.UpdateQuestion(ctx, request.Id, patch)
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.UpdateNoteQuestiondefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.UpdateNoteQuestion200JSONResponse(notesMapQuestion(record)), nil
}

/* ----------------------------------------------------------- question sets */

// CreateNoteQuestionSet opens a set on a topic and stores the prompts filled in.
func (h NotesHandlers) CreateNoteQuestionSet(ctx context.Context, request notesapi.CreateNoteQuestionSetRequestObject) (notesapi.CreateNoteQuestionSetResponseObject, error) {
	if request.Body == nil {
		return notesapi.CreateNoteQuestionSetdefaultJSONResponse{
			Body: notesErrorBody(notesBadRequest("invalid_request",
				"the question set carries no body", "body"), ctx),
			StatusCode: http.StatusBadRequest,
		}, nil
	}
	prompts := []NotesQuestionSetPrompt{}
	if request.Body.Questions != nil {
		for _, prompt := range *request.Body.Questions {
			prompts = append(prompts, NotesQuestionSetPrompt{Kind: string(prompt.Kind), Text: prompt.Text})
		}
	}
	record, err := h.service.CreateQuestionSet(ctx, NewQuestionSetInput{Topic: request.Body.Topic, Prompts: prompts})
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.CreateNoteQuestionSetdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.CreateNoteQuestionSet201JSONResponse(notesMapQuestionSetDetail(record)), nil
}

// ListNoteQuestionSets answers one page of sets.
func (h NotesHandlers) ListNoteQuestionSets(ctx context.Context, request notesapi.ListNoteQuestionSetsRequestObject) (notesapi.ListNoteQuestionSetsResponseObject, error) {
	page, err := h.service.ListQuestionSets(ctx, NotesListInput{
		Query:  notesOptional(request.Params.Q),
		Cursor: notesOptional(request.Params.Cursor),
		Limit:  notesOptionalInt(request.Params.Limit),
	})
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.ListNoteQuestionSetsdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	list := notesapi.QuestionSetList{Items: make([]notesapi.QuestionSet, 0, len(page.Items))}
	for _, record := range page.Items {
		list.Items = append(list.Items, notesapi.QuestionSet{
			Id:            record.Row.ID,
			Topic:         record.Row.Topic,
			QuestionCount: record.Count,
			CreatedAt:     record.Row.CreatedAt,
		})
	}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		list.NextCursor = &cursor
	}
	return notesapi.ListNoteQuestionSets200JSONResponse(list), nil
}

// GetNoteQuestionSet reads one set with its questions.
func (h NotesHandlers) GetNoteQuestionSet(ctx context.Context, request notesapi.GetNoteQuestionSetRequestObject) (notesapi.GetNoteQuestionSetResponseObject, error) {
	record, err := h.service.QuestionSet(ctx, request.Id)
	if err != nil {
		var domain *NotesError
		if errors.As(err, &domain) {
			return notesapi.GetNoteQuestionSetdefaultJSONResponse{
				Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
			}, nil
		}
		return nil, err
	}
	return notesapi.GetNoteQuestionSet200JSONResponse(notesMapQuestionSetDetail(record)), nil
}

/* --------------------------------------------------------------- counts */

// GetNoteCounts answers every count the sidebar and the tabs print.
func (h NotesHandlers) GetNoteCounts(ctx context.Context, _ notesapi.GetNoteCountsRequestObject) (notesapi.GetNoteCountsResponseObject, error) {
	counts, err := h.service.Counts(ctx)
	if err != nil {
		return nil, err
	}
	return notesapi.GetNoteCounts200JSONResponse{
		Highlights: counts.Highlights,
		Anotacoes:  counts.Annotations,
		Perguntas:  counts.Questions,
		Conjuntos:  counts.Sets,
	}, nil
}
