package library

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"

	trafilatura "github.com/markusmobius/go-trafilatura/v2"
	"golang.org/x/net/html"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/transform"
)

// libraryGolden is one fixture's hand-written expectation, read from
// testdata/golden/<name>.json. The five metadata fields are what the page
// itself declares; the url is the address the page was saved from, which is
// also what a relative link and a relative image resolve against.
type libraryGolden struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	PublishedAt string `json:"published_at"`
	Site        string `json:"site"`
	LeadImage   string `json:"lead_image"`
}

// libraryPageShapeFixtures are the seven page shapes the corpus covers. Four are
// locally authored because the originals may not be redistributed; three are
// real pages whose licences allow it. testdata/README.md says which is which.
var libraryPageShapeFixtures = []string{
	"essay",
	"newsletter",
	"news-article",
	"bliki",
	"gwern-note",
	"go-blog",
	"wikipedia-article",
}

func libraryReadFixture(t *testing.T, name string) ([]byte, libraryGolden, *url.URL) {
	t.Helper()
	page, err := os.ReadFile(filepath.Join("testdata", "pages", name+".html"))
	if err != nil {
		t.Fatalf("reading the %s fixture: %v", name, err)
	}
	raw, err := os.ReadFile(filepath.Join("testdata", "golden", name+".json"))
	if err != nil {
		t.Fatalf("reading the %s golden: %v", name, err)
	}
	var golden libraryGolden
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatalf("reading the %s golden: %v", name, err)
	}
	pageURL, err := url.Parse(golden.URL)
	if err != nil {
		t.Fatalf("the %s golden's url does not parse: %v", name, err)
	}
	return page, golden, pageURL
}

func libraryExtractFixture(t *testing.T, name string) (libraryExtracted, libraryGolden) {
	t.Helper()
	page, golden, pageURL := libraryReadFixture(t, name)
	extracted, err := libraryExtractPage(page, pageURL, "")
	if err != nil {
		t.Fatalf("extracting the %s fixture: %v", name, err)
	}
	return extracted, golden
}

// TestEveryPageShapeExtractsItsGoldenMetadata is the corpus assertion: each
// fixture's title, author, date, site and lead image come out exactly as the
// golden file says, field by field.
func TestEveryPageShapeExtractsItsGoldenMetadata(t *testing.T) {
	for _, name := range libraryPageShapeFixtures {
		t.Run(name, func(t *testing.T) {
			extracted, golden := libraryExtractFixture(t, name)
			for _, field := range []struct {
				name string
				got  string
				want string
			}{
				{"title", extracted.Title, golden.Title},
				{"author", extracted.Author, golden.Author},
				{"published_at", extracted.PublishedAt, golden.PublishedAt},
				{"site", extracted.Site, golden.Site},
				{"lead_image", extracted.LeadImage, golden.LeadImage},
			} {
				if field.got != field.want {
					t.Errorf("%s = %q, want %q", field.name, field.got, field.want)
				}
			}
			if strings.TrimSpace(extracted.ContentHTML) == "" {
				t.Error("content_html is empty, so the metadata above was read off a page that extracted to nothing")
			}
		})
	}
}

// TestTheCorpusCoversEveryShapeTheBeadNames fails when a fixture is added to
// the directory without a golden, or a golden without a fixture. A corpus that
// quietly loses a page shape is the failure this test exists for: the suite
// above would still be green, over fewer pages.
func TestTheCorpusCoversEveryShapeTheBeadNames(t *testing.T) {
	expected := append([]string{}, libraryPageShapeFixtures...)
	expected = append(expected, "hostile", "codeblocks")

	pages, err := filepath.Glob(filepath.Join("testdata", "pages", "*.html"))
	if err != nil {
		t.Fatalf("listing the fixtures: %v", err)
	}
	present := map[string]bool{}
	for _, page := range pages {
		present[strings.TrimSuffix(filepath.Base(page), ".html")] = true
	}
	if len(present) != len(expected) {
		t.Errorf("the corpus holds %d pages, want the %d the bead names", len(present), len(expected))
	}
	for _, name := range expected {
		if !present[name] {
			t.Errorf("testdata/pages/%s.html is missing", name)
		}
		if _, err := os.Stat(filepath.Join("testdata", "golden", name+".json")); err != nil {
			t.Errorf("testdata/golden/%s.json is missing: %v", name, err)
		}
	}
}

