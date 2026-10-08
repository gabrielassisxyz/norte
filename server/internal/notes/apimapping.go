package notes

import (
	"context"
	"database/sql"
	"errors"

	notesapi "github.com/gabrielassisxyz/norte/server/gen/api/notes"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/notes/db"
)

func notesMapHighlight(record NotesHighlightRecord) notesapi.Highlight {
	highlight := notesapi.Highlight{
		Id:           record.Row.ID,
		ItemId:       record.Row.ItemID,
		Exact:        record.Row.Exact,
		Prefix:       record.Row.Prefix,
		Suffix:       record.Row.Suffix,
		PositionHint: int(record.Row.PositionHint),
		Status:       notesapi.HighlightStatus(record.Row.Status),
		CreatedAt:    record.Row.CreatedAt,
		SectionRef:   notesNullString(record.Row.SectionRef),
		Source:       notesMapSource(record.Source),
	}
	highlight.LocationLabel = notesNullString(record.Row.LocationLabel)
	if record.Ambiguous {
		ambiguous := true
		highlight.Ambiguous = &ambiguous
	}
	return highlight
}

func notesMapAnnotation(record NotesAnnotationRecord) notesapi.Annotation {
	annotation := notesapi.Annotation{
		Id:          record.Row.ID,
		ItemId:      record.Row.ItemID,
		HighlightId: notesNullString(record.Row.HighlightID),
		Text:        record.Row.Text,
		CreatedAt:   record.Row.CreatedAt,
		UpdatedAt:   record.Row.UpdatedAt,
		Source:      notesMapSource(record.Source),
	}
	if record.Quote != "" {
		quote := record.Quote
		annotation.Quote = &quote
	}
	return annotation
}

func notesMapQuestion(record NotesQuestionRecord) notesapi.Question {
	question := notesapi.Question{
		Id:           record.Row.ID,
		ItemId:       notesNullString(record.Row.ItemID),
		AnnotationId: notesNullString(record.Row.AnnotationID),
		SetId:        notesNullString(record.Row.SetID),
		Text:         record.Row.Text,
		Answer:       notesNullString(record.Row.Answer),
		Status:       notesapi.QuestionStatus(record.Row.Status),
		CreatedAt:    record.Row.CreatedAt,
		UpdatedAt:    record.Row.UpdatedAt,
		Source:       notesMapSource(record.Source),
	}
	if record.Row.Kind.Valid {
		kind := notesapi.QuestionKind(record.Row.Kind.String)
		question.Kind = &kind
	}
	return question
}

func notesMapQuestionSetDetail(record NotesQuestionSetRecord) notesapi.QuestionSetDetail {
	questions := make([]notesapi.Question, 0, len(record.Questions))
	for _, question := range record.Questions {
		questions = append(questions, notesMapQuestion(question))
	}
	return notesapi.QuestionSetDetail{
		Id:            record.Row.ID,
		Topic:         record.Row.Topic,
		QuestionCount: record.Count,
		CreatedAt:     record.Row.CreatedAt,
		Questions:     questions,
	}
}

// notesMapItemNote renders the one note an item carries. An item with no note
// answers with the empty text and no id, which is what tells the reader's tab
// apart "nothing written yet" from "written and then emptied".
func notesMapItemNote(itemID string, row db.NotesNote, stored bool) notesapi.ItemNote {
	note := notesapi.ItemNote{ItemId: itemID, Text: row.Text}
	if !stored {
		note.Text = ""
		return note
	}
	id := row.ID
	createdAt := row.CreatedAt
	updatedAt := row.UpdatedAt
	note.Id = &id
	note.CreatedAt = &createdAt
	note.UpdatedAt = &updatedAt
	return note
}

func notesMapSource(source NotesSourceRef) *notesapi.NoteSource {
	if !source.Found {
		return nil
	}
	mapped := notesapi.NoteSource{
		Id:     source.ID,
		Module: source.Module,
		Type:   source.Type,
		Title:  source.Title,
	}
	if source.URL != "" {
		url := source.URL
		mapped.Url = &url
	}
	return &mapped
}

func notesOptional(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func notesOptionalInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

// notesNullString renders a nullable column as an absent field rather than as
// an empty string: "this annotation hangs on no highlight" is one value on the
// wire, and a client that received "" would have to know it means nothing.
func notesNullString(value sql.NullString) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	text := value.String
	return &text
}

/* ----------------------------------------------------------------- errors */

// notesErrorBody renders a domain failure in the one envelope the API returns,
// with the request id the same failure was logged under.
func notesErrorBody(domain *NotesError, ctx context.Context) notesapi.Error {
	detail := notesapi.ErrorDetail{
		Code:      domain.Code,
		Message:   domain.Message,
		RequestId: core.RequestIDFromContext(ctx),
	}
	if domain.Field != "" {
		field := domain.Field
		detail.Field = &field
	}
	return notesapi.Error{Error: detail}
}

// notesHighlightCreateError renders a failed creation in the response type that
// operation declares. The generated response objects are per-operation, so a
// shared helper can only exist per operation; these two are the ones with two
// call sites each.
func notesHighlightCreateError(err error, ctx context.Context) (notesapi.CreateNoteHighlightResponseObject, error) {
	var domain *NotesError
	if errors.As(err, &domain) {
		return notesapi.CreateNoteHighlightdefaultJSONResponse{
			Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}

func notesAnnotationCreateError(err error, ctx context.Context) (notesapi.CreateNoteAnnotationResponseObject, error) {
	var domain *NotesError
	if errors.As(err, &domain) {
		return notesapi.CreateNoteAnnotationdefaultJSONResponse{
			Body: notesErrorBody(domain, ctx), StatusCode: domain.Status,
		}, nil
	}
	return nil, err
}
