package core_test

import (
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

func TestFormatTimeWritesTheFixedWidthUTCForm(t *testing.T) {
	// Deliberately not UTC to start with: every timestamp Norte stores is UTC,
	// whatever zone the value arrived in.
	saoPaulo := time.FixedZone("-03", -3*60*60)
	instant := time.Date(2026, 3, 9, 14, 5, 6, 123_000_000, saoPaulo)

	const want = "2026-03-09T17:05:06.123Z"
	if got := core.FormatTime(instant); got != want {
		t.Errorf("FormatTime(%s) = %q, want %q", instant, got, want)
	}
}

func TestFormatTimeTruncatesBelowTheMillisecond(t *testing.T) {
	// Truncation, not rounding: rounding would move a timestamp past an event
	// that really happened after it, and the whole schema orders rows by this
	// string.
	instant := time.Date(2026, 3, 9, 17, 5, 6, 123_999_999, time.UTC)

	const want = "2026-03-09T17:05:06.123Z"
	if got := core.FormatTime(instant); got != want {
		t.Errorf("FormatTime(%s) = %q, want %q", instant, got, want)
	}
}

func TestParseTimeRoundTripsAMillisecondPreciseInstant(t *testing.T) {
	want := time.Date(2026, 3, 9, 17, 5, 6, 123_000_000, time.UTC)

	got, err := core.ParseTime(core.FormatTime(want))
	if err != nil {
		t.Fatalf("ParseTime(FormatTime(%s)): %v", want, err)
	}
	if !got.Equal(want) {
		t.Errorf("round trip of %s gave %s", want, got)
	}
	if got.Nanosecond() != want.Nanosecond() {
		t.Errorf("round trip lost the fraction: %d ns, want %d ns", got.Nanosecond(), want.Nanosecond())
	}
	if got.Location() != time.UTC {
		t.Errorf("round trip gave location %s, want UTC", got.Location())
	}
}

// TestParseTimeRejectsEverySpellingButItsOwn guards the ordering property. A row
// holding a timestamp in any of these forms would compare wrongly against the
// rest, and a parser that accepted one is how such a row gets written.
func TestParseTimeRejectsEverySpellingButItsOwn(t *testing.T) {
	for _, value := range []string{
		"2026-03-09T17:05:06Z",          // no fraction
		"2026-03-09T17:05:06.1Z",        // one digit of fraction
		"2026-03-09T17:05:06.123456Z",   // microseconds
		"2026-03-09T14:05:06.123-03:00", // an offset instead of Z
		"2026-03-09 17:05:06.123Z",      // a space instead of T
		"2026-03-09T17:05:06.123",       // no zone marker at all
		"",
	} {
		if parsed, err := core.ParseTime(value); err == nil {
			t.Errorf("ParseTime(%q) = %s, want an error", value, parsed)
		}
	}
}

// TestFormattedTimesCompareLexicallyAsInstants is why the format is fixed width:
// SQLite comparing two of these TEXT values compares the instants, so an index
// on created_at orders rows by time and a cutoff in a WHERE clause is a string
// comparison.
func TestFormattedTimesCompareLexicallyAsInstants(t *testing.T) {
	instants := []time.Time{
		time.Date(2025, 12, 31, 23, 59, 59, 999_000_000, time.UTC),
		time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 1, 0, 0, 0, 1_000_000, time.UTC),
		time.Date(2026, 1, 1, 0, 0, 1, 0, time.UTC),
		time.Date(2026, 1, 1, 0, 1, 0, 0, time.UTC),
		time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	for i := 1; i < len(instants); i++ {
		earlier, later := instants[i-1], instants[i]
		if !later.After(earlier) {
			t.Fatalf("the test's own data is out of order: %s is not after %s", later, earlier)
		}
		if core.FormatTime(later) <= core.FormatTime(earlier) {
			t.Errorf("%q does not sort after %q, but %s is after %s",
				core.FormatTime(later), core.FormatTime(earlier), later, earlier)
		}
	}
}