// TestTheCodeBlockFixtureKeepsPreCode is the reason a page with code is read a
// second time through go-readability. Asserting on <pre><code> rather than on
// <pre> alone is deliberate: trafilatura keeps a <pre> and flattens what is
// inside it, so a test that only looked for the outer tag would pass on exactly
// the output this fixture exists to reject.
func TestTheCodeBlockFixtureKeepsPreCode(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "codeblocks")
	if count := strings.Count(extracted.ContentHTML, "<pre><code"); count != 3 {
		t.Fatalf("content_html holds %d <pre><code> blocks, want the fixture's 3:\n%s",
			count, extracted.ContentHTML)
	}
	// The indentation inside the Go sample is the argument the article makes,
	// so a block that survived as one run-together line has not survived.
	if !strings.Contains(extracted.ContentText, "\n                case <-renew.C():") {
		t.Errorf("the code block lost its line structure in content_text:\n%s", extracted.ContentText)
	}
}

// libraryHostilePatterns are the things that must not survive into stored
// content. Each is matched against the whole of content_html.
var libraryHostilePatterns = []struct {
	name    string
	pattern *regexp.Regexp
}{
	{"a script element", regexp.MustCompile(`(?i)<script`)},
	{"an event handler attribute", regexp.MustCompile(`(?i)<[a-z][^>]*\son[a-z]+\s*=`)},
	{"a javascript: URL", regexp.MustCompile(`(?i)javascript:`)},
	{"an iframe", regexp.MustCompile(`(?i)<iframe`)},
	{"an object", regexp.MustCompile(`(?i)<object`)},
	{"an embed", regexp.MustCompile(`(?i)<embed`)},
	{"a form", regexp.MustCompile(`(?i)<form`)},
	{"an input", regexp.MustCompile(`(?i)<input`)},
	{"a url() inside an attribute", regexp.MustCompile(`(?i)=\s*"[^"]*url\s*\(`)},
}

// TestTheHostileFixtureComesOutClean runs the sanitizer against a page that
// attempts every way into a reader at once.
func TestTheHostileFixtureComesOutClean(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "hostile")
	for _, hostile := range libraryHostilePatterns {
		if hostile.pattern.MatchString(extracted.ContentHTML) {
			t.Errorf("content_html still carries %s:\n%s", hostile.name, extracted.ContentHTML)
		}
	}
	// The prose has to be there, or every assertion above passed because the
	// page extracted to nothing rather than because it was cleaned.
	if !strings.Contains(extracted.ContentText, "Stored content is sanitized once") {
		t.Fatalf("the hostile fixture's prose did not survive, so the assertions above prove nothing:\n%s",
			extracted.ContentText)
	}
	if !strings.Contains(extracted.ContentHTML, "click handler is an attempt to run code") {
		t.Error("the paragraph carrying onclick was dropped whole; only the handler should go")
	}
}

// TestTheSanitizerKeepsAllowedInlineStylesAndDropsTheRest exercises the policy
// directly rather than through a fixture.
//
// It has to be direct: trafilatura strips the style attribute off every node
// before the sanitizer ever sees one, so a page fixture cannot tell a policy
// that keeps the safe declarations apart from one that refuses all of them.
// The policy still has to be right, because the reader and the design system
// write inline styles into content the extraction has already stored.
func TestTheSanitizerKeepsAllowedInlineStylesAndDropsTheRest(t *testing.T) {
	sanitized := libraryExtractPolicy().Sanitize(
		`<p style="color: #444444; text-align: center; background-image: url('https://x.example/p.png'); position: fixed">styled</p>`)
	for _, want := range []string{"color", "text-align"} {
		if !strings.Contains(sanitized, want) {
			t.Errorf("the allowed declaration %s was stripped:\n%s", want, sanitized)
		}
	}
	for _, unwanted := range []string{"url(", "position", "background-image"} {
		if strings.Contains(sanitized, unwanted) {
			t.Errorf("the declaration %s survived:\n%s", unwanted, sanitized)
		}
	}
}

