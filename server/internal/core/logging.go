// Package core holds the HTTP and logging helpers every Norte module shares.
package core

import (
	"fmt"
	"io"
	"log/slog"
)

// NewLogger builds the JSON logger the whole program writes through. Logs go to
// stderr so that stdout stays usable for command output such as `norte config`.
func NewLogger(level string, w io.Writer) (*slog.Logger, error) {
	parsed, err := ParseLogLevel(level)
	if err != nil {
		return nil, err
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: parsed})), nil
}

// ParseLogLevel maps a NORTE_LOG_LEVEL value onto a slog level.
func ParseLogLevel(level string) (slog.Level, error) {
	switch level {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("unknown log level %q: want debug, info, warn or error", level)
	}
}
