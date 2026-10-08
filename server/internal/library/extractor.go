package library

import (
	"bytes"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode"

	readability "codeberg.org/readeck/go-readability/v2"
	trafilatura "github.com/markusmobius/go-trafilatura/v2"
	"golang.org/x/net/html"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// libraryWordsPerMinute is the reading speed `minutes` is computed at. It is a
// round number on purpose: the figure is a hint on a card, not a measurement,
// and a precise-looking one would invite being trusted as such.
const libraryWordsPerMinute = 230

// libraryHeading is one entry of content_headings: where a heading sits, what
// it says, and the anchor the reader scrolls to. The anchor is also the id the
// heading carries in content_html, which is what lets a stored reading position
// survive a re-extraction.
type libraryHeading struct {
	Level  int    `json:"level"`
	Text   string `json:"text"`
	Anchor string `json:"anchor"`
}

// libraryExtracted is everything one pass over a page produced.
type libraryExtracted struct {
	Title       string
	Author      string
	PublishedAt string
	Site        string
	LeadImage   string
	ContentHTML string
	ContentText string
	Headings    []libraryHeading
	Minutes     int
}

// libraryPreElementPattern finds a real <pre> start tag, so a word that merely
// begins with "pre" does not send the page down the second pass.
var libraryPreElementPattern = regexp.MustCompile(`(?i)<pre(\s|>|/>)`)

// libraryExtractOptions is the configuration every extraction runs under.
//
// HtmlDate is left on Default, which with the fallback enabled means the
// extensive scan: that one reads a date written in prose, and a blog post whose
// only date is the line "6 February 2024" under the title is exactly the case
// the declarations in metadata.go cannot answer.
func libraryExtractOptions(pageURL *url.URL) trafilatura.Options {
	return trafilatura.Options{
		OriginalURL:     pageURL,
		Focus:           trafilatura.Balanced,
		EnableFallback:  true,
		ExcludeComments: true,
		IncludeImages:   true,
		IncludeLinks:    true,
	}
}

// libraryExtractPage turns a page's HTML into what gets stored.
//
// pageURL is the address the links, the images and the site name resolve
// against, which after a redirect is the URL the chain ended at rather than the
// one the person saved. contentType is the fetch's Content-Type header, used to
// decode a page that is not UTF-8; it is empty for a snapshot that came with no
// header.
//
// Metadata always comes from trafilatura. The content usually does too, except
// on a page carrying a <pre>: trafilatura flattens a code block into nested
// <code> elements and loses the line structure, while go-readability keeps
// <pre><code> intact, so a page with code is read a second time and that
// reading's content is the one kept. Two passes cost a parse; losing the
// indentation of every code sample costs the article.
func libraryExtractPage(source []byte, pageURL *url.URL, contentType string) (libraryExtracted, error) {
	result, err := trafilatura.Extract(bytes.NewReader(source), libraryExtractOptions(pageURL))
	if err != nil {
		return libraryExtracted{}, core.Permanent(fmt.Errorf("extracting the page: %w", err))
	}
	content := result.ContentNode
	if libraryPreElementPattern.Match(source) {
		if fromReadability := libraryReadabilityContent(source, pageURL); fromReadability != nil {
			content = fromReadability
		}
	}
	if content != nil && libraryNodeTextBlocks(content) < 2 {
		// trafilatura's last-resort pass concatenates a page's blocks into a
		// single paragraph, so the last word of one block is glued to the
		// first of the next whenever the markup carried no whitespace between
		// the tags -- which is the normal shape of a minified page and of what
		// the extension captures. go-readability keeps the block elements, so
		// when it finds more than one block its reading is the one the stored
		// text can carry a separator in. A page that really is one block comes
		// back as one block from both, and nothing is swapped.
		if fromReadability := libraryReadabilityContent(source, pageURL); fromReadability != nil &&
			libraryNodeTextBlocks(fromReadability) > 1 {
			content = fromReadability
		}
	}
	if content == nil {
		return libraryExtracted{}, core.Permanent(fmt.Errorf("the page carries no readable content"))
	}

	libraryApplyCleanupRules(content)
	libraryResolveContentURLs(content, pageURL)
	headings := libraryAssignHeadingAnchors(content)

	sanitized := libraryExtractPolicy().Sanitize(libraryRenderFragment(content))
	text := libraryTextFromHTML(sanitized)

	extracted := libraryResolveMetadata(libraryReadDeclarations(source, contentType), result.Metadata, pageURL)
	extracted.ContentHTML = sanitized
	extracted.ContentText = text
	extracted.Headings = headings
	extracted.Minutes = libraryReadingMinutes(text)
	return extracted, nil
}

// libraryReadabilityContent is the second pass over a page with code in it. A
// failure is not an error: the caller keeps trafilatura's content, which is
// worse for the code blocks and right for everything else.
func libraryReadabilityContent(source []byte, pageURL *url.URL) *html.Node {
	article, err := readability.FromReader(bytes.NewReader(source), pageURL)
	if err != nil || article.Node == nil {
		return nil
	}
	return article.Node
}

// libraryReadingMinutes is the word count over a round reading speed, rounded
// up, so an article of any length reports at least one minute.
func libraryReadingMinutes(text string) int {
	words := len(strings.Fields(text))
	if words == 0 {
		return 0
	}
	return int(math.Ceil(float64(words) / float64(libraryWordsPerMinute)))
}

// libraryRenderFragment renders a node's children rather than the node itself,
// so the stored HTML is the article's own markup without the wrapper the
// extractor happened to put around it.
func libraryRenderFragment(node *html.Node) string {
	var out bytes.Buffer
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if err := html.Render(&out, child); err != nil {
			// Render only fails on a malformed tree, which a parser cannot
			// produce. Dropping the one child is better than losing the page.
			continue
		}
	}
	return out.String()
}

