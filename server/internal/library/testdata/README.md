# The extraction corpus

`pages/` holds one HTML file per page shape the extraction has to survive, and
`golden/` holds one JSON file per page with the metadata that page is expected to
produce. No test here reaches the network: a fixture is read off the disk, and
the fetch tests inject a resolver and a dialer that point a public-looking
hostname at a listener the test started.

## What each fixture is for

| Fixture | Shape | Why it is in the corpus |
| --- | --- | --- |
| `essay.html` | A long single-column essay, no semantic wrappers, byline and date in the body | Also carries the relative link, the relative image, the two headings with identical text and the page-supplied `id` on a paragraph |
| `newsletter.html` | A hosted newsletter post | The subscription pitch the cleanup rules remove, and the prose mention of a newsletter they must not |
| `news-article.html` | A newspaper article with a standfirst and a pull quote | The previous/next strip the cleanup rules remove, and the sentence ending on "next" they must not |
| `bliki.html` | A personal site that is neither a blog nor a wiki, with a table in the body | A table has to survive sanitization intact |
| `gwern-note.html` | gwern.net, a dense page with a large apparatus around the article | A real page that declares its metadata thoroughly and unusually |
| `go-blog.html` | The Go blog | A real page that declares no author and no date in metadata at all |
| `wikipedia-article.html` | A Wikipedia article | A real page whose title is declared with the site appended |
| `hostile.html` | Every way a page could ask for code to run inside Norte, at once | The sanitizer is proved against an attempt, not against an absence |
| `codeblocks.html` | An article whose point is its code samples | `<pre><code>` and its indentation have to come through |

## Where the real pages came from, and under what licence

Three fixtures are real pages, captured as served and committed unmodified.
Norte's repository is public, so only pages whose licence permits
redistribution are here.

- `gwern-note.html` — <https://gwern.net/note/faster>, "Computer Optimization:
  Your Computer Is Faster Than You Think" by Gwern Branwen. The page declares
  `dc.rights` as [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
  which waives copyright.
- `go-blog.html` — <https://go.dev/blog/go1.22>, "Go 1.22 is released!" by Eli
  Bendersky on behalf of the Go team. Content on go.dev is licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the Go Authors are
  the attribution this file carries.
- `wikipedia-article.html` — <https://simple.wikipedia.org/wiki/Hash_function>,
  "Hash function" from Simple English Wikipedia, by its contributors, licensed
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Its
  revision history, which is the authorship record, is at
  <https://simple.wikipedia.org/w/index.php?title=Hash_function&action=history>.

The remaining six are written here, with invented text, invented authors and
invented publications. Four of them stand in for shapes whose originals may not
be redistributed — an essay, a hosted newsletter post, a newspaper article and a
bliki entry — and reproduce the structure that matters: where the byline sits,
which metadata is declared and which is only in the body, and what template
furniture surrounds the article.

## How a golden file is written

By hand, from what the page itself declares, and never by running the extractor
and copying its answer. The point of the corpus is to notice when the extraction
changes; a golden produced by the thing it is meant to check notices nothing.

Each file carries the `url` the page was saved from — which is also what a
relative link and a relative image resolve against — and the five metadata
fields the extraction stores.

Two things are worth knowing when reading a golden against its page:

- **A date with no time of day is a truncation, not a claim.** A page that
  declares `article:published_time` gives an instant and the golden carries it
  in full. A page whose only date is prose under the title — the Go blog's "6
  February 2024" — is read by htmldate, which answers with a date, so the golden
  reads midnight UTC. Nothing asserts the article appeared at midnight.
- **An empty `author` means the page declared none.** The Go blog and the
  Wikipedia article both put a byline in the body and neither declares one in
  metadata, and Norte does not store a byline guessed out of prose. See the
  comment at the top of `../metadata.go` for what that rule is worth and what it
  costs.