// TestTheSanitizerRefusesAnIDOutsideTheAnchorShape proves the id rule from both
// sides: a heading keeps an anchor-shaped id, and loses one that is not.
func TestTheSanitizerRefusesAnIDOutsideTheAnchorShape(t *testing.T) {
	policy := libraryExtractPolicy()
	if got := policy.Sanitize(`<h2 id="what-a-note-is-for">Heading</h2>`); !strings.Contains(got, `id="what-a-note-is-for"`) {
		t.Errorf("an anchor-shaped id on a heading was dropped: %s", got)
	}
	for _, markup := range []string{
		`<h2 id="Section_One">Heading</h2>`,
		`<h2 id="section one">Heading</h2>`,
		`<p id="what-a-note-is-for">Paragraph</p>`,
	} {
		if got := policy.Sanitize(markup); strings.Contains(got, "id=") {
			t.Errorf("sanitizing %s kept an id: %s", markup, got)
		}
	}
}

// TestRelativeAddressesComeOutAbsolute proves the resolution a reader depends
// on: a link and an image written relative to the page are stored absolute, and
// an http image is lifted to https because the content security policy refuses
// the plain scheme.
func TestRelativeAddressesComeOutAbsolute(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "essay")
	for _, want := range []string{
		`href="https://ortaessays.example/essays/reading-twice"`,
		`src="https://ortaessays.example/img/desk.jpg"`,
	} {
		if !strings.Contains(extracted.ContentHTML, want) {
			t.Errorf("content_html is missing %s:\n%s", want, extracted.ContentHTML)
		}
	}
	if strings.Contains(extracted.ContentHTML, `href="/essays/`) ||
		strings.Contains(extracted.ContentHTML, `src="../img/`) {
		t.Errorf("a relative address survived into content_html:\n%s", extracted.ContentHTML)
	}
}

// TestATrackingPixelIsNotTheLeadImageAfterExtraction goes through the whole
// extraction rather than a parsed fragment: the extractors drop width and
// height from the content tree, so a fragment-level test passes while the real
// path picks the pixel.
func TestATrackingPixelIsNotTheLeadImageAfterExtraction(t *testing.T) {
	prose := `<p>` + strings.Repeat("Enough prose to extract at all. ", 20) + `</p>`
	page := []byte(`<!doctype html><html><head><title>Pixel</title></head><body><article>` +
		`<h1>Pixel</h1><img src="/px.gif" width="1" height="1">` + prose +
		`<img src="/img/cover.jpg" alt="cover">` + prose + prose +
		`</article></body></html>`)
	pageURL, err := url.Parse("https://pages.example/post")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	extracted, err := libraryExtractPage(page, pageURL, "")
	if err != nil {
		t.Fatalf("libraryExtractPage: %v", err)
	}
	if extracted.LeadImage != "https://pages.example/img/cover.jpg" {
		t.Errorf("lead_image = %q, want the cover rather than the tracking pixel", extracted.LeadImage)
	}
}

func TestEveryHttpImageIsRewrittenToHttps(t *testing.T) {
	page := []byte(`<!doctype html><html><head><title>Images</title></head><body><article>` +
		`<h1>Images</h1><p>` + strings.Repeat("Enough prose to extract at all. ", 20) + `</p>` +
		`<p><img src="http://cdn.example/one.png" alt="one"></p>` +
		`<p><img src="//cdn.example/two.png" alt="two"></p>` +
		`<p><img src="https://cdn.example/three.png" alt="three"></p>` +
		`</article></body></html>`)
	pageURL, err := url.Parse("https://pages.example/images")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	extracted, err := libraryExtractPage(page, pageURL, "")
	if err != nil {
		t.Fatalf("libraryExtractPage: %v", err)
	}
	if strings.Contains(extracted.ContentHTML, `src="http://`) {
		t.Errorf("a plain http image survived:\n%s", extracted.ContentHTML)
	}
	for _, want := range []string{
		`src="https://cdn.example/one.png"`,
		`src="https://cdn.example/two.png"`,
		`src="https://cdn.example/three.png"`,
	} {
		if !strings.Contains(extracted.ContentHTML, want) {
			t.Errorf("content_html is missing %s:\n%s", want, extracted.ContentHTML)
		}
	}
	if extracted.LeadImage != "https://cdn.example/one.png" {
		t.Errorf("lead_image = %q, want the first usable article image", extracted.LeadImage)
	}
}

