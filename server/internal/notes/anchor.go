// Package notes is the notes module: highlights anchored by their text, margin
// annotations, the one freeform note an item carries, questions, and the
// question sets a topic's prompts produce.
package notes

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// notesContextRunes is how much context a highlight keeps on each side, in code
// points. It is what makes two occurrences of the same sentence tellable apart,
// and it is applied to what a client sends rather than trusted from it: two
// clients capturing different amounts would otherwise store contexts that
// cannot be compared to each other.
const notesContextRunes = 32

// notesTrimContext keeps at most notesContextRunes code points of context, from
// the end for a prefix and from the start for a suffix.
func notesTrimContext(value string, fromEnd bool) string {
	runes := []rune(notesNormalizeText(value))
	if len(runes) <= notesContextRunes {
		return string(runes)
	}
	if fromEnd {
		return string(runes[len(runes)-notesContextRunes:])
	}
	return string(runes[:notesContextRunes])
}

// NotesAnchorStatus is where a passage stands against an item's current text.
const (
	NotesAnchored = "anchored"
	NotesOrphaned = "orphaned"
)

// notesAnchorResult is what one search for a passage concluded.
//
// Ambiguous distinguishes the two ways a passage fails to anchor, because the
// reader says different things about them: a passage that is simply gone was
// edited out of the article, while a passage that now appears several times
// with the same words around it is still there and the server refuses to guess
// which one the person meant.
type notesAnchorResult struct {
	Status string
	// Hint is the code-point offset the passage was found at, meaningful only
	// when Status is anchored.
	Hint int
	// Ambiguous is true when the search found several indistinguishable
	// occurrences rather than none.
	Ambiguous bool
}

// notesNormalizeText collapses every run of whitespace into a single space.
//
// It is the same collapsing the library applies to each block of content_text,
// which is what makes a passage comparable to the text it was taken from. The
// paragraph breaks content_text carries are collapsed too, on purpose: a
// selection dragged across a paragraph boundary comes out of the browser with
// whatever whitespace the DOM happened to have there, and a comparison that
// kept it would fail on a passage the person plainly selected.
func notesNormalizeText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

// notesAnchor decides whether exact still sits in text, and where.
//
// The rule is a unique context match and nothing weaker. Every occurrence of
// the passage is found, and an occurrence counts only when the words stored
// before and after it are the words that are before and after it now. Exactly
// one such occurrence anchors the highlight at its offset; zero or several make
// it orphaned.
//
// The hint orders the occurrences -- nearest first -- and never decides. Two
// occurrences wrapped in identical context are indistinguishable whatever the
// hint says, and silently attaching the highlight to the nearer one would move
// a person's mark to words they never read.
func notesAnchor(text, exact, prefix, suffix string, hint int) notesAnchorResult {
	haystack := notesNormalizeText(text)
	needle := notesNormalizeText(exact)
	if needle == "" || haystack == "" {
		return notesAnchorResult{Status: NotesOrphaned}
	}
	occurrences := notesOccurrences(haystack, needle)
	if len(occurrences) == 0 {
		return notesAnchorResult{Status: NotesOrphaned}
	}
	notesOrderByDistance(occurrences, hint)

	runes := []rune(haystack)
	needleLength := len([]rune(needle))
	wantPrefix := []rune(notesNormalizeText(prefix))
	wantSuffix := []rune(notesNormalizeText(suffix))

	matches := make([]int, 0, len(occurrences))
	for _, start := range occurrences {
		if !notesTailMatches(runes[:start], wantPrefix) {
			continue
		}
		if !notesHeadMatches(runes[start+needleLength:], wantSuffix) {
			continue
		}
		matches = append(matches, start)
	}
	switch len(matches) {
	case 1:
		return notesAnchorResult{Status: NotesAnchored, Hint: matches[0]}
	case 0:
		return notesAnchorResult{Status: NotesOrphaned}
	default:
		return notesAnchorResult{Status: NotesOrphaned, Ambiguous: true}
	}
}

// notesOccurrences lists the code-point offsets of every occurrence of needle
// in haystack, overlapping ones included.
//
// The scan walks byte offsets, which is what strings.Index gives, and converts
// each to a code-point offset as it goes. Counting runes once per hit instead
// would re-walk the article for every occurrence.
func notesOccurrences(haystack, needle string) []int {
	offsets := []int{}
	searchedBytes := 0
	searchedRunes := 0
	for {
		found := strings.Index(haystack[searchedBytes:], needle)
		if found < 0 {
			return offsets
		}
		absolute := searchedBytes + found
		searchedRunes += len([]rune(haystack[searchedBytes:absolute]))
		offsets = append(offsets, searchedRunes)
		// Advance by one code point rather than by the whole needle, so a
		// passage that overlaps itself ("aa" in "aaa") is counted twice and
		// the ambiguity is reported rather than hidden.
		_, width := utf8.DecodeRuneInString(haystack[absolute:])
		searchedBytes = absolute + width
		searchedRunes++
	}
}

// notesOrderByDistance sorts offsets by how far they are from the hint, so the
// occurrence the highlight was last anchored at is examined first. It is a
// stable insertion sort because the slice holds a handful of offsets at most.
func notesOrderByDistance(offsets []int, hint int) {
	for i := 1; i < len(offsets); i++ {
		for j := i; j > 0 && notesDistance(offsets[j], hint) < notesDistance(offsets[j-1], hint); j-- {
			offsets[j], offsets[j-1] = offsets[j-1], offsets[j]
		}
	}
}

func notesDistance(offset, hint int) int {
	if offset >= hint {
		return offset - hint
	}
	return hint - offset
}

// notesDropContextWhitespace removes every whitespace code point, which is how
// the two sides of a context comparison are made comparable.
//
// A client reads its context off the DOM, where adjacent blocks are separated
// by the markup and by nothing in the text: a selection taken just after a
// paragraph break comes back as "navegacao.Uma frase", while the extracted text
// the server searches separates those blocks with a newline and reads
// "navegacao. Uma frase". Neither spelling is wrong, and there is no spelling
// both sides can agree on, so the comparison stops looking at whitespace
// altogether rather than at a particular rendering of it.
//
// It cannot turn a wrong occurrence into a match: the passage itself must still
// occur in the text, and the context only chooses among the occurrences that
// were found.
func notesDropContextWhitespace(value []rune) []rune {
	kept := make([]rune, 0, len(value))
	for _, candidate := range value {
		if unicode.IsSpace(candidate) {
			continue
		}
		kept = append(kept, candidate)
	}
	return kept
}

// notesTailMatches reports whether want is what comes immediately before a
// passage, whitespace aside.
//
// Only the overlap is compared. A passage near the top of an article has fewer
// code points before it than the client captured, and an extraction that
// dropped a leading paragraph leaves fewer still; demanding the whole stored
// prefix would orphan a highlight whose own words never moved.
func notesTailMatches(before, want []rune) bool {
	text := notesDropContextWhitespace(before)
	stored := notesDropContextWhitespace(want)
	overlap := min(len(text), len(stored))
	if overlap == 0 {
		return true
	}
	return string(text[len(text)-overlap:]) == string(stored[len(stored)-overlap:])
}

// notesHeadMatches is notesTailMatches for what comes immediately after.
func notesHeadMatches(after, want []rune) bool {
	text := notesDropContextWhitespace(after)
	stored := notesDropContextWhitespace(want)
	overlap := min(len(text), len(stored))
	if overlap == 0 {
		return true
	}
	return string(text[:overlap]) == string(stored[:overlap])
}
