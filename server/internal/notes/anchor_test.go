package notes

import "testing"

// TestAnchoringAPassageAgainstAText is the table the whole re-anchoring rests
// on: what the search does with a passage that is there once, missing, there
// twice with different context, and there twice with the same context.
//
// Each case names the text, so a failure says which shape of article broke
// rather than which row of a table did.
func TestAnchoringAPassageAgainstAText(t *testing.T) {
	const article = "Before the passage. The marked passage. After the passage."

	for _, testCase := range []struct {
		name      string
		text      string
		exact     string
		prefix    string
		suffix    string
		hint      int
		want      string
		wantHint  int
		ambiguous bool
	}{
		{
			name:     "a passage that appears once anchors at its offset",
			text:     article,
			exact:    "The marked passage.",
			prefix:   "Before the passage. ",
			suffix:   " After the passage.",
			want:     NotesAnchored,
			wantHint: 20,
		},
		{
			name:   "a passage the text no longer holds is orphaned",
			text:   "A rewritten text without that sentence.",
			exact:  "The marked passage.",
			prefix: "Before the passage. ",
			want:   NotesOrphaned,
		},
		{
			name:     "two occurrences with different context anchor on the matching one",
			text:     "First: the same sentence. Second: the same sentence.",
			exact:    "the same sentence.",
			prefix:   "Second: ",
			want:     NotesAnchored,
			wantHint: 34,
		},
		{
			name:      "two occurrences with identical context are orphaned, not guessed",
			text:      "Same: the same sentence. end. Same: the same sentence. end.",
			exact:     "the same sentence.",
			prefix:    "Same: ",
			suffix:    " end.",
			want:      NotesOrphaned,
			ambiguous: true,
		},
		{
			name:     "two occurrences with identical prefix anchor on the matching suffix",
			text:     "Same: the same sentence. first end. Same: the same sentence. second end.",
			exact:    "the same sentence.",
			prefix:   "Same: ",
			suffix:   " second end.",
			want:     NotesAnchored,
			wantHint: 42,
		},
		{
			name:      "the hint does not break a tie between identical occurrences",
			text:      "Same: the same sentence. end. Same: the same sentence. end.",
			exact:     "the same sentence.",
			prefix:    "Same: ",
			suffix:    " end.",
			hint:      7,
			want:      NotesOrphaned,
			ambiguous: true,
		},
		{
			name:     "whitespace that differs on both sides still anchors",
			text:     "Before the passage.\n\n   The passage\tmarked.\nAfter the passage.",
			exact:    "The  passage   marked.",
			prefix:   "Before the passage.\n",
			suffix:   "\nAfter the passage.",
			want:     NotesAnchored,
			wantHint: 20,
		},
		{
			// The text the server searches separates two paragraphs with a
			// newline; the browser hands the client the same place with
			// nothing in it, so the stored prefix is glued across it.
			name:     "a prefix glued across a paragraph boundary still anchors",
			text:     "End of the first.\n\nStart of the second with the marked passage here.",
			exact:    "the marked passage",
			prefix:   "End of the first.Start of the second with ",
			suffix:   " here.",
			want:     NotesAnchored,
			wantHint: 43,
		},
		{
			name:     "a suffix glued across a paragraph boundary still anchors",
			text:     "The marked passage closes the first.\n\nStart of the second.",
			exact:    "The marked passage",
			prefix:   "",
			suffix:   " closes the first.Start of the second.",
			want:     NotesAnchored,
			wantHint: 0,
		},
		{
			name:     "a context spanning a heading still anchors",
			text:     "End of the introduction.\n\nA section\n\nThe marked passage opens the section.",
			exact:    "The marked passage",
			prefix:   "End of the introduction.A section",
			suffix:   " opens the section.",
			want:     NotesAnchored,
			wantHint: 35,
		},
		{
			// Dropping the whitespace must not drop the words with it: a
			// passage wrapped in the same context twice stays ambiguous.
			name:      "two occurrences with identical glued context are still orphaned",
			text:      "Same: the same sentence.\n\nend.\n\nSame: the same sentence.\n\nend.",
			exact:     "the same sentence.",
			prefix:    "Same:",
			suffix:    "end.",
			want:      NotesOrphaned,
			ambiguous: true,
		},
		{
			name:   "a passage absent from the text is orphaned without being ambiguous",
			text:   "End of the first.\n\nStart of the second.",
			exact:  "the marked passage",
			prefix: "End of the first.Start",
			suffix: " of the second.",
			want:   NotesOrphaned,
		},
		{
			// The glued spelling must not become the only one that works: a
			// context captured with the boundary spelled out anchors too.
			name:     "a prefix spelling the boundary with a space still anchors",
			text:     "End of the first.\n\nStart of the second with the marked passage here.",
			exact:    "the marked passage",
			prefix:   "End of the first. Start of the second with ",
			suffix:   " here.",
			want:     NotesAnchored,
			wantHint: 43,
		},
		{
			name:     "non-BMP characters in the context are counted as one code point each",
			text:     "Start 𝄞𝄢 the marked passage 𝄞𝄢 end.",
			exact:    "the marked passage",
			prefix:   "Start 𝄞𝄢 ",
			suffix:   " 𝄞𝄢 end.",
			want:     NotesAnchored,
			wantHint: 9,
		},
		{
			name:   "an empty passage anchors nothing",
			text:   article,
			exact:  "   ",
			prefix: "Before the passage. ",
			want:   NotesOrphaned,
		},
		{
			name:  "a passage in an item with no text at all is orphaned",
			text:  "",
			exact: "The marked passage.",
			want:  NotesOrphaned,
		},
		{
			name:     "a passage at the very start anchors on the context it does have",
			text:     "The marked passage. After the passage.",
			exact:    "The marked passage.",
			prefix:   "none of that was before",
			suffix:   " After the passage.",
			want:     NotesAnchored,
			wantHint: 0,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			result := notesAnchor(testCase.text, testCase.exact, testCase.prefix, testCase.suffix, testCase.hint)
			if result.Status != testCase.want {
				t.Fatalf("status %q, want %q", result.Status, testCase.want)
			}
			if result.Status == NotesAnchored && result.Hint != testCase.wantHint {
				t.Fatalf("hint %d, want %d", result.Hint, testCase.wantHint)
			}
			if result.Ambiguous != testCase.ambiguous {
				t.Fatalf("ambiguous %v, want %v", result.Ambiguous, testCase.ambiguous)
			}
		})
	}
}

