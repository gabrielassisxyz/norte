package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	coreapi "github.com/gabrielassisxyz/norte/server/gen/api/core"
	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// testOnlyBodyMaxBytes is small enough that a test can exceed it in one line
// and large enough that the valid bodies below fit.
const testOnlyBodyMaxBytes = "256"

// testOnlyRoute is the POST route of testdata/testonly.yaml.
const testOnlyRoute = "/api/core/test-notes"

// testOnlyHandler mounts the test-only contract behind the same validator, the
// same error handler and the same middleware chain production uses, so what
// these cases prove about the envelope is true of every real route too.
func testOnlyHandler(t *testing.T) http.Handler {
	t.Helper()
	cfg, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_BODY_MAX_BYTES": testOnlyBodyMaxBytes}),
		Home: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	loader := openapi3.NewLoader()
	spec, err := loader.LoadFromFile("testdata/testonly.yaml")
	if err != nil {
		t.Fatalf("loading the test-only contract: %v", err)
	}
	if err := spec.Validate(context.Background()); err != nil {
		t.Fatalf("the test-only contract is not a valid OpenAPI document: %v", err)
	}

	// The handler is reached only when the validator let the request through,
	// so echoing the body back is enough to tell "accepted" from "rejected".
	accepted := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, readErr := io.ReadAll(r.Body)
		if readErr != nil {
			core.WriteJSONError(w, r, http.StatusBadRequest, "invalid_request", "unreadable body")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(body)
	})

	mux := http.NewServeMux()
	mux.Handle("POST "+testOnlyRoute, newContractValidator(spec)(accepted))
	return withStandardMiddleware(RouterOptions{
		Config: cfg,
		Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	}, mux)
}

// postTestNote sends one request at the test-only route with an allowed Host.
func postTestNote(t *testing.T, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, testOnlyRoute, strings.NewReader(body))
	request.Host = "localhost:8080"
	request.Header.Set("Content-Type", contentType)
	recorder := httptest.NewRecorder()
	testOnlyHandler(t).ServeHTTP(recorder, request)
	return recorder
}

// decodeErrorEnvelope asserts the response is the one error shape the API
// returns, and hands back its detail for the per-case assertions.
func decodeErrorEnvelope(t *testing.T, response *httptest.ResponseRecorder, wantStatus int) core.ErrorDetail {
	t.Helper()
	if response.Code != wantStatus {
		t.Fatalf("status = %d, want %d (body %q)", response.Code, wantStatus, response.Body.String())
	}
	var envelope core.ErrorBody
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("body is not the error envelope: %v (%q)", err, response.Body.String())
	}
	if envelope.Error.Code == "" {
		t.Errorf("code is empty, want a machine-readable reason (body %q)", response.Body.String())
	}
	if envelope.Error.Message == "" {
		t.Errorf("message is empty (body %q)", response.Body.String())
	}
	if envelope.Error.RequestID == "" {
		t.Errorf("request_id is empty, so this failure cannot be matched to a log line")
	}
	if strings.ContainsAny(envelope.Error.Message, "\n\r") {
		t.Errorf("message spans more than one line: %q", envelope.Error.Message)
	}
	return envelope.Error
}

func TestABodyMatchingTheContractReachesTheHandler(t *testing.T) {
	response := postTestNote(t, "application/json", `{"title":"a","kind":"note"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body %q)", response.Code, response.Body.String())
	}
}

func TestAFieldTheContractDoesNotNameIsRejected(t *testing.T) {
	response := postTestNote(t, "application/json", `{"title":"a","kind":"note","colour":"red"}`)
	detail := decodeErrorEnvelope(t, response, http.StatusBadRequest)
	if !strings.Contains(detail.Message, "colour") {
		t.Errorf("message = %q, want it to name the unsupported property", detail.Message)
	}
}

func TestMalformedJSONIsRejected(t *testing.T) {
	response := postTestNote(t, "application/json", `{"title":"a","kind":`)
	detail := decodeErrorEnvelope(t, response, http.StatusBadRequest)
	if detail.Code != "invalid_json" {
		t.Errorf("code = %q, want invalid_json", detail.Code)
	}
}

func TestAValueOutsideAnEnumIsRejectedAndNamesTheField(t *testing.T) {
	response := postTestNote(t, "application/json", `{"title":"a","kind":"sketch"}`)
	detail := decodeErrorEnvelope(t, response, http.StatusBadRequest)
	if detail.Field != "kind" {
		t.Errorf("field = %q, want kind", detail.Field)
	}
}

func TestABodyOverTheConfiguredCapIsRejected(t *testing.T) {
	oversized := `{"title":"` + strings.Repeat("x", 512) + `","kind":"note"}`
	response := postTestNote(t, "application/json", oversized)
	detail := decodeErrorEnvelope(t, response, http.StatusRequestEntityTooLarge)
	if detail.Code != "body_too_large" {
		t.Errorf("code = %q, want body_too_large", detail.Code)
	}
}

func TestContentTypeThatTheContractDoesNotDeclare(t *testing.T) {
	response := postTestNote(t, "text/plain", `{"title":"a","kind":"note"}`)
	detail := decodeErrorEnvelope(t, response, http.StatusUnsupportedMediaType)
	if detail.Code != "unsupported_media_type" {
		t.Errorf("code = %q, want unsupported_media_type", detail.Code)
	}
}

// TestTheErrorEnvelopeMatchesTheContract decodes a real failure into the type
// generated from core.yaml. It is what makes the contract's Error schema
// load-bearing: rename a field there and the generated struct stops matching
// what core writes, which shows up here as an empty field rather than as a
// mismatch nobody notices until the frontend reads it.
func TestTheErrorEnvelopeMatchesTheContract(t *testing.T) {
	response := get(t, testRouter(t), "/api/nope")
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.Code)
	}

	var envelope coreapi.Error
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("body does not decode as the contract's Error: %v (%q)", err, response.Body.String())
	}
	if envelope.Error.Code == "" {
		t.Errorf("code is empty, so the contract's `code` does not match what the server writes")
	}
	if envelope.Error.Message == "" {
		t.Errorf("message is empty, so the contract's `message` does not match what the server writes")
	}
	if envelope.Error.RequestId == "" {
		t.Errorf("request_id is empty, so the contract's `request_id` does not match what the server writes")
	}
	if envelope.Error.Field != nil {
		t.Errorf("field = %q, want it absent on a failure attributable to no input", *envelope.Error.Field)
	}
}
