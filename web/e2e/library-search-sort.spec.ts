import { expect, test } from '@playwright/test'

import { articleHtml } from './helpers/article'
import { seedArticle, startNorte, type NorteServer } from './helpers/norteServer'

/**
 * Searching the library sends `q` without `sort` (norte-jk8).
 *
 * The list endpoint refuses an explicit sort together with a text query, so a
 * search that sent both answered 400 and the error replaced the list. This
 * suite types a word into the search box of a real `norte serve` and checks
 * the row is listed, the request carried no sort, and no error is shown — the
 * seam the component test cannot reach, because the fake source never refuses.
 */
let server: NorteServer

test.beforeAll(async () => {
  server = await startNorte()
})

test.afterAll(async () => {
  await server?.stop()
})

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
  // While the text is active the sort toggle has nothing to do, so it is gone.
  await expect(page.locator('.library-sort')).toHaveCount(0)

  // Clearing the text brings the chosen sort and its toggle back.
  await page.locator('#library-search').fill('')
  await expect(page.locator('.library-sort')).toBeVisible()
  await expect(page.locator('.item', { hasText: seeded.title })).toBeVisible()
  await expect(page.locator('.library-error')).toHaveCount(0)
})
