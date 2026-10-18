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
    const title = 'A passage at the edge of the paragraph'
    const article = await seedArticle(server.baseURL, {
      url: 'https://example.invalid/passage-edge',
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

    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await selectInsideParagraph(page, PASSAGE, skip)
    // Nothing is clicked: releasing the selection is what highlights it, and
    // the toolbar over the passage is how that is visible.
    await expect(page.locator('.notes-seltool')).toBeVisible()

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

    // A note written in the toolbar, against the highlight it just made.
    await page.locator('[data-action="toolbar-annotate"]').click()
    await page.locator('.notes-seltool-field').fill('Worth coming back to.')
    await page.locator('[data-action="toolbar-save-annotation"]').click()
    await expect
      .poll(async () => {
        const stored = await api<NotesPage<{ text: string; highlight_id?: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        return stored.items.map((annotation) => [annotation.text, annotation.highlight_id !== undefined])
      })
      .toEqual([['Worth coming back to.', true]])

    // And after a reload the note is in the margin under its own passage,
    // which is the half a request cannot show: the note is placed by the
    // passage it hangs on, not by the order it was written in.
    await page.reload()
    await expect(page.locator('.article-content')).toContainText(PASSAGE)
    const row = page.locator('[data-entry="annotation"]')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Worth coming back to.')
    await expect(row).toContainText(selected)
  })
})

/**
 * A note written before there was a passage, pinned to one afterwards.
 *
 * It belongs with a real server and a real selection for the same reason the
 * case above does: what the note ends up hanging on is a highlight the browser
 * produced from its own Range and the server placed in its own extraction, and
 * the half that only a reload can show — the note listed under its passage
 * rather than among the loose ones — is read back from storage.
 */
test.describe('a loose note attached to a passage chosen afterwards', () => {
  test('writes the note first, picks the passage second, and keeps them together', async ({ page }) => {
    const title = 'A note that found its passage'
    const article = await seedArticle(server.baseURL, {
      url: 'https://example.invalid/attach-later',
      title,
      html: articleHtml({ title })
    })

    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await page.locator('#notes-reader-annotation').fill('A thought with no passage yet.')
    await page.locator('[data-action="annotate"]').click()
    const row = page.locator('[data-entry="annotation"]')
    await expect(row).toHaveCount(1)
    // Loose: nothing in the text to jump to yet.
    await expect(row.locator('[data-action="jump"]')).toHaveCount(0)

    await row.locator('[data-action="attach-passage"]').click()
    await expect(page.locator('[data-notes-attach]')).toContainText('Select the passage for this note')

    await selectInsideParagraph(page, PASSAGE, 0)

    await expect
      .poll(async () => {
        const stored = await api<NotesPage<{ text: string; highlight_id?: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        return stored.items.map((annotation) => [annotation.text, annotation.highlight_id !== undefined])
      })
      .toEqual([['A thought with no passage yet.', true]])
    // The passage layer left this selection to the panel, so no toolbar opened
    // over it and the banner is gone.
    await expect(page.locator('.notes-seltool')).toHaveCount(0)
    await expect(page.locator('[data-notes-attach]')).toHaveCount(0)

    await page.reload()
    await expect(page.locator('.article-content')).toContainText(PASSAGE)
    const pinned = page.locator('[data-entry="annotation"]')
    await expect(pinned).toHaveCount(1)
    await expect(pinned).toContainText('A thought with no passage yet.')
    await expect(pinned).toContainText(PASSAGE)
    await expect(pinned.locator('[data-action="jump"]')).toHaveCount(1)
    await expect(page.locator(`mark[data-notes-passage="${PASSAGE}"]`).first()).toBeVisible()
  })
})

/**
 * Select from the start of `from` to the end of `to`, across however many text
 * nodes lie between them.
 *
 * It is a second helper rather than a parameter on the one above because the
 * range a correction needs crosses the mark the first highlight left in the
 * text: a passage already marked sits inside a `mark` element, so its words and
 * the words after it are in different text nodes, and a Range over both is the
 * only way to select what the person drags over.
 */
async function selectAcrossNodes(page: Page, from: string, to: string): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const article = document.querySelector('.article-content')
      if (!article) throw new Error('the article is not on the page')
      const nodes: Text[] = []
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
      const start = nodes
        .map((node) => ({ node, at: (node.textContent ?? '').indexOf(from) }))
        .find((candidate) => candidate.at >= 0)
      const end = nodes
        .map((node) => ({ node, at: (node.textContent ?? '').indexOf(to) }))
        .find((candidate) => candidate.at >= 0)
      if (!start || !end) throw new Error(`the article does not hold ${from} and ${to}`)
      const range = document.createRange()
      range.setStart(start.node, start.at)
      range.setEnd(end.node, end.at + to.length)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    },
    { from, to }
  )
}