// TestHeadingsCarryTheirAnchors is the contract between content_headings and
// content_html: every heading in the table has an id in the markup equal to its
// anchor, a repeated heading text gets -2, and a page's own id elsewhere is
// gone.
func TestHeadingsCarryTheirAnchors(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "essay")
	if len(extracted.Headings) < 3 {
		t.Fatalf("the essay fixture produced %d headings, want its title and two sections:\n%#v",
			len(extracted.Headings), extracted.Headings)
	}
	for _, heading := range extracted.Headings {
		if !libraryAnchorIDPattern.MatchString(heading.Anchor) {
			t.Errorf("the anchor %q of %q is not in the shape the sanitizer allows",
				heading.Anchor, heading.Text)
		}
		if want := `id="` + heading.Anchor + `"`; !strings.Contains(extracted.ContentHTML, want) {
			t.Errorf("content_html carries no %s for the heading %q:\n%s",
				want, heading.Text, extracted.ContentHTML)
		}
	}
	repeated := []libraryHeading{}
	for _, heading := range extracted.Headings {
		if heading.Text == "What a note is for" {
			repeated = append(repeated, heading)
		}
	}
	if len(repeated) != 2 {
		t.Fatalf("the fixture's repeated heading appears %d times, want twice:\n%#v",
			len(repeated), extracted.Headings)
	}
	if repeated[0].Anchor != "what-a-note-is-for" {
		t.Errorf("the first occurrence's anchor = %q, want the plain slug", repeated[0].Anchor)
	}
	if repeated[1].Anchor != "what-a-note-is-for-2" {
		t.Errorf("the second occurrence's anchor = %q, want the slug with -2", repeated[1].Anchor)
	}
	if strings.Contains(extracted.ContentHTML, `id="intro"`) {
		t.Errorf("the page's own id on a paragraph survived sanitization:\n%s", extracted.ContentHTML)
	}
}

func TestHeadingAnchorsStripAccentsAndPunctuation(t *testing.T) {
	for _, tc := range []struct {
		text string
		want string
	}{
		{"Instalação e Configuração", "instalacao-e-configuracao"},
		{"What a note is for", "what-a-note-is-for"},
		{"  Mixed   spacing  ", "mixed-spacing"},
		{"C++ / Rust: a comparison", "c-rust-a-comparison"},
		{"Ação, reação & efeito", "acao-reacao-efeito"},
		{"...", ""},
	} {
		if got := libraryAnchorSlug(tc.text); got != tc.want {
			t.Errorf("libraryAnchorSlug(%q) = %q, want %q", tc.text, got, tc.want)
		}
	}
}

func TestAHeadingWithNoSluggableTextStillGetsAnAnchor(t *testing.T) {
	page := []byte(`<!doctype html><html><head><title>Odd</title></head><body><article>` +
		`<h1>Odd</h1><p>` + strings.Repeat("Enough prose to extract at all. ", 20) + `</p>` +
		`<h2>***</h2><p>` + strings.Repeat("More prose under the odd heading. ", 20) + `</p>` +
		`</article></body></html>`)
	pageURL, err := url.Parse("https://pages.example/odd")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	extracted, err := libraryExtractPage(page, pageURL, "")
	if err != nil {
		t.Fatalf("libraryExtractPage: %v", err)
	}
	for _, heading := range extracted.Headings {
		if heading.Anchor == "" {
			t.Fatalf("the heading %q got no anchor at all", heading.Text)
		}
		if !libraryAnchorIDPattern.MatchString(heading.Anchor) {
			t.Errorf("the anchor %q is not in the shape the sanitizer allows", heading.Anchor)
		}
	}
}

