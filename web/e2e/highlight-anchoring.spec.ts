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

/**
 * The two ends of the passage, in viewport coordinates.
 *
 * A drag is the only way to prove what a held mouse button does, and a drag
 * needs points rather than nodes: the rectangles of a Range over the passage
 * are where its first and last glyph are drawn, which is where a person would
 * press and release.
 */
async function passageEnds(page: Page, needle: string): Promise<{
  from: { x: number; y: number }
  to: { x: number; y: number }
}> {
  const ends = await page.evaluate((text) => {
    const article = document.querySelector('.article-content')
    if (!article) throw new Error('the article is not on the page')
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(text)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      const rects = Array.from(range.getClientRects())
      const first = rects[0]
      const last = rects[rects.length - 1]
      // Inside the glyph box on both ends: a point on the boundary hits the
      // character next to the one meant.
      return {
        from: { x: first.left + 1, y: first.top + first.height / 2 },
        to: { x: last.right - 1, y: last.top + last.height / 2 }
      }
    }
    throw new Error(`the article does not hold ${text}`)
  }, needle)
  return ends
}

/**
 * A drag that pauses mid-passage, which is the gesture this bead is about.
 *
 * It is a real mouse rather than a Range built in the page, because what it
 * proves is a browser's own behaviour: a drag held still fires
 * `selectionchange` and settles while the button is down, and highlighting
 * there wrapped half a sentence in marks — which changed the DOM under the live
 * selection and ended the drag, so the rest of the passage could never be
 * selected at all.
 */
test.describe('a slow drag across a passage', () => {
  test('highlights the whole passage once, and nothing while the button is down', async ({ page }) => {
    const title = 'A passage dragged over slowly'
    const article = await seedArticle(server.baseURL, {
      url: 'https://example.invalid/slow-drag',
      title,
      html: articleHtml({ title })
    })

    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    const { from, to } = await passageEnds(page, PASSAGE)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 10 })
    // Longer than the reader's settle, which is when the half-dragged passage
    // used to be highlighted.
    await page.waitForTimeout(500)

    const highlights = async (): Promise<string[]> => {
      const stored = await api<NotesPage<StoredHighlight>>(
        server.baseURL,
        `/api/notes/highlights?item_id=${article.id}`
      )
      return stored.items.map((highlight) => highlight.exact)
    }
    expect(await highlights()).toEqual([])
    await expect(page.locator('.notes-seltool')).toHaveCount(0)
    await expect(page.locator('mark[data-notes-passage]')).toHaveCount(0)

    await page.mouse.move(to.x, to.y, { steps: 10 })
    // What the browser itself says is selected at the moment of the release,
    // which is what the stored passage is compared against: the test states
    // the points, and the browser decides which glyphs they cover.
    const dragged = collapse(await page.evaluate(() => document.getSelection()?.toString() ?? ''))
    await page.mouse.up()

    await expect.poll(highlights).toEqual([dragged])
    // The whole passage, not the half that was selected at the pause.
    expect(dragged).toContain(collapse(PASSAGE).slice(-20))
    await expect(page.locator('.notes-seltool')).toBeVisible()
    await expect(page.locator('mark[data-notes-passage]').first()).toBeVisible()
  })
})

/**
 * A passage that runs from the middle of one paragraph into the next.
 *
 * The stored article carries no whitespace between `</p>` and `<p>`, so the
 * browser's own string for such a selection glues the sentences together
 * ("navegação.Uma frase"), while the text the server extracts separates the
 * blocks with a blank line. Nothing short of a real browser selection and a
 * real extraction produces both halves of that disagreement. The case is
 * asserted from the three places it was lost: the answer to the create, the
 * mark in the text, and the notes panel, which listed the passage as not found.
 */
const FIRST_HALF = 'corpo de artigo e não apenas um fragmento de navegação.'
const SECOND_HALF = 'Uma frase que aparece uma'
const SPACED_BREAK = 'navegação. Uma frase'

