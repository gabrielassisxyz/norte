package core_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// canonicalUUIDv7 is the shape RFC 9562 gives a version 7 UUID in text: eight
// hex digits, three groups of four with the version nibble opening the third and
// the variant bits opening the fourth, then twelve.
var canonicalUUIDv7 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNewIDIsALowercaseVersion7UUID(t *testing.T) {
	id := core.NewID()
	if len(id) != core.IDLength {
		t.Fatalf("NewID() = %q, %d characters long, want %d", id, len(id), core.IDLength)
	}
	if id != strings.ToLower(id) {
		t.Errorf("NewID() = %q, want it lowercase: a mixed-case id compares unequal to its own spelling", id)
	}
	if version := id[14]; version != '7' {
		t.Errorf("NewID() = %q, version nibble %q, want '7'", id, version)
	}
	if !canonicalUUIDv7.MatchString(id) {
		t.Errorf("NewID() = %q, want it to match %s", id, canonicalUUIDv7)
	}
}

// TestIDsGeneratedInSequenceSortLexicallyInThatOrder is the property the choice
// of version 7 was made for. A thousand ids in a row take well under a
// millisecond, so this is specifically the case the timestamp alone does not
// order: without a counter below the millisecond, ids minted inside one tick
// come back in random order and inserts scatter through the B-tree.
func TestIDsGeneratedInSequenceSortLexicallyInThatOrder(t *testing.T) {
	const count = 1000
	ids := make([]string, count)
	for i := range ids {
		ids[i] = core.NewID()
	}
	for i := 1; i < count; i++ {
		if ids[i] <= ids[i-1] {
			t.Fatalf("id %d (%s) does not sort after id %d (%s)", i, ids[i], i-1, ids[i-1])
		}
	}
}

func TestNewIDNeverRepeats(t *testing.T) {
	const count = 1000
	seen := make(map[string]int, count)
	for i := range count {
		id := core.NewID()
		if first, ok := seen[id]; ok {
			t.Fatalf("NewID() returned %s at both %d and %d", id, first, i)
		}
		seen[id] = i
	}
}