func TestReadingMinutesRoundUp(t *testing.T) {
	for _, tc := range []struct {
		words int
		want  int
	}{
		{0, 0},
		{1, 1},
		{229, 1},
		{230, 1},
		{231, 2},
		{460, 2},
		{461, 3},
	} {
		text := strings.TrimSpace(strings.Repeat("word ", tc.words))
		if got := libraryReadingMinutes(text); got != tc.want {
			t.Errorf("libraryReadingMinutes(%d words) = %d, want %d", tc.words, got, tc.want)
		}
	}
}

// libraryParseFragment parses a markup fragment and returns the one element it
// wraps, so a cleanup rule can be exercised on a tree the size of the rule
// rather than on a whole page.
func libraryParseFragment(t *testing.T, markup string) *html.Node {
	t.Helper()
	doc, err := html.Parse(strings.NewReader(markup))
	if err != nil {
		t.Fatalf("parsing the fragment: %v", err)
	}
	var found *html.Node
	libraryWalkElements(doc, func(node *html.Node) {
		if found == nil && libraryTagName(node) == "div" {
			found = node
		}
	})
	if found == nil {
		t.Fatalf("the fragment carries no <div> wrapper: %s", markup)
	}
	return found
}

// TestTheSanitizerStripsEveryHostileConstruct feeds the policy the hostile
// markup directly, because the fixture above cannot tell the sanitizer from the
// extractor.
//
// Running the hostile page through the whole pipeline is still worth doing --
// it proves what actually gets stored -- but trafilatura drops a script, an
// event handler and an iframe on its own, so the fixture stays clean even with
// the policy opened up. The guarantee belongs to the sanitizer, because stored
// content is read by every consumer without one of their own, and that is what
// this exercises.
func TestTheSanitizerStripsEveryHostileConstruct(t *testing.T) {
	markup := `<h2 id="hostile">Hostile</h2>` +
		`<script>alert('script')</script>` +
		`<p onclick="alert('onclick')">clickable</p>` +
		`<p><img src="https://x.example/a.png" onerror="alert('onerror')" alt="a"></p>` +
		`<p><a href="javascript:alert('href')">link</a></p>` +
		`<iframe src="https://x.example/f.html"></iframe>` +
		`<object data="https://x.example/o.swf"><param name="movie" value="x"></object>` +
		`<embed src="https://x.example/e.swf">` +
		`<form action="https://x.example/collect"><input type="password" name="p"></form>` +
		`<p style="background-image: url('https://x.example/p.png')">styled</p>`
	sanitized := libraryExtractPolicy().Sanitize(markup)

	for _, hostile := range libraryHostilePatterns {
		if hostile.pattern.MatchString(sanitized) {
			t.Errorf("the sanitizer let %s through:\n%s", hostile.name, sanitized)
		}
	}
	// The text of every element that was only carrying an attack has to
	// survive, or the policy is dropping articles rather than cleaning them.
	for _, kept := range []string{"clickable", "link", "styled", "Hostile"} {
		if !strings.Contains(sanitized, kept) {
			t.Errorf("the sanitizer removed the text %q along with the attack:\n%s", kept, sanitized)
		}
	}
}

func TestALeadImageKeepsOnlyHTTPAndHTTPSSchemes(t *testing.T) {
	pageURL, err := url.Parse("https://pages.example/post")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	for _, tc := range []struct{ declared, want string }{
		{"javascript:alert(1)", ""},
		{"data:image/png;base64,AAAA", ""},
		{"ftp://pages.example/a.png", ""},
		{"http://pages.example/a.png", "https://pages.example/a.png"},
		{"/a.png", "https://pages.example/a.png"},
	} {
		declared := libraryDeclarations{meta: map[string]string{"og:image": tc.declared}}
		article := libraryParseFragment(t, `<div><img src="https://pages.example/article.png"></div>`)
		got := libraryResolveMetadata(declared, trafilatura.Metadata{}, pageURL, article).LeadImage
		if got != tc.want {
			t.Errorf("og:image %q stored as %q, want %q", tc.declared, got, tc.want)
		}
	}
}

