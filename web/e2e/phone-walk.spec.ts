import { expect, test, type Locator, type Page } from '@playwright/test'

import { PASSAGE, articleHtml } from './helpers/article'
import { api, seedArticle, startNorte, type NorteServer, type SeededArticle } from './helpers/norteServer'

/**
 * The whole first delivery, walked with a thumb.
 *
 * Every step is a tap and nothing is ever hovered: the context has touch and no
 * mouse, so a control that only appears under a pointer is one this suite
 * cannot reach — which is the point. What each tap did is then read back from
 * the API rather than from the screen that caused it, because a screen can
 * show a change it never sent.
 */
let server: NorteServer
let article: SeededArticle

interface LibraryItem {
  id: string
  status: string
  unread: boolean
}

interface NotesPage<T> {
  items: T[]
  next_cursor: string | null
}

test.beforeAll(async () => {
  server = await startNorte()
  article = await seedArticle(server.baseURL, {
    url: 'https://exemplo.invalid/ler-no-telefone',
    title: 'Ler no telefone',
    html: articleHtml()
  })
})

test.afterAll(async () => {
  await server?.stop()
})

function item(): Promise<LibraryItem> {
  return api<LibraryItem>(server.baseURL, `/api/library/items/${article.id}`)
}

/** Visible, then tapped. The order is the claim: nothing is revealed by hovering. */
async function tap(target: Locator): Promise<void> {
  await expect(target).toBeVisible()
  await target.tap()
}

async function boot(page: Page, path: string): Promise<void> {
  await page.goto(`${server.baseURL}${path}`)
  await expect(page.locator('#app')).not.toBeEmpty()
}

test.describe('at 390x844, with touch and no mouse', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('walks the first delivery with a thumb', async ({ page }) => {
    await boot(page, '/')

    // --- the drawer ------------------------------------------------------
    const drawer = page.locator('#app-drawer')
    await expect(drawer).toBeHidden()
    const menu = page.locator('[data-action="abrir-navegacao"]')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await tap(menu)
    await expect(drawer).toBeVisible()

    await tap(drawer.locator('a.app-line-link', { hasText: 'Biblioteca' }))
    await expect(page).toHaveURL(/\/biblioteca\?v=tudo$/)
    // Arriving is what the drawer was opened for, so it is gone again.
    await expect(drawer).toBeHidden()

    // --- the row's tap menu ----------------------------------------------
    const row = page.locator('.item', { hasText: article.title })
    await expect(row).toBeVisible()
    // Nothing is behind hover: the group is not on the page until it is tapped
    // open. A pointer cannot be over a row here, and this is why that is fine.
    await expect(row.locator('[role="group"][aria-label="Ações"]')).toHaveCount(0)

    await tap(row.locator('[data-action="mais"]'))
    await tap(row.locator('button[aria-label="Depois"]'))
    await expect.poll(async () => (await item()).status).toBe('depois')

    // --- the reader -------------------------------------------------------
    await tap(row.locator('.item-title'))
    await expect(page).toHaveURL(new RegExp(`/biblioteca/${article.id}$`))
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    const bar = page.locator('nav[aria-label="Ações da leitura"]')
    await expect(bar).toBeVisible()
    // The header's actions are the ones a mouse used; on a phone they are gone
    // and the bar is the only place they live, so neither is a duplicate.
    await expect(page.locator('.reader-top-actions')).toHaveCount(0)

    // --- a touch selection, highlighted from the bar -----------------------
    const destacar = bar.locator('[data-action="destacar"]')
    await expect(destacar).toBeDisabled()
    await selectPassage(page, PASSAGE)
    await expect(destacar).toBeEnabled()
    await tap(destacar)

    await expect
      .poll(async () => {
        const page_ = await api<NotesPage<{ exact: string }>>(
          server.baseURL,
          `/api/notes/highlights?item_id=${article.id}`
        )
        return page_.items.map((highlight) => highlight.exact)
      })
      .toEqual([PASSAGE])

    // --- the annotations sheet --------------------------------------------
    const sheet = page.locator('[data-reader-sheet]')
    await expect(sheet).toBeHidden()
    await tap(bar.locator('[data-action="anotar-abrir"]'))
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('#notes-reader-annotation')).toBeVisible()

    await sheet.locator('#notes-reader-annotation').fill('Vale reler isto.')
    await tap(sheet.locator('[data-action="anotar"]'))
    await expect
      .poll(async () => {
        const answered = await api<NotesPage<{ text: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        return answered.items.map((annotation) => annotation.text)
      })
      .toEqual(['Vale reler isto.'])

    // --- a question --------------------------------------------------------
    await tap(bar.locator('[data-action="pergunta-abrir"]'))
    await sheet.locator('#notes-reader-question').fill('O que isso muda na prática?')
    await tap(sheet.locator('[data-action="virar-pergunta"]'))
    await expect
      .poll(async () => {
        const answered = await api<NotesPage<{ text: string }>>(
          server.baseURL,
          `/api/notes/questions?item_id=${article.id}`
        )
        return answered.items.map((question) => question.text)
      })
      .toEqual(['O que isso muda na prática?'])

    await tap(sheet.locator('[data-action="fechar-notas"]'))
    await expect(sheet).toBeHidden()

    // --- marked read, from the bar ----------------------------------------
    await tap(bar.locator('[data-action="read"]'))
    await expect.poll(async () => (await item()).unread).toBe(false)
  })

  test('reaches the Notas screen and its tabs by tap', async ({ page }) => {
    await boot(page, '/')

    await tap(page.locator('[data-action="abrir-navegacao"]'))
    const drawer = page.locator('#app-drawer')
    await tap(drawer.locator('a.app-line-link', { hasText: 'Notas' }))
    await expect(page).toHaveURL(/\/notas$/)

    // Every tab of the screen is a control a thumb can reach; the walk above
    // wrote a highlight, an annotation and a question, so each tab has a row.
    for (const [tab, section] of [
      ['Highlights', 'Lista de highlights'],
      ['Anotações', 'Lista de anotações'],
      ['Perguntas', 'Lista de perguntas']
    ] as const) {
      await tap(page.locator('.nt-seg-btn', { hasText: tab }))
      await expect(page.locator(`[aria-label="${section}"]`)).toBeVisible()
    }
  })
})

