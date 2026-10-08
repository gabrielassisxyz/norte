package library

import (
	"regexp"

	"github.com/microcosm-cc/bluemonday"
)

// libraryAnchorIDPattern is the only shape an id may have in stored content.
// Every id the extractor writes is a heading anchor and matches it; a page's own
// id never does, because the slugger produces nothing else.
var libraryAnchorIDPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

// libraryInlineStyleProperties are the style declarations stored content may
// carry. The reader and the design system lay out an article with inline
// styles, so the attribute has to survive; a property allowlist is what keeps
// that from also admitting a url() or a position: fixed overlay.
//
// bluemonday only sanitizes the style attribute when at least one style policy
// is declared, and passes it through untouched otherwise. Allowing the
// attribute without this list would therefore allow any CSS at all, which is
// the opposite of what it looks like.
var libraryInlineStyleProperties = []string{
	"background-color", "border", "border-bottom", "border-collapse", "border-left",
	"border-radius", "border-right", "border-top", "color", "font-family",
	"font-size", "font-style", "font-variant", "font-weight", "height",
	"letter-spacing", "line-height", "list-style-type", "margin", "margin-bottom",
	"margin-left", "margin-right", "margin-top", "max-width", "padding",
	"padding-bottom", "padding-left", "padding-right", "padding-top",
	"text-align", "text-decoration", "text-transform", "vertical-align",
	"white-space", "width", "word-break",
}

// libraryExtractPolicy is the allowlist stored content is sanitized with.
//
// Sanitizing happens once, here, on the way into the database. Every consumer
// then reads content_html without a sanitizer of its own, which is what keeps a
// second reader, a second export or a second template from being a second place
// this has to be got right. The cost is that changing the policy needs a
// re-extraction -- which the stored snapshot makes cheap, and is why the
// snapshot is kept at all.
func libraryExtractPolicy() *bluemonday.Policy {
	policy := bluemonday.NewPolicy()

	policy.AllowElements(
		"p", "br", "hr",
		"h1", "h2", "h3", "h4", "h5", "h6",
		"ul", "ol", "li", "dl", "dt", "dd",
		"blockquote", "pre", "code", "kbd", "samp", "var",
		"em", "strong", "i", "b", "u", "s", "sub", "sup", "small", "mark", "span",
		"figure", "figcaption",
		"table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
	)

	// An anchor keeps its target and its title, and nothing that could make it
	// a different request than the one its text promises.
	policy.AllowAttrs("href", "title").OnElements("a")
	policy.AllowAttrs("src", "alt", "title", "width", "height").OnElements("img")
	policy.AllowAttrs("colspan", "rowspan").OnElements("td", "th")
	policy.AllowAttrs("start", "type").OnElements("ol")
	policy.AllowAttrs("cite").OnElements("blockquote")
	policy.AllowAttrs("class").Matching(regexp.MustCompile(`^language-[A-Za-z0-9+#-]+$`)).OnElements("code", "pre")

	// id only on a heading, and only in the anchor shape. A table of contents
	// has to be able to scroll to a heading; nothing else in an article needs a
	// fragment target, and a page-supplied id elsewhere would silently take
	// over an anchor a stored reading position depends on.
	policy.AllowAttrs("id").Matching(libraryAnchorIDPattern).
		OnElements("h1", "h2", "h3", "h4", "h5", "h6")

	policy.AllowStyles(libraryInlineStyleProperties...).Globally()
	// Every element named here is one AllowElements already allows: OnElements
	// is itself what admits an element in bluemonday, so naming one that is not
	// on the allowlist above would quietly add it.
	policy.AllowAttrs("style").OnElements(
		"p", "span", "blockquote", "pre", "code", "figure", "figcaption",
		"table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
		"ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "img", "a",
	)

	// Only the three schemes an article legitimately points at. Anything else,
	// javascript: included, drops the attribute rather than the element, so the
	// link's text stays readable.
	policy.AllowURLSchemes("http", "https", "mailto")
	policy.RequireNoFollowOnLinks(true)
	policy.RequireNoReferrerOnLinks(true)
	policy.AddTargetBlankToFullyQualifiedLinks(true)
	policy.AllowRelativeURLs(false)

	return policy
}
