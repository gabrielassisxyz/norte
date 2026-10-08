import { expect, test, type Page } from '@playwright/test'

import { PASSAGE, articleHtml } from './helpers/article'
import { api, seedArticle, startNorte, type NorteServer } from './helpers/norteServer'

/**
 * A passage selected at the very start of a paragraph, highlighted and marked.
 *
 * This is the one place the context a highlight stores is produced the way a
 * person produces it. The reader reads it off the DOM, where two adjacent
 * paragraphs are separated by the markup and by nothing in the text, so a
 * selection that starts a few characters into a paragraph stores a context
 * reaching back across that break with no whitespace in it — while the text the
 * server anchors against separates the same two blocks with a newline. A
 * component test cannot produce that: the context comes from the browser's own
 * Range, and the text comes from the server's extraction.
 *
 * The mark is the user-visible half of the claim and the stored status is the
 * server's, and the two are asserted together because either one alone has been
 * green while the other was wrong.
 */
let server: NorteServer

interface StoredHighlight {
  exact: string
  status: string
  position_hint: number
}

interface NotesPage<T> {
  items: T[]
}

test.beforeAll(async () => {
  server = await startNorte()
})

test.afterAll(async () => {
  await server?.stop()
})

/** Every run of whitespace is one space, as both sides of the comparison have it. */
function collapse(value: string): string {
  return value
    .split(/\s+/u)
    .filter((word) => word !== '')
    .join(' ')
}

/**
 * Select `length` code points of the article starting `at` code points into the
 * passage the paragraph begins with.
 *
 * The Range is built in the page rather than dragged, because a drag cannot
 * land on an exact offset; `selectionchange` is what the reader listens to, and
 * it is the event every way of selecting fires.
 */
async function selectInsideParagraph(page: Page, opening: string, skip: number): Promise<void> {
  await page.evaluate(
    ({ opening, skip }) => {
      const article = document.querySelector('.article-content')
      if (!article) throw new Error('the article is not on the page')
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = node.textContent ?? ''
        const at = data.indexOf(opening)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at + skip)
        range.setEnd(node, at + opening.length)
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        return
      }
      throw new Error(`the article does not hold ${opening}`)
    },
    { opening, skip }
  )
}

test.describe('a highlight whose context crosses a paragraph boundary', () => {
  test('marks a passage selected within the first ten characters of a paragraph', async ({ page }) => {
    const title = 'Trecho na borda do parágrafo'
    const article = await seedArticle(server.baseURL, {
      url: 'https://exemplo.invalid/borda-do-paragrafo',
      title,
      html: articleHtml({ title })
    })

    // Four code points into the paragraph PASSAGE opens, so the context the
    // browser hands the reader reaches back over the paragraph break. The
    // selection is a sentence nothing else in the article repeats, which is
    // what lets a unique occurrence be found at all.
    const skip = 4
    const selected = [...PASSAGE].slice(skip).join('')

    const item = await api<{ content_text: string }>(server.baseURL, `/api/library/items/${article.id}`)
    const text = collapse(item.content_text)
    // The offset is counted here rather than taken from the answer: an
    // assertion against whatever came back would hold for any number. The
    // article carries nothing outside the basic plane, so an index into this
    // string is the code-point offset the server reports.
    expect([...text]).toHaveLength(text.length)
    const expectedHint = text.indexOf(selected)
    expect(expectedHint).toBeGreaterThan(0)
    // The break really is inside the stored prefix: the extracted text has a
    // space where the DOM the reader read has nothing at all.
    expect(text.slice(expectedHint - skip, expectedHint)).toBe(PASSAGE.slice(0, skip))
    expect(text[expectedHint - skip - 1]).toBe(' ')

    await page.goto(`${server.baseURL}/biblioteca/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await selectInsideParagraph(page, PASSAGE, skip)
    const destacar = page.locator('.notes-selection-bar [data-action="destacar"]')
    await expect(destacar).toBeEnabled()
    await destacar.click()

    // The server's half: the passage was placed, at the offset counted above.
    await expect
      .poll(async () => {
        const stored = await api<NotesPage<StoredHighlight>>(
          server.baseURL,
          `/api/notes/highlights?item_id=${article.id}`
        )
        return stored.items.map((highlight) => `${highlight.status}@${highlight.position_hint}`)
      })
      .toEqual([`anchored@${expectedHint}`])

    // The reader's half: the mark is on the words, and nothing is listed as a
    // passage that is no longer in the text.
    const marked = page.locator(`mark[data-notes-passage="${selected}"]`)
    await expect(marked.first()).toBeVisible()
    expect(
      (await marked.allTextContents()).join('')
    ).toBe(selected)
    await expect(page.locator('.notes-reader-orphans')).toHaveCount(0)
  })
})
