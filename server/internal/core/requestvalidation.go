package core

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
)

// This is the one mapping from a contract rejection to Norte's error envelope.
// It lives here rather than beside any one module's handlers because every
// module mounts its generated routes behind the same validator and owes a
// client the same answer; it was written out once per module before, and a
// correction then had to be made in three places to be true anywhere.

// These two reasons are the only way to tell a wrong content type and an
// unparseable body apart from a schema violation: the validator reports all
// three as one *openapi3filter.RequestError and does not export the strings it
// builds them with. The version they come from is pinned by server/go.mod, and
// a rename there surfaces as the content-type case answering 400 instead of
// 415, which is what TestContentTypeThatTheContractDoesNotDeclare asserts.
const (
	validatorUnexpectedContentTypeReason = "header Content-Type has unexpected value"
	validatorUndecodableBodyReason       = "failed to decode request body"
)

// The shape kin-openapi builds for a body property the contract never named.
// That case is the one schema violation it leaves the JSON pointer empty for,
// and it names the offending key nowhere else, so the key is read back out of
// the reason it wrote.
const (
	unsupportedPropertyPrefix = `property "`
	unsupportedPropertySuffix = `" is unsupported`
)

// ContractValidationFailure is what one rejected request maps onto: the status
// to answer, the code a client branches on, the input the failure is
// attributable to when it is attributable to exactly one, and the single line
// a screen may show.
type ContractValidationFailure struct {
	Status  int
	Code    string
	Field   string
	Message string
}

// WriteContractValidationError answers a request the contract rejected, in the
// same envelope a domain failure comes back in, so a client parses one shape.
// Its signature is the one nethttpmiddleware.Options.ErrorHandlerWithOpts
// takes, so every module's validator passes it unchanged.
func WriteContractValidationError(
	_ context.Context,
	err error,
	w http.ResponseWriter,
	r *http.Request,
	opts nethttpmiddleware.ErrorHandlerOpts,
) {
	failure := classifyContractValidation(err, opts.StatusCode)
	WriteJSONFieldError(w, r, failure.Status, failure.Code, failure.Message, failure.Field)
}

// WriteRequestDecodeError answers a request the generated router could not
// decode -- a path or query parameter of the wrong type, before any contract
// validation gets a say.
func WriteRequestDecodeError(w http.ResponseWriter, r *http.Request, err error) {
	WriteJSONError(w, r, http.StatusBadRequest, "invalid_request", singleLineMessage(err.Error()))
}

// classifyContractValidation picks the status, the code, the offending field
// and the message for one validation failure.
func classifyContractValidation(err error, suggested int) ContractValidationFailure {
	status, code, field := classifyContractValidationStatus(err, suggested)
	return ContractValidationFailure{
		Status:  status,
		Code:    code,
		Field:   field,
		Message: contractValidationMessage(err),
	}
}

// classifyContractValidationStatus picks the status and the code. The
// validator suggests 400 for every bad request, so the cases that are not one
// -- a content type the contract does not declare, a body past the cap -- are
// recognised from the error itself rather than from its suggestion.
func classifyContractValidationStatus(err error, suggested int) (status int, code, field string) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge, "body_too_large", ""
	}

	var requestErr *openapi3filter.RequestError
	if errors.As(err, &requestErr) {
		return classifyContractRequestError(requestErr)
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

func classifyContractRequestError(requestErr *openapi3filter.RequestError) (status int, code, field string) {
	if requestErr.RequestBody != nil && strings.HasPrefix(requestErr.Reason, validatorUnexpectedContentTypeReason) {
		return http.StatusUnsupportedMediaType, "unsupported_media_type", ""
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(requestErr.Err, &schemaErr) {
		return http.StatusBadRequest, "invalid_request", contractSchemaErrorField(schemaErr, requestErr.Parameter)
	}

	if requestErr.Reason == validatorUndecodableBodyReason {
		return http.StatusBadRequest, "invalid_json", ""
	}
	if requestErr.Parameter != nil {
		return http.StatusBadRequest, "invalid_request", requestErr.Parameter.Name
	}
	return http.StatusBadRequest, "invalid_request", ""
}

// contractSchemaErrorField names the one input a schema violation is about.
// Three different places hold that name and only one of them is the JSON
// pointer: a query or path parameter has no pointer at all and is named by the
// parameter the validator was checking, and a property the contract never
// named is identified only in the reason the validator wrote.
func contractSchemaErrorField(schemaErr *openapi3.SchemaError, parameter *openapi3.Parameter) string {
	pointer := schemaErr.JSONPointer()
	if unsupported := unsupportedPropertyName(schemaErr.Reason); unsupported != "" {
		return strings.Join(append(pointer, unsupported), ".")
	}
	if at := strings.Join(pointer, "."); at != "" {
		return at
	}
	if parameter != nil {
		return parameter.Name
	}
	return ""
}

func unsupportedPropertyName(reason string) string {
	if !strings.HasPrefix(reason, unsupportedPropertyPrefix) ||
		!strings.HasSuffix(reason, unsupportedPropertySuffix) {
		return ""
	}
	return reason[len(unsupportedPropertyPrefix) : len(reason)-len(unsupportedPropertySuffix)]
}

// contractValidationMessage keeps the envelope's message to one readable line.
// The validator's own Error() embeds the offending schema and the value it
// rejected across several lines, which belongs in a log and not in a JSON
// field a screen may show.
func contractValidationMessage(err error) string {
	var requestErr *openapi3filter.RequestError
	isRequestErr := errors.As(err, &requestErr)
	if isRequestErr && requestErr.RequestBody != nil &&
		errors.Is(requestErr.Err, openapi3filter.ErrInvalidRequired) {
		// The validator reports this one with no reason at all, so the
		// generic path below would answer with a bare cause. The endpoint
		// declared the body required, which is the sentence a person needs.
		return "request body is required"
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		if at := strings.Join(schemaErr.JSONPointer(), "."); at != "" {
			return fmt.Sprintf("%s: %s", at, singleLineMessage(schemaErr.Reason))
		}
		return singleLineMessage(schemaErr.Reason)
	}

	if isRequestErr {
		return singleLineMessage(joinReasonAndCause(requestErr))
	}
	return singleLineMessage(err.Error())
}

// joinReasonAndCause puts a RequestError's reason and its cause on one line
// without the empty or duplicated halves the validator leaves behind: some
// failures carry a cause and no reason, and a missing parameter carries the
// same sentence as both.
func joinReasonAndCause(requestErr *openapi3filter.RequestError) string {
	cause := ""
	if requestErr.Err != nil {
		cause = requestErr.Err.Error()
	}
	switch {
	case requestErr.Reason == "":
		return cause
	case cause == "" || cause == requestErr.Reason:
		return requestErr.Reason
	default:
		return requestErr.Reason + ": " + cause
	}
}

func singleLineMessage(message string) string {
	return strings.Join(strings.Fields(message), " ")
}
