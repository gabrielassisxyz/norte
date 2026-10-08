package library

import (
	"net/url"
	"strings"
	"time"

	trafilatura "github.com/markusmobius/go-trafilatura/v2"
	"golang.org/x/net/html"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// Norte reads a page's metadata from the page's own declarations, and falls
// back to the extractor's heuristics only where the page declares nothing.
//
// The other way round was tried first and does not hold up. On the three real
// pages in testdata/ go-trafilatura's derived metadata disagreed with what the
// pages declare in six fields: it read gwern.net's author as "Gwern Net" where
// the page declares "Gwern", read the Go blog's site name as "Golang" out of a
// link in the footer, read its author as "Eli Bendersky; On Behalf" by splitting
// a body byline on its comma, and kept the site suffix on two titles that the
// pages' own <h1> gives without it. Every one of those is visible on a card, and
// a declaration is both more reliable and far cheaper to check than a heuristic.
//
// What the extractor still owns is the content, and the title and date of a page
// that declares neither -- an old blog post with the date only in prose is
// exactly what htmldate is for.

// libraryTitleMetaKeys, and the lists below it, are the declarations Norte reads
// for each field, in the order it prefers them.
var (
	libraryTitleMetaKeys  = []string{"og:title", "twitter:title", "citation_title", "dc.title"}
	libraryAuthorMetaKeys = []string{"author", "citation_author", "article:author", "dc.creator", "dcterms.creator"}
	libraryDateMetaKeys   = []string{
		"article:published_time", "citation_publication_date", "citation_date",
		"dc.date.issued", "dcterms.created", "date", "pubdate", "publish_date",
	}
	// twitter:site is deliberately absent: it is a Twitter handle, so the Go
	// blog declares "@golang" there and reading it would store a site named
	// golang for a page on go.dev.
	librarySiteMetaKeys  = []string{"og:site_name", "og:site", "application-name"}
	libraryImageMetaKeys = []string{"og:image", "twitter:image", "citation_image"}
)

// libraryDeclaredDateLayouts are the ways a page writes a date it declares.
// The list is ordered longest first, so a full timestamp is not read as a date
// with the rest discarded.
var libraryDeclaredDateLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02T15:04Z07:00",
	"2006-01-02 15:04",
	"2006-01-02",
	"2006/01/02",
	"02 January 2006",
	"January 2, 2006",
}

// libraryDeclarations is what a page says about itself in its head: the meta
// tags, the document title and the headings a title may be found in.
type libraryDeclarations struct {
	meta      map[string]string
	pageTitle string
	headings  []string
}

