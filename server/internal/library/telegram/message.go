package telegram

import (
	"regexp"
	"strings"
)

// linkPattern finds an http(s) URL inside a message. A URL ends at the first
// space, because that is the only delimiter a person typing into a chat can be
// relied on to produce.
var linkPattern = regexp.MustCompile(`(?i)https?://[^\s]+`)

// linkTrailers are the characters a URL at the end of a sentence collects.
// They are taken off the address and dropped rather than folded back into the
// note: a note reading "." says less than no note at all.
const linkTrailers = `.,;:!?)]}'"»`

// FirstLink reports the first URL of a message and what is left once that URL
// is taken out -- the note saying why the link was kept.
//
// Only the first URL is removed. A message carrying two links saves the first
// and keeps the second in the note, where it stays readable, instead of the
// adapter guessing which of the two the person meant.
func FirstLink(text string) (link, reason string, ok bool) {
	span := linkPattern.FindStringIndex(text)
	if span == nil {
		return "", "", false
	}
	link = strings.TrimRight(text[span[0]:span[1]], linkTrailers)
	if link == "" {
		return "", "", false
	}
	before := strings.TrimSpace(text[:span[0]])
	after := strings.TrimSpace(text[span[1]:])
	switch {
	case before == "":
		reason = after
	case after == "":
		reason = before
	default:
		reason = before + " " + after
	}
	return link, reason, true
}
