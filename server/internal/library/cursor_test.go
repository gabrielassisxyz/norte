package library

import (
	"testing"
)

func TestLibraryCursorRoundTrips(t *testing.T) {
	cursor := libraryCursor{
		Sort:       LibrarySortSavedDesc,
		FilterHash: "abc",
		Primary:    "2026-10-07T21:00:00.000Z",
		ID:         "some-id",
	}
	encoded := libraryEncodeCursor(cursor)
	if encoded == "" {
		t.Fatal("the cursor encoded to nothing")
	}
	decoded, err := libraryDecodeCursor(encoded)
	if err != nil {
		t.Fatalf("decoding the cursor: %v", err)
	}
	if decoded.V != libraryCursorVersion || decoded.Sort != cursor.Sort ||
		decoded.FilterHash != cursor.FilterHash || decoded.Primary != cursor.Primary ||
		decoded.ID != cursor.ID {
		t.Errorf("the cursor did not round-trip: %#v", decoded)
	}
}

func TestLibraryCursorRankRoundTrips(t *testing.T) {
	cursor := libraryCursor{Sort: "rank", FilterHash: "abc", Rank: -3.75, HasRank: true, ID: "some-id"}
	decoded, err := libraryDecodeCursor(libraryEncodeCursor(cursor))
	if err != nil {
		t.Fatalf("decoding the cursor: %v", err)
	}
	if decoded.Rank != cursor.Rank || !decoded.HasRank {
		t.Errorf("the rank did not round-trip: %#v", decoded)
	}
}

func TestLibraryCursorRefusesGarbage(t *testing.T) {
	for name, raw := range map[string]string{
		"not base64":    "!!!",
		"not JSON":      "bm90LWpzb24",
		"unknown shape": libraryEncodeCursor(libraryCursor{}),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := libraryDecodeCursor(raw); err == nil {
				t.Errorf("decoding %q succeeded, want a refusal", raw)
			}
		})
	}
}

func TestLibrarySearchTermsQuoteAndJoin(t *testing.T) {
	matched, err := librarySearchTerms("zebra stripes")
	if err != nil {
		t.Fatalf("search terms: %v", err)
	}
	if matched != `"zebra" AND "stripes"` {
		t.Errorf("terms = %q, want two quoted terms joined by AND", matched)
	}
	if _, err := librarySearchTerms("... !!!"); err == nil {
		t.Error("a query with no word in it was accepted, want a refusal")
	}
}