/**
 * A mark that caught too few words, corrected without losing the note on it.
 *
 * It belongs with a real server for the reason the two cases above do: what the
 * highlight ends up holding is a passage the browser produced from its own
 * Range over the marked text, and the half only a reload can show — the note
 * still in the margin, quoting the corrected words — is read back from storage.
 */
test.describe("a highlight's passage re-selected after a note was written on it", () => {
  test('moves the passage, keeps the note, and quotes the new words after a reload', async ({ page }) => {
    const title = 'A mark that caught too few words'
    const article = await seedArticle(server.baseURL, {
      url: 'https://example.invalid/reselect-passage',
      title,
      html: articleHtml({ title })
    })
    const CONTINUES = 'Depois dela o texto continua,'
    const corrected = collapse(`${PASSAGE} ${CONTINUES}`)

    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await selectInsideParagraph(page, PASSAGE, 0)
    await expect(page.locator('.notes-seltool')).toBeVisible()
    await page.locator('[data-action="toolbar-annotate"]').click()
    await page.locator('.notes-seltool-field').fill('The point, with the words it was about.')
    await page.locator('[data-action="toolbar-save-annotation"]').click()
    await expect
      .poll(async () => {
        const stored = await api<NotesPage<{ highlight_id?: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        return stored.items.map((annotation) => annotation.highlight_id !== undefined)
      })
      .toEqual([true])
    const before = await api<NotesPage<StoredHighlight & { id: string }>>(
      server.baseURL,
      `/api/notes/highlights?item_id=${article.id}`
    )
    const highlightId = before.items[0].id

    // The correction itself: the toolbar for the marked passage, its More menu,
    // and then the longer passage dragged over in the article.
    await page.locator('mark[data-notes-passage]').first().click()
    await page.locator('[aria-label="More"]').click()
    await page.locator('[data-action="toolbar-reselect"]').click()
    await expect(page.locator('[data-notes-reselect]')).toContainText('Select the new passage')

    await selectAcrossNodes(page, PASSAGE, CONTINUES)

    // The same highlight, on the new words, placed in the server's own text.
    await expect
      .poll(async () => {
        const stored = await api<NotesPage<StoredHighlight & { id: string }>>(
          server.baseURL,
          `/api/notes/highlights?item_id=${article.id}`
        )
        return stored.items.map((highlight) => [highlight.id, highlight.exact, highlight.status])
      })
      .toEqual([[highlightId, corrected, 'anchored']])
    const item = await api<{ content_text: string }>(server.baseURL, `/api/library/items/${article.id}`)
    const text = collapse(item.content_text)
    expect([...text]).toHaveLength(text.length)
    const stored = await api<NotesPage<StoredHighlight>>(
      server.baseURL,
      `/api/notes/highlights?item_id=${article.id}`
    )
    expect(stored.items[0].position_hint).toBe(text.indexOf(corrected))
    // The note is still the same note, on the same highlight.
    await expect
      .poll(async () => {
        const kept = await api<NotesPage<{ text: string; highlight_id?: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        return kept.items.map((annotation) => [annotation.text, annotation.highlight_id])
      })
      .toEqual([['The point, with the words it was about.', highlightId]])
    await expect(page.locator('[data-notes-reselect]')).toHaveCount(0)

    await page.reload()
    await expect(page.locator('.article-content')).toContainText(PASSAGE)
    const row = page.locator('[data-entry="annotation"]')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('The point, with the words it was about.')
    await expect(row).toContainText(corrected)
    await expect(page.locator('.notes-reader-orphans')).toHaveCount(0)
    const marked = page.locator('mark[data-notes-passage]')
    expect(collapse((await marked.allTextContents()).join(''))).toBe(corrected)
  })
})
