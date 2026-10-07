package library

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
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
func libraryRemoveAdjacentPostLinks(content *html.Node) int {
	return libraryRemoveTrailingBlocks(content, libraryAdjacentPostPattern)
}

// libraryRemoveNewsletterPromo drops the subscription pitch at the end of the
// article, and reports how many blocks it removed.
func libraryRemoveNewsletterPromo(content *html.Node) int {
	return libraryRemoveTrailingBlocks(content, libraryNewsletterPattern)
}

// libraryRemoveTrailingBlocks removes matching blocks from the end of the
// content, stopping at the first one that does not match.
//
// Stopping is half the rule. A pass that kept scanning past a block it kept
// would reach into the article for anything that happened to match, and the
// leaks these rules exist for are always the last thing on the page.
func libraryRemoveTrailingBlocks(content *html.Node, pattern *regexp.Regexp) int {
	removed := 0
	for removed < libraryCleanupTrailingBlocks {
		block := libraryLastElementChild(content)
		if block == nil {
			return removed
		}
		if len([]rune(libraryNodeText(block))) > libraryCleanupMaxBlockRunes {
			return removed
		}
		if !libraryBlockInvitesWith(block, pattern) {
			return removed
		}
		content.RemoveChild(block)
		removed++
	}
	return removed
}

// libraryBlockInvitesWith is the other half: the pattern has to match something
// the block asks the reader to *do* -- the text or the target of a link, a
// button or a form -- and not merely the block's prose.
//
// Matching the prose is what the first version of these rules did, and the
// newsletter fixture is in the corpus because of it. An article's own closing
// paragraph said that people "push back, usually by pointing at a newsletter
// somewhere that recommends the opposite"; the rule read the word, the block
// was short and last, and the author's conclusion was deleted. Furniture is
// recognisable by carrying the affordance, which prose about the same subject
// does not.
func libraryBlockInvitesWith(block *html.Node, pattern *regexp.Regexp) bool {
	if libraryIsCallToAction(block) && libraryCallMatches(block, pattern) {
		return true
	}
	found := false
	libraryWalkElements(block, func(node *html.Node) {
		if !found && libraryIsCallToAction(node) && libraryCallMatches(node, pattern) {
			found = true
		}
	})
	return found
}

func libraryIsCallToAction(node *html.Node) bool {
	switch libraryTagName(node) {
	case "a", "button", "form":
		return true
	}
	return false
}

func libraryCallMatches(node *html.Node, pattern *regexp.Regexp) bool {
	if pattern.MatchString(libraryNodeText(node)) {
		return true
	}
	for _, attr := range node.Attr {
		switch attr.Key {
		case "href", "action", "rel", "title", "aria-label":
			if pattern.MatchString(attr.Val) {
				return true
			}
		}
	}
	return false
}

// libraryLastElementChild is the content's last block, skipping the whitespace
// text nodes a renderer leaves between elements. Text that is not whitespace is
// the article itself, and stops the scan.
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
