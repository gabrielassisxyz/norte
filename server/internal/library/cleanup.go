package library

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// The cleanup rules work on the trailing blocks of the extracted content, and
// only there. Both leaks they remove are template furniture a blog puts after
// the article, and the article's own last paragraph is right where a rule that
// searched the whole document would start doing damage.
const (
	// libraryCleanupTrailingBlocks is how far back from the end a rule looks.
	// A footer is a handful of blocks; reaching further would start meeting
	// the article.
	libraryCleanupTrailingBlocks = 6
	// libraryCleanupMaxBlockRunes is the longest block a rule will remove. A
	// navigation strip or a subscription pitch is short, and a paragraph that
	// merely mentions a newsletter is not.
	libraryCleanupMaxBlockRunes = 240
)

// libraryAdjacentPostPattern recognises the previous/next post strip. Portuguese
// and English both, because Norte reads both.
var libraryAdjacentPostPattern = regexp.MustCompile(
	`(?i)(^|\W)(previous|prev|next|older|newer|anterior|pr[oó]ximo|pr[oó]xima|segui[nd]te)(\W|$)`)

// libraryNewsletterPattern recognises the subscription pitch.
var libraryNewsletterPattern = regexp.MustCompile(
	`(?i)(newsletter|subscribe|sign up for|join .{0,20}readers|inscreva-se|assine|receba .{0,30}(e-?mail|caixa de entrada))`)

// libraryApplyCleanupRules runs every rule over the extracted content. Each is
// a function of its own with a fixture of its own, so a rule that starts eating
// an article is found by the fixture that proves what it is for.
func libraryApplyCleanupRules(content *html.Node) {
	libraryRemoveAdjacentPostLinks(content)
	libraryRemoveNewsletterPromo(content)
}

// libraryRemoveAdjacentPostLinks drops the "← previous post / next post →"
// strip a blog template leaves under the article, and reports how many blocks
// it removed.
//
// A block has to contain a link to qualify. That is what separates navigation
// from prose: an article can end on a sentence about what came before it, and
// that sentence is not a link to the previous post.
func libraryRemoveAdjacentPostLinks(content *html.Node) int {
	return libraryRemoveTrailingBlocks(content, func(block *html.Node, text string) bool {
		return libraryBlockHasLink(block) && libraryAdjacentPostPattern.MatchString(text)
	})
}

// libraryRemoveNewsletterPromo drops the subscription pitch at the end of the
// article, and reports how many blocks it removed.
func libraryRemoveNewsletterPromo(content *html.Node) int {
	return libraryRemoveTrailingBlocks(content, func(_ *html.Node, text string) bool {
		return libraryNewsletterPattern.MatchString(text)
	})
}

// libraryRemoveTrailingBlocks removes matching blocks from the end of the
// content, stopping at the first one that does not match.
//
// Stopping is the important half. A rule that kept scanning past a block it
// kept would reach into the article for anything that happened to match, and
// the leaks these rules exist for are always the last thing on the page.
func libraryRemoveTrailingBlocks(content *html.Node, matches func(*html.Node, string) bool) int {
	removed := 0
	for removed < libraryCleanupTrailingBlocks {
		block := libraryLastElementChild(content)
		if block == nil {
			return removed
		}
		text := libraryNodeText(block)
		if len([]rune(text)) > libraryCleanupMaxBlockRunes || !matches(block, text) {
			return removed
		}
		content.RemoveChild(block)
		removed++
	}
	return removed
}

// libraryLastElementChild is the content's last block, skipping the whitespace
// text nodes a renderer leaves between elements.
func libraryLastElementChild(content *html.Node) *html.Node {
	for child := content.LastChild; child != nil; child = child.PrevSibling {
		if child.Type == html.ElementNode {
			return child
		}
		if child.Type == html.TextNode && strings.TrimSpace(child.Data) != "" {
			return nil
		}
	}
	return nil
}

func libraryBlockHasLink(block *html.Node) bool {
	if block.DataAtom == atom.A {
		return true
	}
	found := false
	libraryWalkElements(block, func(node *html.Node) {
		if node.DataAtom == atom.A {
			found = true
		}
	})
	return found
}