// libraryResolveContentURLs makes every link and image address absolute against
// the page it came from, and lifts an image from http to https.
//
// The scheme is rewritten without probing the host. The content security policy
// refuses a plain http image, so leaving one in place guarantees a broken
// image; rewriting it is right far more often than not, and the reader shows the
// alt text of an image that still fails to load.
func libraryResolveContentURLs(content *html.Node, pageURL *url.URL) {
	libraryWalkElements(content, func(node *html.Node) {
		switch libraryTagName(node) {
		case "a":
			libraryResolveAttr(node, "href", pageURL, false)
		case "img":
			libraryResolveAttr(node, "src", pageURL, true)
		}
	})
}

// libraryTagName is an element's name, lowercased.
//
// It reads node.Data rather than node.DataAtom, and every rule in this package
// does the same. The extractors build their output tree node by node and leave
// DataAtom unset on much of it -- an <img> that came through trafilatura
// reports atom 0 while its Data is still "img" -- so a rule keyed on the atom
// silently skips exactly the nodes the extractor touched.
func libraryTagName(node *html.Node) string {
	if node.Type != html.ElementNode {
		return ""
	}
	return strings.ToLower(node.Data)
}

func libraryResolveAttr(node *html.Node, name string, pageURL *url.URL, forceHTTPS bool) {
	for i, attr := range node.Attr {
		if attr.Key != name {
			continue
		}
		raw := strings.TrimSpace(attr.Val)
		if raw == "" {
			return
		}
		resolved, err := pageURL.Parse(raw)
		if err != nil {
			return
		}
		if forceHTTPS && resolved.Scheme == "http" {
			resolved.Scheme = "https"
		}
		node.Attr[i].Val = resolved.String()
		return
	}
}

// libraryAbsoluteImageURL is libraryResolveAttr for a metadata image, which is
// a bare string rather than an attribute on a node.
func libraryAbsoluteImageURL(raw string, pageURL *url.URL) string {
	resolved, err := pageURL.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	if resolved.Scheme == "http" {
		resolved.Scheme = "https"
	}
	if resolved.Scheme != "https" {
		// The image is rendered by consumers that trust the stored value, so a
		// javascript: or data: URL is dropped rather than carried along.
		return ""
	}
	return resolved.String()
}

// libraryHeadingLevels maps a heading element to its level.
var libraryHeadingLevels = map[string]int{
	"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6,
}

// libraryAssignHeadingAnchors gives every heading the id the table of contents
// and a stored reading position both point at, and reports the table.
//
// The id is written here, before sanitization, and the sanitizer then allows an
// id only on a heading and only in the shape this produces -- so a page that
// shipped ids of its own cannot leave one behind for an anchor to collide with.
func libraryAssignHeadingAnchors(content *html.Node) []libraryHeading {
	headings := []libraryHeading{}
	used := map[string]bool{}
	libraryWalkElements(content, func(node *html.Node) {
		level, ok := libraryHeadingLevels[libraryTagName(node)]
		if !ok {
			return
		}
		text := libraryNodeText(node)
		if text == "" {
			// An id the page chose for a heading with no entry in the table
			// would be a target nothing here vouched for.
			node.Attr = slices.DeleteFunc(node.Attr, func(attr html.Attribute) bool { return attr.Key == "id" })
			return
		}
		anchor := libraryUniqueAnchor(libraryAnchorSlug(text), len(headings), used)
		librarySetAttr(node, "id", anchor)
		headings = append(headings, libraryHeading{Level: level, Text: text, Anchor: anchor})
	})
	return headings
}

// libraryUniqueAnchor keeps the document order suffixes the reader expects: the
// first occurrence takes the plain slug and later ones take -2, -3. Every id
// handed out is remembered, because a heading literally called "A 2" would
// otherwise collide with the second "A".
func libraryUniqueAnchor(slug string, index int, used map[string]bool) string {
	if slug == "" {
		// A heading of nothing but punctuation or emoji still needs a target.
		slug = fmt.Sprintf("secao-%d", index+1)
	}
	anchor := slug
	for count := 2; used[anchor]; count++ {
		anchor = fmt.Sprintf("%s-%d", slug, count)
	}
	used[anchor] = true
	return anchor
}