// libraryReadDeclarations parses the page and collects what it declares. It
// takes the first value of each name, because a page that repeats one is
// declaring the first and echoing it.
func libraryReadDeclarations(source []byte) libraryDeclarations {
	declared := libraryDeclarations{meta: map[string]string{}}
	doc, err := html.Parse(strings.NewReader(string(source)))
	if err != nil {
		return declared
	}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		switch libraryTagName(node) {
		case "meta":
			libraryRecordMeta(declared.meta, node)
		case "title":
			if declared.pageTitle == "" {
				declared.pageTitle = libraryNodeText(node)
			}
		case "h1", "h2":
			if text := libraryNodeText(node); text != "" {
				declared.headings = append(declared.headings, text)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	return declared
}

// libraryRecordMeta stores one meta tag under its name and under its property,
// since the two spellings are interchangeable in practice: pages declare
// og:title as a property and as a name, and a reader that insists on one of
// them misses half the web.
func libraryRecordMeta(into map[string]string, node *html.Node) {
	key, content := "", ""
	for _, attr := range node.Attr {
		switch strings.ToLower(attr.Key) {
		case "name", "property", "itemprop":
			if key == "" {
				key = strings.ToLower(strings.TrimSpace(attr.Val))
			}
		case "content":
			content = strings.TrimSpace(attr.Val)
		}
	}
	if key == "" || content == "" {
		return
	}
	if _, seen := into[key]; !seen {
		into[key] = content
	}
}

func (d libraryDeclarations) first(keys []string) string {
	for _, key := range keys {
		if value := d.meta[key]; value != "" {
			return value
		}
	}
	return ""
}

// libraryResolveMetadata produces the five stored fields from the page's
// declarations, with the extractor's reading behind them.
func libraryResolveMetadata(
	declared libraryDeclarations,
	extractorMeta trafilatura.Metadata,
	pageURL *url.URL,
) libraryExtracted {
	resolved := libraryExtracted{
		Title:       libraryResolveTitle(declared, extractorMeta),
		Author:      libraryCollapseSpaces(declared.first(libraryAuthorMetaKeys)),
		PublishedAt: libraryResolvePublishedAt(declared, extractorMeta),
		Site:        libraryResolveSite(declared, pageURL),
	}
	image := declared.first(libraryImageMetaKeys)
	if image == "" {
		image = strings.TrimSpace(extractorMeta.Image)
	}
	if image != "" {
		resolved.LeadImage = libraryAbsoluteImageURL(image, pageURL)
	}
	return resolved
}

// libraryResolveTitle takes the declared title, with the site suffix removed
// when one of the page's own headings says the title without it.
//
// A page declares "Hash function - Simple English Wikipedia, the free
// encyclopedia" and heads the article "Hash function". Trimming by searching
// for a separator would be guesswork -- plenty of titles contain a dash -- but
// a heading that is a prefix of the declared title is the page itself saying
// where its title ends.
func libraryResolveTitle(declared libraryDeclarations, extractorMeta trafilatura.Metadata) string {
	title := libraryCollapseSpaces(declared.first(libraryTitleMetaKeys))
	if title == "" {
		title = libraryCollapseSpaces(declared.pageTitle)
	}
	if title == "" {
		return libraryCollapseSpaces(extractorMeta.Title)
	}
	for _, heading := range declared.headings {
		heading = libraryCollapseSpaces(heading)
		if heading == "" || heading == title || !strings.HasPrefix(title, heading) {
			continue
		}
		// The remainder has to start with a separator, or "Go 1.22" would trim
		// "Go 1.22 is released!" down to a heading that merely shares a start.
		remainder := strings.TrimSpace(strings.TrimPrefix(title, heading))
		if remainder == "" {
			continue
		}
		if strings.ContainsRune("-|·–—:~»", []rune(remainder)[0]) {
			return heading
		}
	}
	return title
}

// libraryResolvePublishedAt reads the declared publication instant, falling
// back to the extractor's reading of a date written in prose.
//
// The declaration keeps the time of day the page gave; the fallback cannot,
// because htmldate answers with a date. An article whose date is only in its
// text therefore lands at midnight UTC, which is the truncation it is -- not a
// claim that it was published at midnight.
func libraryResolvePublishedAt(declared libraryDeclarations, extractorMeta trafilatura.Metadata) string {
	if raw := declared.first(libraryDateMetaKeys); raw != "" {
		if parsed, ok := libraryParseDeclaredDate(raw); ok {
			return core.FormatTime(parsed)
		}
	}
	if !extractorMeta.Date.IsZero() {
		return core.FormatTime(extractorMeta.Date)
	}
	return ""
}

func libraryParseDeclaredDate(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	for _, layout := range libraryDeclaredDateLayouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

// libraryResolveSite takes the declared site name, and the page's host when
// there is none.
//
// The extractor's own sitename is deliberately not consulted. It is derived by
// looking around the document, and on one of the committed fixtures it came
// back with the text of a link in the footer -- a plausible-looking name that
// is not the site. The host is never that interesting and is never wrong.
func libraryResolveSite(declared libraryDeclarations, pageURL *url.URL) string {
	if site := libraryCollapseSpaces(declared.first(librarySiteMetaKeys)); site != "" {
		return site
	}
	if pageURL != nil {
		return pageURL.Hostname()
	}
	return ""
}

func libraryCollapseSpaces(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