func TestALeadImageFallsBackToTheFirstUsableArticleImage(t *testing.T) {
	pageURL, err := url.Parse("https://pages.example/articles/notes")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	for _, tc := range []struct {
		name   string
		markup string
		want   string
	}{
		{
			name:   "relative source is made absolute",
			markup: `<img src="/images/cover.png">`,
			want:   "https://pages.example/images/cover.png",
		},
		{
			name:   "data source is skipped",
			markup: `<img src="data:image/gif;base64,AAAA"><img src="/images/cover.png">`,
			want:   "https://pages.example/images/cover.png",
		},
		{
			name:   "one pixel width is skipped",
			markup: `<img src="/images/pixel.gif" width="1" height="100"><img src="/images/cover.png">`,
			want:   "https://pages.example/images/cover.png",
		},
		{
			name:   "one pixel height is skipped",
			markup: `<img src="/images/pixel.gif" width="100" height="1"><img src="/images/cover.png">`,
			want:   "https://pages.example/images/cover.png",
		},
		{
			name:   "no usable image leaves the field empty",
			markup: `<img src="data:image/gif;base64,AAAA"><img src="/images/pixel.gif" width="1">`,
			want:   "",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			article := libraryParseFragment(t, `<div>`+tc.markup+`</div>`)
			got := libraryResolveMetadata(libraryDeclarations{meta: map[string]string{}},
				trafilatura.Metadata{}, pageURL, article).LeadImage
			if got != tc.want {
				t.Errorf("lead image = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestAnEmptyHeadingLosesThePageSuppliedID(t *testing.T) {
	div := libraryParseFragment(t, `<div><h2 id="planted"></h2><h2>Real</h2></div>`)
	headings := libraryAssignHeadingAnchors(div)
	if len(headings) != 1 || headings[0].Anchor != "real" {
		t.Fatalf("headings = %#v, want only the non-empty one", headings)
	}
	libraryWalkElements(div, func(node *html.Node) {
		if libraryTagName(node) != "h2" || libraryNodeText(node) != "" {
			return
		}
		for _, attr := range node.Attr {
			if attr.Key == "id" {
				t.Errorf("the empty heading kept the page's id %q", attr.Val)
			}
		}
	})
}

func TestHeadingAnchorsNeverCollide(t *testing.T) {
	div := libraryParseFragment(t, `<div><h2>A</h2><h2>A</h2><h2>A 2</h2></div>`)
	seen := map[string]bool{}
	for _, heading := range libraryAssignHeadingAnchors(div) {
		if seen[heading.Anchor] {
			t.Errorf("the anchor %q was handed out twice", heading.Anchor)
		}
		seen[heading.Anchor] = true
	}
	if len(seen) != 3 {
		t.Errorf("got %d distinct anchors, want 3: %v", len(seen), seen)
	}
}

// libraryEncodedPage renders a page in one of the legacy encodings, so a test
// over a non-UTF-8 fixture reads as the bytes a server would send rather than
// as an escaped literal.
func libraryEncodedPage(t *testing.T, enc encoding.Encoding, declaredCharset, title string) []byte {
	t.Helper()
	head := `<!doctype html><html><head>`
	if declaredCharset != "" {
		head += `<meta charset="` + declaredCharset + `">`
	}
	page := head + `<title>` + title + `</title>` +
		`<meta property="og:title" content="` + title + `"></head><body><article><h1>` + title + `</h1><p>` +
		strings.Repeat("Texto suficiente para o extrator aceitar a pagina. ", 20) +
		`</p></article></body></html>`
	encoded, _, err := transform.Bytes(enc.NewEncoder(), []byte(page))
	if err != nil {
		t.Fatalf("encoding the page: %v", err)
	}
	return encoded
}

// TestAPageIsDecodedByItsDeclaredCharset is the latin-1 defect: the body text
// always arrived decoded, because the extractors do that themselves, while the
// declarations were parsed straight off the raw bytes -- so the title of a page
// written in ISO-8859-1 was stored as the invalid UTF-8 those bytes are.
//
// The last two cases are the other half of the fix: a UTF-8 page and a page
// that declares nothing have to come out exactly as before, which is why they
// are asserted here against the same decoder rather than taken on trust.
func TestAPageIsDecodedByItsDeclaredCharset(t *testing.T) {
	pageURL, err := url.Parse("https://pages.example/acentuacao")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	const accented = "Acentuação"
	for _, tc := range []struct {
		name        string
		page        []byte
		contentType string
		want        string
	}{
		{
			name: "latin-1 declared in a meta charset",
			page: libraryEncodedPage(t, charmap.ISO8859_1, "iso-8859-1", accented),
			want: accented,
		},
		{
			name:        "latin-1 declared only in the response header",
			page:        libraryEncodedPage(t, charmap.ISO8859_1, "", accented),
			contentType: "text/html; charset=iso-8859-1",
			want:        accented,
		},
		{
			name: "windows-1252 declared in a meta charset",
			page: libraryEncodedPage(t, charmap.Windows1252, "windows-1252", accented),
			want: accented,
		},
		{
			name: "a UTF-8 page is unchanged",
			page: []byte(libraryTestPage(accented)),
			want: accented,
		},
		{
			name: "a page declaring no charset is unchanged",
			page: []byte(libraryTestPage("Plain ASCII Title")),
			want: "Plain ASCII Title",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			extracted, err := libraryExtractPage(tc.page, pageURL, tc.contentType)
			if err != nil {
				t.Fatalf("libraryExtractPage: %v", err)
			}
			if extracted.Title != tc.want {
				t.Errorf("title = %q (% x), want %q", extracted.Title, extracted.Title, tc.want)
			}
			if !utf8.ValidString(extracted.Title) {
				t.Errorf("title is not valid UTF-8: % x", extracted.Title)
			}
		})
	}
}

// TestASnapshotIsExtractedAgainstItsFinalURL is the redirect defect at the unit
// level: the same bytes, extracted against the address a redirect chain ended
// at, resolve their links and their site there and not at the short link the
// person saved.
func TestASnapshotIsExtractedAgainstItsFinalURL(t *testing.T) {
	page, _, _ := libraryReadFixture(t, "go-blog")

	shortened, err := url.Parse("https://redirector.example/abc123")
	if err != nil {
		t.Fatalf("parsing the short link: %v", err)
	}
	final, err := url.Parse("https://go.dev/blog/go1.22")
	if err != nil {
		t.Fatalf("parsing the final URL: %v", err)
	}

	fromShortLink, err := libraryExtractPage(page, shortened, "")
	if err != nil {
		t.Fatalf("extracting against the short link: %v", err)
	}
	if fromShortLink.Site != "redirector.example" {
		t.Fatalf("site = %q against the short link; the fixture no longer shows the defect this guards",
			fromShortLink.Site)
	}

	fromFinal, err := libraryExtractPage(page, final, "")
	if err != nil {
		t.Fatalf("extracting against the final URL: %v", err)
	}
	if fromFinal.Site != "go.dev" {
		t.Errorf("site = %q, want go.dev", fromFinal.Site)
	}
	if strings.Contains(fromFinal.ContentHTML, "redirector.example") {
		t.Errorf("the short link's host survived into content_html:\n%s", fromFinal.ContentHTML)
	}
	if !strings.Contains(fromFinal.ContentHTML, `href="https://go.dev/`) {
		t.Errorf("no link resolved under https://go.dev/:\n%s", fromFinal.ContentHTML)
	}
}

// TestTheExtractionBaseURLPrefersTheRecordedFinalURL covers the choice on its
// own, including the two readings that have to fall back: a snapshot with no
// recorded final URL, and a recorded value that does not parse as an absolute
// address. Meta is open JSON, so the second is a value a caller can really see.
func TestTheExtractionBaseURLPrefersTheRecordedFinalURL(t *testing.T) {
	for _, tc := range []struct {
		name     string
		itemURL  string
		finalURL string
		want     string
	}{
		{"the final URL wins", "https://t.co/abc", "https://go.dev/blog/go1.22", "https://go.dev/blog/go1.22"},
		{"no final URL recorded", "https://go.dev/blog/go1.22", "", "https://go.dev/blog/go1.22"},
		{"a relative final URL is ignored", "https://go.dev/blog/go1.22", "/blog/go1.22", "https://go.dev/blog/go1.22"},
		{"an unparseable final URL is ignored", "https://go.dev/blog/go1.22", "ht tp://%zz", "https://go.dev/blog/go1.22"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := librarySnapshotBaseURL(tc.itemURL, tc.finalURL)
			if err != nil {
				t.Fatalf("librarySnapshotBaseURL: %v", err)
			}
			if got.String() != tc.want {
				t.Errorf("base = %q, want %q", got, tc.want)
			}
		})
	}
}

// libraryGluedBlocksPage is the shape of a minified page and of what the
// browser extension captures: block-level tags with nothing at all between
// them. separator is what is written between the tags, so the same page can be
// extracted minified and pretty-printed.
func libraryGluedBlocksPage(separator string) []byte {
	return []byte(`<html><body><article>` + separator +
		`<h1>Título</h1>` + separator +
		`<p>Primeiro parágrafo fala do mar inteiro sem parar.</p>` + separator +
		`<p>Segundo parágrafo descreve montanhas geladas onde lobos cinzentos caçam renas.</p>` + separator +
		`</article></body></html>`)
}

func libraryExtractGluedBlocks(t *testing.T, separator string) libraryExtracted {
	t.Helper()
	pageURL, err := url.Parse("https://pages.example/glued")
	if err != nil {
		t.Fatalf("parsing the page URL: %v", err)
	}
	extracted, err := libraryExtractPage(libraryGluedBlocksPage(separator), pageURL, "")
	if err != nil {
		t.Fatalf("extracting the glued page: %v", err)
	}
	return extracted
}

// TestAdjacentBlocksAreSeparatedWithNoWhitespaceInTheMarkup is the criterion
// search, the reading time and a highlight all rest on: the last word of a
// block never touches the first word of the next, whatever the markup looked
// like. The words are checked rather than the block count, because gluing them
// is what makes a word unsearchable and a selection unanchored.
func TestAdjacentBlocksAreSeparatedWithNoWhitespaceInTheMarkup(t *testing.T) {
	text := libraryExtractGluedBlocks(t, "").ContentText
	for _, glued := range []string{"TítuloPrimeiro", "parar.Segundo"} {
		if strings.Contains(text, glued) {
			t.Errorf("two blocks came out glued as %q:\n%q", glued, text)
		}
	}
	for _, want := range []string{"Título\n\nPrimeiro", "parar.\n\nSegundo"} {
		if !strings.Contains(text, want) {
			t.Errorf("content_text does not separate %q:\n%q", want, text)
		}
	}
}

// TestTheMarkupsWhitespaceDoesNotChangeTheExtractedText states the rule the
// one above is a case of. A page carrying newlines between its tags and the
// same page minified are the same article, so they must store the same text --
// otherwise a word is searchable on one spelling of a page and not on the
// other.
func TestTheMarkupsWhitespaceDoesNotChangeTheExtractedText(t *testing.T) {
	minified := libraryExtractGluedBlocks(t, "").ContentText
	spaced := libraryExtractGluedBlocks(t, "\n").ContentText
	if minified != spaced {
		t.Errorf("the minified page stored\n%q\nand the spaced one stored\n%q", minified, spaced)
	}
}

// TestAPageWhoseBlocksSurviveKeepsTrafilaturasReading is the other side of the
// separation rule: the second pass is for a page whose blocks were run
// together, and a page extracted correctly today must not be routed through it.
// The essay fixture's text begins at its own heading, which is where
// trafilatura starts it; go-readability's reading of the same page opens on the
// date line above the title instead, so the first block says which reading was
// stored.
func TestAPageWhoseBlocksSurviveKeepsTrafilaturasReading(t *testing.T) {
	extracted, _ := libraryExtractFixture(t, "essay")
	blocks := strings.Split(extracted.ContentText, "\n\n")
	if len(blocks) < 2 {
		t.Fatalf("the essay fixture came out as %d block(s):\n%q", len(blocks), extracted.ContentText)
	}
	if blocks[0] != "On Keeping Notes You Will Read Again" {
		t.Errorf("the essay's text opens on %q, want its heading", blocks[0])
	}
}
