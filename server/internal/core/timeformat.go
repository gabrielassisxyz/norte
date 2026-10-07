package core

import (
	"fmt"
	"time"
)

// TimeLayout is the one way Norte writes a timestamp: UTC, millisecond
// precision, fixed width.
//
// Fixed width is the whole point. Every stored timestamp is the same 24
// characters, so SQLite comparing two of them as text compares them as instants,
// an index on created_at orders rows by time, and a cutoff in a WHERE clause is
// a plain string comparison. A timestamp written any other way — a different
// precision, a numeric offset instead of Z, local time — sorts wrongly against
// the rest, which is why ParseTime refuses to read one.
const TimeLayout = "2006-01-02T15:04:05.000Z"

// FormatTime renders t the only way Norte stores an instant. Sub-millisecond
// precision is truncated, not rounded, so formatting never moves a timestamp
// forward past an event that happened after it.
func FormatTime(t time.Time) string {
	return t.UTC().Format(TimeLayout)
}

// ParseTime reads a timestamp written by FormatTime, and nothing else.
func ParseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(TimeLayout, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%q is not a Norte timestamp (want %s): %w", value, TimeLayout, err)
	}
	return parsed, nil
}