// TestTheHintOrdersTheSearchWithoutDecidingIt pins the one thing the hint is
// for: with two occurrences the context can tell apart, the answer is the same
// whichever occurrence the hint is sitting on.
func TestTheHintOrdersTheSearchWithoutDecidingIt(t *testing.T) {
	const text = "First: the same sentence. Second: the same sentence."
	for _, hint := range []int{0, 7, 40, 999} {
		result := notesAnchor(text, "the same sentence.", "First: ", "", hint)
		if result.Status != NotesAnchored || result.Hint != 7 {
			t.Fatalf("hint %d gave %q at %d, want anchored at 7", hint, result.Status, result.Hint)
		}
	}
}

// TestAnchoringIsIdempotent is what makes replaying the re-anchor job after a
// crash harmless: the second search of the same text reaches the same answer
// from the hint the first one wrote.
func TestAnchoringIsIdempotent(t *testing.T) {
	const text = "Before. The marked passage. After."
	first := notesAnchor(text, "The marked passage.", "Before. ", " After.", 0)
	second := notesAnchor(text, "The marked passage.", "Before. ", " After.", first.Hint)
	if first != second {
		t.Fatalf("the second pass answered %+v, the first %+v", second, first)
	}
}

// TestTrimmingTheStoredContext proves the server bounds what a client sends:
// two readers capturing different amounts of context must store contexts that
// can be compared to each other.
func TestTrimmingTheStoredContext(t *testing.T) {
	long := ""
	for range 10 {
		long += "0123456789"
	}
	prefix := notesTrimContext(long, true)
	if len([]rune(prefix)) != notesContextRunes {
		t.Fatalf("the prefix kept %d code points, want %d", len([]rune(prefix)), notesContextRunes)
	}
	if want := long[len(long)-notesContextRunes:]; prefix != want {
		t.Fatalf("the prefix kept %q, want the last %d of the input", prefix, notesContextRunes)
	}
	suffix := notesTrimContext(long, false)
	if want := long[:notesContextRunes]; suffix != want {
		t.Fatalf("the suffix kept %q, want the first %d of the input", suffix, notesContextRunes)
	}
}
