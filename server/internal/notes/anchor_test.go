package notes

import "testing"

// TestAnchoringAPassageAgainstAText is the table the whole re-anchoring rests
// on: what the search does with a passage that is there once, missing, there
// twice with different context, and there twice with the same context.
//
// Each case names the text, so a failure says which shape of article broke
// rather than which row of a table did.
func TestAnchoringAPassageAgainstAText(t *testing.T) {
	const article = "Antes do trecho. O trecho marcado. Depois do trecho."

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
			exact:    "O trecho marcado.",
			prefix:   "Antes do trecho. ",
			suffix:   " Depois do trecho.",
			want:     NotesAnchored,
			wantHint: 17,
		},
		{
			name:   "a passage the text no longer holds is orphaned",
			text:   "Um texto reescrito sem aquela frase.",
			exact:  "O trecho marcado.",
			prefix: "Antes do trecho. ",
			want:   NotesOrphaned,
		},
		{
			name:     "two occurrences with different context anchor on the matching one",
			text:     "Primeiro: a mesma frase. Segundo: a mesma frase.",
			exact:    "a mesma frase.",
			prefix:   "Segundo: ",
			want:     NotesAnchored,
			wantHint: 34,
		},
		{
			name:      "two occurrences with identical context are orphaned, not guessed",
			text:      "Igual: a mesma frase. fim. Igual: a mesma frase. fim.",
			exact:     "a mesma frase.",
			prefix:    "Igual: ",
			suffix:    " fim.",
			want:      NotesOrphaned,
			ambiguous: true,
		},
		{
			name:     "two occurrences with identical prefix anchor on the matching suffix",
			text:     "Igual: a mesma frase. primeiro fim. Igual: a mesma frase. segundo fim.",
			exact:    "a mesma frase.",
			prefix:   "Igual: ",
			suffix:   " segundo fim.",
			want:     NotesAnchored,
			wantHint: 43,
		},
		{
			name:      "the hint does not break a tie between identical occurrences",
			text:      "Igual: a mesma frase. fim. Igual: a mesma frase. fim.",
			exact:     "a mesma frase.",
			prefix:    "Igual: ",
			suffix:    " fim.",
			hint:      7,
			want:      NotesOrphaned,
			ambiguous: true,
		},
		{
			name:     "whitespace that differs on both sides still anchors",
			text:     "Antes do trecho.\n\n   O trecho\tmarcado.\nDepois do trecho.",
			exact:    "O  trecho   marcado.",
			prefix:   "Antes do trecho.\n",
			suffix:   "\nDepois do trecho.",
			want:     NotesAnchored,
			wantHint: 17,
		},
		{
			// The text the server searches separates two paragraphs with a
			// newline; the browser hands the client the same place with
			// nothing in it, so the stored prefix is glued across it.
			name:     "a prefix glued across a paragraph boundary still anchors",
			text:     "Fim do primeiro.\n\nComeço do segundo com o trecho marcado aqui.",
			exact:    "o trecho marcado",
			prefix:   "Fim do primeiro.Começo do segundo com ",
			suffix:   " aqui.",
			want:     NotesAnchored,
			wantHint: 39,
		},
		{
			name:     "a suffix glued across a paragraph boundary still anchors",
			text:     "O trecho marcado fecha o primeiro.\n\nComeço do segundo.",
			exact:    "O trecho marcado",
			prefix:   "",
			suffix:   " fecha o primeiro.Começo do segundo.",
			want:     NotesAnchored,
			wantHint: 0,
		},
		{
			name:     "a context spanning a heading still anchors",
			text:     "Fim da introdução.\n\nUma seção\n\nO trecho marcado abre a seção.",
			exact:    "O trecho marcado",
			prefix:   "Fim da introdução.Uma seção",
			suffix:   " abre a seção.",
			want:     NotesAnchored,
			wantHint: 29,
		},
		{
			// Dropping the whitespace must not drop the words with it: a
			// passage wrapped in the same context twice stays ambiguous.
			name:      "two occurrences with identical glued context are still orphaned",
			text:      "Igual: a mesma frase.\n\nfim.\n\nIgual: a mesma frase.\n\nfim.",
			exact:     "a mesma frase.",
			prefix:    "Igual:",
			suffix:    "fim.",
			want:      NotesOrphaned,
			ambiguous: true,
		},
		{
			name:   "a passage absent from the text is orphaned without being ambiguous",
			text:   "Fim do primeiro.\n\nComeço do segundo.",
			exact:  "o trecho marcado",
			prefix: "Fim do primeiro.Começo",
			suffix: " do segundo.",
			want:   NotesOrphaned,
		},
		{
			// The glued spelling must not become the only one that works: a
			// context captured with the boundary spelled out anchors too.
			name:     "a prefix spelling the boundary with a space still anchors",
			text:     "Fim do primeiro.\n\nComeço do segundo com o trecho marcado aqui.",
			exact:    "o trecho marcado",
			prefix:   "Fim do primeiro. Começo do segundo com ",
			suffix:   " aqui.",
			want:     NotesAnchored,
			wantHint: 39,
		},
		{
			name:     "non-BMP characters in the context are counted as one code point each",
			text:     "Começo 𝄞𝄢 o trecho marcado 𝄞𝄢 fim.",
			exact:    "o trecho marcado",
			prefix:   "Começo 𝄞𝄢 ",
			suffix:   " 𝄞𝄢 fim.",
			want:     NotesAnchored,
			wantHint: 10,
		},
		{
			name:   "an empty passage anchors nothing",
			text:   article,
			exact:  "   ",
			prefix: "Antes do trecho. ",
			want:   NotesOrphaned,
		},
		{
			name:  "a passage in an item with no text at all is orphaned",
			text:  "",
			exact: "O trecho marcado.",
			want:  NotesOrphaned,
		},
		{
			name:     "a passage at the very start anchors on the context it does have",
			text:     "O trecho marcado. Depois do trecho.",
			exact:    "O trecho marcado.",
			prefix:   "nada disso estava antes",
			suffix:   " Depois do trecho.",
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
	const text = "Primeiro: a mesma frase. Segundo: a mesma frase."
	for _, hint := range []int{0, 10, 33, 999} {
		result := notesAnchor(text, "a mesma frase.", "Primeiro: ", "", hint)
		if result.Status != NotesAnchored || result.Hint != 10 {
			t.Fatalf("hint %d gave %q at %d, want anchored at 10", hint, result.Status, result.Hint)
		}
	}
}

// TestAnchoringIsIdempotent is what makes replaying the re-anchor job after a
// crash harmless: the second search of the same text reaches the same answer
// from the hint the first one wrote.
func TestAnchoringIsIdempotent(t *testing.T) {
	const text = "Antes. O trecho marcado. Depois."
	first := notesAnchor(text, "O trecho marcado.", "Antes. ", " Depois.", 0)
	second := notesAnchor(text, "O trecho marcado.", "Antes. ", " Depois.", first.Hint)
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
