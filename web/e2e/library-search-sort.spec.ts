import { expect, test } from '@playwright/test'

import { articleHtml } from './helpers/article'
import { seedArticle, startNorte, type NorteServer } from './helpers/norteServer'

/**
 * The Biblioteca's header against a real `norte serve` (norte-jk8, norte-v8g).
 *
 * Two things live here that a component test cannot reach. The first is the
 * list endpoint's refusals: it answers 400 to an explicit sort together with a
 * text query, and the fake source never refuses, so a screen that sent both
 * passed every unit test and replaced the list with an error in the browser.
 * The second is the layout: the header is meant to be one row on a desktop
 * viewport, and only a real browser has rows.
 */
let server: NorteServer

test.beforeAll(async () => {
  server = await startNorte()
})

test.afterAll(async () => {
  await server?.stop()
})

/** The sort menu's trigger, which carries the order in its name. */
const sortTrigger = '.library-sort button.nt-menu-trigger'

test('typing a word lists the saved item that holds it, with no error', async ({ page }) => {
  const seeded = await seedArticle(server.baseURL, {
    url: 'https://exemplo.invalid/girassol-na-varanda',
    title: 'Girassol na varanda',
    html: articleHtml({ title: 'Girassol na varanda' })
  })

  await page.goto(`${server.baseURL}/biblioteca?v=tudo`)
  await expect(page.locator('#app')).not.toBeEmpty()
  await expect(page.locator('.item', { hasText: seeded.title })).toBeVisible()

  const searched = page.waitForResponse(
    (response) =>
      response.url().includes('/api/library/items') &&
      new URL(response.url()).searchParams.get('q') === 'girassol'
  )
  await page.locator('#library-search').fill('girassol')
  const answered = await searched

  // The search went out ranked: q set, accepted, and carrying no sort.
  expect(answered.ok()).toBe(true)
  const sent = new URL(answered.url()).searchParams
  expect(sent.get('q')).toBe('girassol')
  expect(sent.has('sort')).toBe(false)

  // The ranked match is listed and the sort-and-q refusal never appears.
  await expect(page.locator('.item', { hasText: seeded.title })).toBeVisible()
  await expect(page.locator('.library-error')).toHaveCount(0)
  // While the text is active no order can be asked for, because the pair is
  // what the server refuses.
  await expect(page.locator(sortTrigger)).toBeDisabled()

  // Clearing the text puts the orders back within reach.
  await page.locator('#library-search').fill('')
  await expect(page.locator(sortTrigger)).toBeEnabled()
  await expect(page.locator('.item', { hasText: seeded.title })).toBeVisible()
  await expect(page.locator('.library-error')).toHaveCount(0)
})

test('choosing an order from the menu sends it, and the server accepts it', async ({ page }) => {
  await seedArticle(server.baseURL, {
    url: 'https://exemplo.invalid/abacate-no-vaso',
    title: 'Abacate no vaso',
    html: articleHtml({ title: 'Abacate no vaso' })
  })

  await page.goto(`${server.baseURL}/biblioteca?v=tudo`)
  await expect(page.locator('.item').first()).toBeVisible()
  await expect(page.locator(sortTrigger)).toHaveAttribute('aria-label', 'Ordenar: Mais recentes')

  const sorted = page.waitForResponse((response) => response.url().includes('/api/library/items'))
  await page.locator(sortTrigger).click()
  await page.locator('.library-sort [data-sort="title"]').click()
  const answered = await sorted

  expect(answered.ok()).toBe(true)
  expect(new URL(answered.url()).searchParams.get('sort')).toBe('title')
  await expect(page.locator(sortTrigger)).toHaveAttribute('aria-label', 'Ordenar: Título')
  // A choice closes the menu, and the list is still a list.
  await expect(page.locator('.library-sort [role="menu"]')).toHaveCount(0)
  await expect(page.locator('.library-error')).toHaveCount(0)

  // The focus ranking is one of the orders: it asks for view=now, and for none
  // of the three parameters the contract refuses alongside it.
  const ranked = page.waitForResponse(
    (response) =>
      response.url().includes('/api/library/items') &&
      new URL(response.url()).searchParams.get('view') === 'now'
  )
  await page.locator(sortTrigger).click()
  await page.locator('.library-sort [data-sort="now"]').click()
  const rankedAnswer = await ranked

  expect(rankedAnswer.ok()).toBe(true)
  const rankedSent = new URL(rankedAnswer.url()).searchParams
  expect(rankedSent.has('sort')).toBe(false)
  expect(rankedSent.has('q')).toBe(false)
  expect(rankedSent.has('unread')).toBe(false)
  await expect(page.locator('.library-error')).toHaveCount(0)
  // The list is drawn from every shelf, so no shelf tab is the one on screen.
  await expect(page.locator('#library-search')).toBeDisabled()
  await expect(page.locator('.library-tabs [aria-selected="true"]')).toHaveCount(0)
})

