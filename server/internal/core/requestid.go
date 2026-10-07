package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
)

type requestIDContextKey struct{}

// RequestIDHeader is read from the client when present and always echoed back.
const RequestIDHeader = "X-Request-Id"

// NewRequestID generates the id used when the client sent none.
func NewRequestID() string {
	var raw [8]byte
	// rand.Read never fails as of Go 1.24; it panics internally instead.
	_, _ = rand.Read(raw[:])
	return hex.EncodeToString(raw[:])
}

// ContextWithRequestID stores the id so handlers, error bodies and log lines all
// quote the same one.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDContextKey{}, id)
}

// RequestIDFromContext returns the stored id, or "" outside a served request.
func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDContextKey{}).(string)
	return id
}