test.describe('at 1440x900, unchanged', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('keeps the sidebar, the header actions and the hover reveal', async ({ page }) => {
    await boot(page, '/biblioteca?v=tudo')

    // The sidebar is the layout, not a drawer over it, and there is no menu.
    await expect(page.locator('.app-sidebar')).toBeVisible()
    await expect(page.locator('[data-action="abrir-navegacao"]')).toBeHidden()

    const row = page.locator('.item', { hasText: article.title })
    // The group is rendered and revealed by the pointer, which is what it did
    // before this bead; the "more" button belongs to the phone and is not here.
    await expect(row.locator('[data-action="mais"]')).toHaveCount(0)
    const actions = row.locator('[role="group"][aria-label="Ações"]')
    await expect(actions).toHaveCount(1)
    await row.hover()
    await expect(actions).toBeVisible()
    await actions.locator('button[aria-label="Marcar como não lido"]').click()
    await expect.poll(async () => (await item()).unread).toBe(true)

    await page.locator('.item-title').first().click()
    await expect(page).toHaveURL(new RegExp(`/biblioteca/${article.id}$`))
    // The reader's own actions are in the header, and the phone's bar and sheet
    // are not rendered at all.
    await expect(page.locator('.reader-top-actions [data-action="read"]')).toBeVisible()
    await expect(page.locator('nav[aria-label="Ações da leitura"]')).toHaveCount(0)
    await expect(page.locator('[data-reader-sheet]')).toHaveCount(0)
    // And the panel is under the article, where a wide screen has room for it.
    await expect(page.locator('#notes-reader-title')).toBeVisible()

    // The reader is as wide as the window, not as wide as the sidebar it does
    // not render: a two-track grid with one item used to put it in track one.
    const width = await page.locator('main.reader').evaluate((node) => node.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(1000)
  })
})

/**
 * Select a sentence of the article the way a touch selection arrives.
 *
 * There is no way to drive the native handles from a test, so the Range is made
 * programmatically and `selectionchange` is what tells the reader about it —
 * which is exactly the event a long press produces and `mouseup` is not. The
 * native handles themselves stay a manual check.
 */
async function selectPassage(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const article = document.querySelector('.article-content')
    if (!article) throw new Error('the article is not on the page')
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(text)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error(`the article does not hold ${text}`)
  }, needle)
}