test('the filter menu asks for unread only, and the server accepts that too', async ({ page }) => {
  await seedArticle(server.baseURL, {
    url: 'https://exemplo.invalid/cerca-de-bambu',
    title: 'Cerca de bambu',
    html: articleHtml({ title: 'Cerca de bambu' })
  })

  await page.goto(`${server.baseURL}/biblioteca?v=tudo`)
  await expect(page.locator('.item').first()).toBeVisible()

  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes('/api/library/items') &&
      new URL(response.url()).searchParams.get('unread') === 'true'
  )
  await page.locator('.library-filter button.nt-menu-trigger').click()
  await page.locator('.library-filter [data-filter="unread"]').click()
  const answered = await filtered

  expect(answered.ok()).toBe(true)
  await expect(page.locator('.library-unread')).toContainText('Mostrando só não lidos')
  await expect(page.locator('.library-error')).toHaveCount(0)
})

test('the header is one row at 1280px', async ({ page }) => {
  await seedArticle(server.baseURL, {
    url: 'https://exemplo.invalid/telhado-verde',
    title: 'Telhado verde',
    html: articleHtml({ title: 'Telhado verde' })
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${server.baseURL}/biblioteca?v=tudo`)
  // The counts have arrived, so the tabs are at the width they will keep: a
  // header measured before them is a header a reflow is about to change.
  await expect(page.locator('.item').first()).toBeVisible()
  await expect(page.locator('.library-tabs .nt-seg-count').first()).toBeVisible()

  /** The top of each control, which is equal for controls sharing a line. */
  async function topOf(selector: string): Promise<number> {
    const box = await page.locator(selector).boundingBox()
    if (box === null) throw new Error(`no box for ${selector}`)
    return box.y
  }

  const title = await topOf('.library-head h1')
  const tabs = await topOf('.library-tabs')
  const surprise = await topOf('.library-surprise')
  const search = await topOf('#library-search')
  const sort = await topOf(sortTrigger)
  const filter = await topOf('.library-filter button.nt-menu-trigger')

  // Centred on one another rather than flush: the row is `align-items: center`
  // and the controls are not the same height, so what is asserted is that each
  // one's box overlaps the title's line.
  const titleBottom = title + ((await page.locator('.library-head h1').boundingBox())?.height ?? 0)
  for (const [what, top] of [
    ['the tabs', tabs],
    ['Surpresa', surprise],
    ['the search box', search],
    ['the sort menu', sort],
    ['the filter menu', filter]
  ] as const) {
    expect(top, `${what} starts at ${top}, the title at ${title}`).toBeGreaterThan(title - 40)
    expect(top, `${what} starts at ${top}, the title ends at ${titleBottom}`).toBeLessThan(titleBottom)
  }

  // The tabs keep their own line too: five options, one row of them.
  const tabTops = await page
    .locator('.library-tabs .nt-seg-btn')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().y)))
  expect(tabTops).toHaveLength(5)
  expect(new Set(tabTops).size).toBe(1)

  // And nothing drags the page sideways at that width.
  expect(
    await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }))
  ).toEqual({ scrollWidth: 1280, innerWidth: 1280 })
})
