import { expect, test, type Page } from '@playwright/test'

import { articleHtml } from './helpers/article'
import { api, seedArticle, startNorte, type NorteServer, type SeededArticle } from './helpers/norteServer'

/**
 * Where a long article reopens, against a real server and a real layout.
 *
 * None of this can be proved under jsdom: the reading position is a fraction of
 * a scroll height the browser computes from the stylesheet, and the restore
 * happens in the frames after the text is painted. A component test has to
 * invent both numbers, and the defect this guards was exactly a disagreement
 * between the two the invented ones would have agreed on — the saved heading
 * sits far above the saved percent only once the article is tall.
 */
let server: NorteServer

/** How long the reader holds a scroll before writing it, plus room to answer. */
const POSITION_DEBOUNCE_MS = 2000

interface PositionedItem {
  id: string
  read_position: { v?: number; anchor?: string; percent?: number } | null
}

test.beforeAll(async () => {
  server = await startNorte()
})

test.afterAll(async () => {
  await server?.stop()
})

/**
 * A two-section article long enough for the heading and the percent to disagree.
 *
 * The filler all sits after the second heading, so every stopping point past
 * the opening has the same heading above it — which is what made following the
 * anchor restore 45% at the top of a section and 90% at the middle of the text.
 */
async function seedLongArticle(title: string): Promise<SeededArticle> {
  return seedArticle(server.baseURL, {
    url: `https://exemplo.invalid/${encodeURIComponent(title)}`,
    title,
    html: articleHtml({ title, fillerParagraphs: 60 })
  })
}

function storedPosition(id: string): Promise<PositionedItem> {
  return api<PositionedItem>(server.baseURL, `/api/library/items/${id}`)
}

async function openReader(page: Page, id: string): Promise<void> {
  await page.goto(`${server.baseURL}/library/${id}`)
  await expect(page.locator('.article-content')).toBeVisible()
}

/** Put the reader's scroll container at `fraction` of its own scrollable extent. */
async function scrollToFraction(page: Page, fraction: number): Promise<void> {
  await page.locator('.reader-scroll').evaluate((element, wanted) => {
    const scrollable = element.scrollHeight - element.clientHeight
    element.scrollTop = Math.round(wanted * scrollable)
  }, fraction)
}

async function readFraction(page: Page): Promise<number> {
  return page.locator('.reader-scroll').evaluate((element) => {
    const scrollable = element.scrollHeight - element.clientHeight
    return scrollable <= 0 ? 0 : element.scrollTop / scrollable
  })
}

test.describe('reopening a long article', () => {
  // The restore is measured in fractions of the scroll height, so the window
  // has to be a fixed size for the numbers to mean anything across runs.
  test.use({ viewport: { width: 1280, height: 800 } })

  for (const fraction of [0.3, 0.45, 0.9]) {
    test(`comes back within 2% of ${fraction * 100}% where reading stopped`, async ({ page }) => {
      const article = await seedLongArticle(`Posição de leitura ${fraction}`)
      await openReader(page, article.id)

      await scrollToFraction(page, fraction)
      // The write is the reader's own, on its own cadence; waiting for the
      // record to carry it is what says the scroll was recorded at all.
      await expect
        .poll(async () => (await storedPosition(article.id)).read_position?.percent, {
          timeout: POSITION_DEBOUNCE_MS + 10_000
        })
        .toBeCloseTo(fraction, 2)

      const saved = (await storedPosition(article.id)).read_position
      // The heading travels with the percent: without one stored there is
      // nothing for the restore to prefer over the percent, and this case
      // would pass whatever the restore did with it.
      expect(saved?.anchor).toBeTruthy()

      await openReader(page, article.id)
      await expect.poll(() => readFraction(page), { timeout: 10_000 }).toBeGreaterThan(fraction - 0.02)
      expect(await readFraction(page)).toBeLessThan(fraction + 0.02)
    })
  }

  test('keeps the last scroll when the reader is left straight after it', async ({ page }) => {
    const article = await seedLongArticle('Saída logo depois de rolar')
    await openReader(page, article.id)

    // A first position, written on the reader's own cadence, so the second one
    // has something to be different from: a reader that wrote nothing on the
    // way out would leave this value in place and look correct otherwise.
    await scrollToFraction(page, 0.2)
    await expect
      .poll(async () => (await storedPosition(article.id)).read_position?.percent, {
        timeout: POSITION_DEBOUNCE_MS + 10_000
      })
      .toBeCloseTo(0.2, 2)

    await scrollToFraction(page, 0.7)
    // Inside the debounce, which is where the newest position lives and where
    // tearing the reader down used to throw it away.
    await page.waitForTimeout(300)
    await page.locator('.reader-back').click()
    await expect(page).toHaveURL(/\/library/)

    await expect
      .poll(async () => (await storedPosition(article.id)).read_position?.percent, { timeout: 10_000 })
      .toBeCloseTo(0.7, 2)
  })
})