// libraryAnchorSlugTransformer strips the combining marks that remain once a
// string is decomposed, which is what turns "Instalação" into "instalacao".
var libraryAnchorSlugTransformer = transform.Chain(
	norm.NFD,
	runes.Remove(runes.In(unicode.Mn)),
	norm.NFC,
)

// libraryAnchorSlug renders a heading as an anchor: lowercase, accents removed,
// every run of anything else collapsed to one hyphen.
func libraryAnchorSlug(text string) string {
	folded, _, err := transform.String(libraryAnchorSlugTransformer, strings.ToLower(text))
	if err != nil {
		folded = strings.ToLower(text)
	}
	var out strings.Builder
	previousHyphen := false
	for _, r := range folded {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out.WriteRune(r)
			previousHyphen = false
			continue
		}
		if !previousHyphen && out.Len() > 0 {
			out.WriteByte('-')
			previousHyphen = true
		}
	}
	return strings.Trim(out.String(), "-")
}

// libraryWalkElements calls visit on every element under node, in document
// order. The children are collected before visiting, so a rule that removes the
// node it was handed does not cut the walk short.
func libraryWalkElements(node *html.Node, visit func(*html.Node)) {
	children := []*html.Node{}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		children = append(children, child)
	}
	for _, child := range children {
		if child.Type == html.ElementNode {
			visit(child)
		}
		libraryWalkElements(child, visit)
	}
}

// libraryNodeText is a node's visible text on one line, with runs of whitespace
// collapsed, which is how a heading is compared and slugged.
func libraryNodeText(node *html.Node) string {
	var out strings.Builder
	libraryCollectText(node, &out)
	return strings.Join(strings.Fields(out.String()), " ")
}

func libraryCollectText(node *html.Node, out *strings.Builder) {
	if node.Type == html.TextNode {
		out.WriteString(node.Data)
		return
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		libraryCollectText(child, out)
	}
}

func librarySetAttr(node *html.Node, name, value string) {
	for i, attr := range node.Attr {
		if attr.Key == name {
			node.Attr[i].Val = value
			return
		}
	}
	node.Attr = append(node.Attr, html.Attribute{Key: name, Val: value})
}

// libraryBlockElements are the elements a line break belongs around when the
// stored HTML is rendered back to plain text.
var libraryBlockElements = map[string]bool{
	"p": true, "div": true, "h1": true, "h2": true, "h3": true, "h4": true,
	"h5": true, "h6": true, "li": true, "ul": true, "ol": true, "dl": true,
	"dt": true, "dd": true, "blockquote": true, "pre": true, "figure": true,
	"figcaption": true, "table": true, "tr": true, "hr": true, "br": true,
	"section": true, "article": true, "caption": true,
}

// libraryTextFromHTML renders the stored HTML as the plain text that goes into
// content_text and into the search index.
//
// It reads the sanitized markup rather than the extractor's own text output,
// because the two must not disagree: the text is what full-text search matches
// on and what a highlight is anchored against, and a passage that survived the
// extractor but not the sanitizer would otherwise be searchable and absent.
func libraryTextFromHTML(markup string) string {
	return strings.Join(libraryTextBlocks(markup), "\n\n")
}

// libraryTextBlocks is libraryTextFromHTML before the blocks are joined. The
// count of what it returns is also how the collapse rule in
// libraryExtractPage tells a reading that kept the page's blocks from one
// that ran them all together.
func libraryTextBlocks(markup string) []string {
	doc, err := html.Parse(strings.NewReader(markup))
	if err != nil {
		return nil
	}
	blocks := []string{}
	var pending strings.Builder
	flush := func() {
		if block := strings.Join(strings.Fields(pending.String()), " "); block != "" {
			blocks = append(blocks, block)
		}
		pending.Reset()
	}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		switch {
		case node.Type == html.TextNode:
			pending.WriteString(node.Data)
			return
		case libraryTagName(node) == "pre":
			// A code block's own line breaks and indentation are the content.
			flush()
			var raw strings.Builder
			libraryCollectText(node, &raw)
			if block := strings.Trim(raw.String(), "\n"); block != "" {
				blocks = append(blocks, block)
			}
			return
		case libraryBlockElements[libraryTagName(node)]:
			flush()
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				walk(child)
			}
			flush()
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	flush()
	return blocks
}

// libraryNodeTextBlocks is libraryTextBlocks over a candidate content tree,
// before it is sanitized. Sanitization never removes a block-level element, so
// the count it reports is the count the stored text will have.
func libraryNodeTextBlocks(content *html.Node) int {
	return len(libraryTextBlocks(libraryRenderFragment(content)))
}
