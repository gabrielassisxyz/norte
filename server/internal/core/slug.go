package core

import (
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Slugify derives the stable, typeable form of a name: lowercase, accents
// stripped, punctuation dropped, runs of anything else collapsed to one
// hyphen.
//
// It is the only normalisation a subject gets. The subject table stores the
// slug and nothing else normalised, so the slug is also what a search matches
// against -- which is how "programacao" finds "Programação" with no unaccent
// function in SQLite and no second copy of the name in the schema.
func Slugify(name string) string {
	folded := strings.ToLower(strings.TrimSpace(name))
	// NFD splits an accented rune into its letter and its combining mark, so
	// dropping the marks leaves the letter behind rather than the whole rune.
	stripped, _, err := transform.String(
		transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), folded)
	if err != nil {
		stripped = folded
	}
	var out strings.Builder
	pendingHyphen := false
	for _, r := range stripped {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			if pendingHyphen && out.Len() > 0 {
				out.WriteByte('-')
			}
			pendingHyphen = false
			out.WriteRune(unicode.ToLower(r))
		default:
			// Punctuation and whitespace alike only ever become a separator,
			// and only when a letter follows: that is what keeps a trailing
			// "?" or a double space from leaving a hyphen at the edge.
			pendingHyphen = true
		}
	}
	return out.String()
}
