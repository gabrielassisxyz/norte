package library

import (
	"strings"
	"testing"
)

// TestTheAdjacentPostStripIsRemoved proves the rule on the fixture it exists
// for, and proves it stops: the paragraph above the strip ends on the word
// "next" in prose, and an article's own last sentence is exactly what a rule
// that kept scanning would eat.
func TestTheAdjacentPostStripIsRemoved(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "news-article")
	for _, gone := range []string{
		"Previous: Ferry timetable cut again",
		"Next: Dredging contract awarded",
		"/2025/02/12/harbour-dredging",
	} {
		if strings.Contains(extracted.ContentHTML, gone) {
			t.Errorf("the adjacent-post strip survived (%q):\n%s", gone, extracted.ContentHTML)
		}
	}
	if !strings.Contains(extracted.ContentText, "the question that decides what happens next") {
		t.Errorf("the article's last paragraph was removed with the strip:\n%s", extracted.ContentText)
	}
}

// TestTheNewsletterPromoIsRemoved is the same shape for the subscription pitch,
// and the same guard: the paragraph above it mentions a newsletter in prose.
func TestTheNewsletterPromoIsRemoved(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "newsletter")
	for _, gone := range []string{
		"Subscribe to Slow Software",
		"Join 12,000 readers",
		"Sign up for the newsletter",
	} {
		if strings.Contains(extracted.ContentHTML, gone) {
			t.Errorf("the subscription pitch survived (%q):\n%s", gone, extracted.ContentHTML)
		}
	}
	if !strings.Contains(extracted.ContentText, "pointing at a newsletter somewhere that recommends the opposite") {
		t.Errorf("the paragraph that merely mentions a newsletter was removed:\n%s", extracted.ContentText)
	}
}

// TestACuratedSeeAlsoListIsNotATemplateLeak is the rules' false-positive guard.
// A hand-maintained list of links at the end of an article has every surface
// feature of a navigation strip -- last block, nothing but anchors, short --
// and is the author's own content.
func TestACuratedSeeAlsoListIsNotATemplateLeak(t *testing.T) {
	content := libraryParseFragment(t, `<div>`+
		`<p>The closing paragraph of the article.</p>`+
		`<ul><li><a href="/expand-contract">Expand and contract</a></li>`+
		`<li><a href="/deploy-decoupling">Decoupling deploy from release</a></li></ul>`+
		`</div>`)
	libraryApplyCleanupRules(content)
	if !strings.Contains(libraryNodeText(content), "Expand and contract") {
		t.Errorf("the curated see-also list was removed:\n%s", libraryNodeText(content))
	}
}

// TestAProseMentionOfANewsletterSurvives is the specific false positive the
// newsletter fixture caught: a paragraph that talks about newsletters, is
// short, is last, and is the article's own conclusion.
func TestAProseMentionOfANewsletterSurvives(t *testing.T) {
	conclusion := "This is the part people push back on, usually by pointing at a newsletter " +
		"somewhere that recommends the opposite."
	content := libraryParseFragment(t, `<div><p>Body text.</p><p>`+conclusion+`</p></div>`)
	if removed := libraryRemoveNewsletterPromo(content); removed != 0 {
		t.Fatalf("removed %d blocks, want 0: the block carries no subscribe affordance", removed)
	}
	promo := `<p><a href="/subscribe">Sign up for the newsletter</a> to get the next one.</p>`
	withPromo := libraryParseFragment(t, `<div><p>`+conclusion+`</p>`+promo+`</div>`)
	if removed := libraryRemoveNewsletterPromo(withPromo); removed != 1 {
		t.Fatalf("removed %d blocks, want exactly the promo", removed)
	}
	if !strings.Contains(libraryNodeText(withPromo), "push back on") {
		t.Errorf("the conclusion was removed with the promo:\n%s", libraryNodeText(withPromo))
	}
}

func TestTheCleanupRulesStopAtTheFirstBlockTheyKeep(t *testing.T) {
	content := libraryParseFragment(t, `<div>`+
		`<p>The article's own closing paragraph, which has no link in it at all.</p>`+
		`<p><a href="/x">Next: something else</a></p>`+
		`<p>A paragraph after the strip, which the rule must not reach past it to remove.</p>`+
		`</div>`)
	if removed := libraryRemoveAdjacentPostLinks(content); removed != 0 {
		t.Errorf("the rule removed %d blocks from the end, want 0: the last block is prose", removed)
	}
}

func TestTheAdjacentPostRuleNeedsTheWordInTheLink(t *testing.T) {
	withLink := libraryParseFragment(t, `<div><p>Body text.</p><p><a href="/x">Next post</a></p></div>`)
	if removed := libraryRemoveAdjacentPostLinks(withLink); removed != 1 {
		t.Errorf("removed %d blocks from a navigation strip, want 1", removed)
	}
	withoutLink := libraryParseFragment(t, `<div><p>Body text.</p><p>What happens next is the question.</p></div>`)
	if removed := libraryRemoveAdjacentPostLinks(withoutLink); removed != 0 {
		t.Errorf("removed %d blocks from a sentence with no link in it, want 0", removed)
	}
	// The word is in the prose and the link is about something else, which is
	// an ordinary way for an article to end.
	besideALink := libraryParseFragment(t,
		`<div><p>Body text.</p><p>What happens next depends on <a href="/depot">the depot site</a>.</p></div>`)
	if removed := libraryRemoveAdjacentPostLinks(besideALink); removed != 0 {
		t.Errorf("removed %d blocks where only the prose matched, want 0", removed)
	}
}

func TestTheCleanupRulesLeaveALongTrailingBlockAlone(t *testing.T) {
	long := strings.Repeat(`Author words about <a href="/subscribe">the newsletter</a> once run. `, 10)
	content := libraryParseFragment(t, `<div><p>Body text.</p><p>`+long+`</p></div>`)
	if removed := libraryRemoveNewsletterPromo(content); removed != 0 {
		t.Errorf("removed %d blocks, want 0: a block past the length cap is prose, not furniture", removed)
	}
}