interface CreatedHighlight {
  exact: string
  status: string
}

/** The two halves, marked, in the text; the break between them spaced, in the panel. */
async function expectBothParagraphsHighlighted(page: Page, created: CreatedHighlight, itemId: string): Promise<void> {
  expect(created.status).toBe('anchored')
  expect(created.exact).toContain(SPACED_BREAK)
  expect(created.exact).not.toContain('navegação.Uma')

  const marks = page.locator('mark[data-notes-passage]')
  await expect(marks.first()).toBeVisible()
  const marked = await marks.allTextContents()
  expect(marked[0]).toContain(FIRST_HALF)
  expect(marked[marked.length - 1]).toContain(SECOND_HALF)
  // One mark per text node and no more: each half sits in its own paragraph.
  const paragraphs = await marks.evaluateAll((nodes) => new Set(nodes.map((node) => node.closest('p'))).size)
  expect(paragraphs).toBe(2)

  const stored = await api<NotesPage<StoredHighlight>>(server.baseURL, `/api/notes/highlights?item_id=${itemId}`)
  expect(stored.items.map((highlight) => highlight.status)).toEqual(['anchored'])
  await expect(page.locator('[data-entry="passage"]')).toContainText(SPACED_BREAK)
  await expect(page.locator('.notes-reader-orphans')).toHaveCount(0)
}

function highlightCreated(page: Page): Promise<CreatedHighlight> {
  return page
    .waitForResponse(
      (response) => response.url().endsWith('/api/notes/highlights') && response.request().method() === 'POST'
    )
    .then((response) => response.json() as Promise<CreatedHighlight>)
}

test.describe('a drag from one paragraph into the next', () => {
  test('highlights both halves, with a space where the paragraphs meet', async ({ page }) => {
    const title = 'A passage dragged across two paragraphs'
    const article = await seedArticle(server.baseURL, {
      url: 'https://example.invalid/across-paragraphs-mouse',
      title,
      html: articleHtml({ title })
    })

    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    const start = (await passageEnds(page, FIRST_HALF)).from
    const end = (await passageEnds(page, SECOND_HALF)).to
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 10 })
    // Longer than the reader's settle: a half-dragged passage used to be
    // highlighted here, and a one-step selection would never have shown it.
    await page.waitForTimeout(300)
    const stored = () => api<NotesPage<StoredHighlight>>(server.baseURL, `/api/notes/highlights?item_id=${article.id}`)
    expect((await stored()).items).toEqual([])
    await expect(page.locator('mark[data-notes-passage]')).toHaveCount(0)

    await page.mouse.move(end.x, end.y, { steps: 10 })
    const created = highlightCreated(page)
    await page.mouse.up()

    await expectBothParagraphsHighlighted(page, await created, article.id)
  })
})

test.describe('a touch selection from one paragraph into the next', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('waits for Highlight, then marks both halves', async ({ page }) => {
    const title = 'A passage selected across two paragraphs by touch'
    const article = await seedArticle(server.baseURL, {
      url: 'https://example.invalid/across-paragraphs-touch',
      title,
      html: articleHtml({ title })
    })

    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await page.dispatchEvent('.reader-scroll', 'pointerdown', { pointerType: 'touch' })
    await selectAcrossNodes(page, FIRST_HALF, SECOND_HALF)
    await page.evaluate(() => window.dispatchEvent(new Event('pointerup')))

    // Pending: the toolbar offers to highlight and nothing has been stored.
    const toolbar = page.locator('.notes-seltool')
    await expect(toolbar).toBeVisible()
    await expect(page.locator('mark[data-notes-passage]')).toHaveCount(0)
    const before = await api<NotesPage<StoredHighlight>>(
      server.baseURL,
      `/api/notes/highlights?item_id=${article.id}`
    )
    expect(before.items).toEqual([])

    const created = highlightCreated(page)
    await toolbar.locator('[data-action="toolbar-highlight"]').tap()

    await expectBothParagraphsHighlighted(page, await created, article.id)
  })
})
