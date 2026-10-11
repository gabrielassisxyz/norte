import { devices, expect, test, type Locator, type Page } from '@playwright/test'

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
  location: string
  unread: boolean
}

interface NotesPage<T> {
  items: T[]
  next_cursor: string | null
}

test.beforeAll(async () => {
  server = await startNorte()
})

test.afterAll(async () => {
  await server?.stop()
})

/**
 * An article of the test's own, so no test depends on what another one did to
 * the library: each passes alone as well as in the suite. The titles differ and
 * none is a prefix of another, because a row is found by its title.
 */
async function seed(title: string, options: { fillerParagraphs?: number } = {}): Promise<SeededArticle> {
  article = await seedArticle(server.baseURL, {
    url: `https://exemplo.invalid/${encodeURIComponent(title)}`,
    title,
    html: articleHtml({ title, ...options })
  })
  return article
}

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
    await seed('Percurso com o polegar')
    await boot(page, '/')

    // --- the drawer ------------------------------------------------------
    const drawer = page.locator('#app-drawer')
    await expect(drawer).toBeHidden()
    const menu = page.locator('[data-action="abrir-navegacao"]')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await tap(menu)
    await expect(drawer).toBeVisible()

    await tap(drawer.locator('a.app-line-link', { hasText: 'Library' }))
    await expect(page).toHaveURL(/\/library\?v=all$/)
    // Arriving is what the drawer was opened for, so it is gone again.
    await expect(drawer).toBeHidden()

    // --- the row's tap menu ----------------------------------------------
    const row = page.locator('.item', { hasText: article.title })
    await expect(row).toBeVisible()
    // Nothing is behind hover: the group is not on the page until it is tapped
    // open. A pointer cannot be over a row here, and this is why that is fine.
    await expect(row.locator('[role="group"][aria-label="Actions"]')).toHaveCount(0)

    await tap(row.locator('[data-action="more"]'))
    // Revealed by the tap itself, not by what it leaves behind: iOS Safari does
    // not focus a button on tap, and Chromium keeps the row hovered after one,
    // re-applying it when the layout changes. So drop both until neither holds
    // for a while, and only then read what is computed.
    const revealed = row.locator('[role="group"][aria-label="Actions"]')
    await expect(async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
      expect(await row.evaluate((node) => node.matches(':hover, :focus-within'))).toBe(false)
    }).toPass()
    // The group fades, so a value read mid-fade says nothing about where it ends.
    await revealed.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)))
    await expect(revealed).toHaveCSS('opacity', '1')
    await expect(revealed).toHaveCSS('pointer-events', 'auto')
    await tap(row.locator('button[aria-label="Later"]'))
    await expect.poll(async () => (await item()).location).toBe('later')

    // --- the reader -------------------------------------------------------
    await tap(row.locator('.item-title'))
    await expect(page).toHaveURL(new RegExp(`/library/${article.id}$`))
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    const bar = page.locator('nav[aria-label="Reading actions"]')
    await expect(bar).toBeVisible()
    // The header's actions are the ones a mouse used; on a phone they are gone
    // and the bar is the only place they live, so neither is a duplicate.
    await expect(page.locator('.reader-top-actions')).toHaveCount(0)

    // --- a touch selection, highlighted from the bar -----------------------
    const highlight = bar.locator('[data-action="highlight"]')
    await expect(highlight).toBeDisabled()
    // The bar's cell brings no frame of its own on a phone.
    const cell = bar.locator('.notes-selection-bar')
    await expect(cell).toHaveCSS('border-top-width', '0px')
    await expect(cell).toHaveCSS('padding-top', '0px')
    await expect(cell).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await selectPassage(page, PASSAGE)
    await expect(highlight).toBeEnabled()
    await tap(highlight)

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
    await tap(bar.locator('[data-action="annotate-open"]'))
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('#notes-reader-annotation')).toBeVisible()

    await sheet.locator('#notes-reader-annotation').fill('Vale reler isto.')
    await tap(sheet.locator('[data-action="annotate"]'))
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
    await tap(bar.locator('[data-action="question-open"]'))
    await sheet.locator('#notes-reader-question').fill('O que isso muda na prática?')
    await tap(sheet.locator('[data-action="turn-into-question"]'))
    await expect
      .poll(async () => {
        const answered = await api<NotesPage<{ text: string }>>(
          server.baseURL,
          `/api/notes/questions?item_id=${article.id}`
        )
        return answered.items.map((question) => question.text)
      })
      .toEqual(['O que isso muda na prática?'])

    await tap(sheet.locator('[data-action="close-notes"]'))
    await expect(sheet).toBeHidden()

    // --- marked read, from the bar ----------------------------------------
    await tap(bar.locator('[data-action="read"]'))
    await expect.poll(async () => (await item()).unread).toBe(false)
  })

  test('reaches the Notes screen and its tabs by tap', async ({ page }) => {
    const own = await seed('Notes on the phone')
    const highlight = await api<{ id: string }>(server.baseURL, '/api/notes/highlights', {
      method: 'POST',
      body: JSON.stringify({ item_id: own.id, exact: PASSAGE })
    })
    await api(server.baseURL, '/api/notes/annotations', {
      method: 'POST',
      body: JSON.stringify({ item_id: own.id, highlight_id: highlight.id, text: 'Vale reler isto.' })
    })
    await api(server.baseURL, '/api/notes/questions', {
      method: 'POST',
      body: JSON.stringify({ item_id: own.id, text: 'O que isso muda na prática?' })
    })
    await boot(page, '/')

    await tap(page.locator('[data-action="abrir-navegacao"]'))
    const drawer = page.locator('#app-drawer')
    await tap(drawer.locator('a.app-line-link', { hasText: 'Notes' }))
    await expect(page).toHaveURL(/\/notes$/)

    // Every tab of the screen is a control a thumb can reach; the test seeded
    // a highlight, an annotation and a question, so each tab has a row.
    for (const [tab, section, text] of [
      ['Highlights', 'Highlights list', PASSAGE],
      ['Annotations', 'Annotations list', 'Vale reler isto.'],
      ['Questions', 'Questions list', 'O que isso muda na prática?']
    ] as const) {
      await tap(page.locator('.nt-seg-btn', { hasText: tab }))
      await expect(page.locator(`[aria-label="${section}"]`)).toContainText(text)
    }
  })
})

/**
 * The two phone profiles every screen has to hold up under, by the width that
 * decides the layout. Playwright's own descriptors, so the numbers are the
 * devices' and not this test's.
 */
const PHONES = [
  { name: 'iPhone 13' as const, width: devices['iPhone 13'].viewport.width },
  { name: 'Pixel 7' as const, width: devices['Pixel 7'].viewport.width }
]

/**
 * One profile's emulation, as a describe group can take it.
 *
 * Everything but the descriptor's `defaultBrowserType`, which Playwright
 * refuses inside a group because switching browsers forces another worker --
 * and there is nothing to switch to: this config runs Chromium, and what these
 * cases are about is the width, the pixel ratio and having touch instead of a
 * pointer.
 */
function emulate(name: (typeof PHONES)[number]['name']) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name]
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }
}

/**
 * Whether a point lands on the control that owns it.
 *
 * `elementFromPoint` is the test a thumb makes: a control that is on the page,
 * visible and the right size still does nothing when something else is over
 * the pixels it occupies, and that is exactly what the drawer did to the
 * palette and what the notes sheet did to the action bar. Playwright's own
 * `tap()` would have reported the same failure as a timeout naming the wrong
 * element, so the check is spelled out.
 */
async function hits(target: Locator): Promise<boolean> {
  return target.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return top !== null && (top === node || node.contains(top))
  })
}

/** Every box of the matched controls, in viewport coordinates. */
async function boxesOf(target: Locator): Promise<Array<{ label: string; left: number; right: number }>> {
  return target.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      const label = (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 24)
      return { label, left: box.left, right: box.right }
    })
  )
}

for (const phone of PHONES) {
  test.describe(`on the ${phone.name} profile`, () => {
    test.use(emulate(phone.name))

    test('scrolls no route sideways', async ({ page }) => {
      const own = await seed(`Sem rolagem lateral no ${phone.name}`)
      const routes = ['/', '/library?v=all', `/library/${own.id}`, '/notes', '/notes/sets', '/projetos', '/revisao', '/estudo']

      for (const route of routes) {
        await boot(page, route)
        // Against the profile's own width, not against `innerWidth`: under
        // mobile emulation the layout viewport grows to fit content that
        // overflows it, so `innerWidth` reported 568 on the 390px library and
        // comparing the two would have called that screen clean. The second
        // assertion is what keeps this honest if that emulation ever changes.
        // Polled, because a screen whose counts arrive after the first paint
        // reflows once; what is asserted is the settled layout.
        await expect
          .poll(
            () =>
              page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                innerWidth: window.innerWidth
              })),
            { message: route }
          )
          .toEqual({ scrollWidth: phone.width, innerWidth: phone.width })
      }
    })

    test('closes the drawer behind the palette it opened, so a result takes the tap', async ({ page }) => {
      const own = await seed(`Resultado alcançável no ${phone.name}`)
      await boot(page, '/')

      await tap(page.locator('[data-action="abrir-navegacao"]'))
      const drawer = page.locator('#app-drawer')
      await expect(drawer).toBeVisible()
      await tap(drawer.locator('.app-foot button', { hasText: 'Buscar' }))

      // The row owns the pixels at its own centre, asserted before the drawer's
      // state: the drawer covered the left 300px of the palette, which is where
      // the result rows start, so the hit test is the claim and the drawer being
      // gone is only how it is met.
      await page.locator('.shell-palette-input').fill(own.title)
      const result = page.locator('.shell-palette-row', { hasText: own.title }).first()
      await expect(result).toBeVisible()
      expect(await hits(result)).toBe(true)
      await expect(drawer).toBeHidden()

      await tap(result)
      await expect(page).toHaveURL(new RegExp(`/library/${own.id}$`))
    })

    test('closes the drawer behind the preferences it opened', async ({ page }) => {
      await boot(page, '/')

      await tap(page.locator('[data-action="abrir-navegacao"]'))
      const drawer = page.locator('#app-drawer')
      await tap(drawer.locator('.app-foot button', { hasText: 'Preferências' }))

      await expect(drawer).toBeHidden()
      const option = page.locator('.shell-theme-option', { hasText: 'Escuro' })
      await expect(option).toBeVisible()
      expect(await hits(option)).toBe(true)
    })

    test('keeps every Biblioteca control inside the screen', async ({ page }) => {
      await seed(`Controles da biblioteca no ${phone.name}`)
      await boot(page, '/library?v=all')

      // The list has answered, so the tabs carry their counts and the toolbar
      // is at the width it will keep.
      await expect(page.locator('.item').first()).toBeVisible()

      const tabs = page.locator('.library-title-row .nt-seg-btn')
      // The seven tabs by name, so a toolbar that lost one cannot pass by
      // having fewer controls left to fit.
      await expect(tabs).toHaveText([
        /Inbox/,
        /Up Next/,
        /Later/,
        /Archive/,
        /Stash/,
        /All/,
        /Pending connections/
      ])

      const controls = [
        ['the seven tabs', tabs],
        ['Surprise', page.locator('.library-surprise')],
        ['the search box', page.locator('.library-search')],
        ['the sort menu', page.locator('.library-sort button')],
        ['the filter menu', page.locator('.library-filter button')]
      ] as const

      for (const [what, locator] of controls) {
        const boxes = await boxesOf(locator)
        expect(boxes.length, what).toBeGreaterThan(0)
        for (const box of boxes) {
          expect(box.left, `${what}: ${box.label} starts at ${box.left}`).toBeGreaterThanOrEqual(0)
          expect(box.right, `${what}: ${box.label} ends at ${box.right}`).toBeLessThanOrEqual(phone.width)
        }
      }
    })

    test('leaves the whole action bar tappable under the notes sheet', async ({ page }) => {
      const own = await seed(`Folha de notas no ${phone.name}`)
      await boot(page, `/library/${own.id}`)
      await expect(page.locator('.article-content')).toContainText(PASSAGE)

      const bar = page.locator('nav[aria-label="Reading actions"]')
      const sheet = page.locator('[data-reader-sheet]')
      await tap(bar.locator('[data-action="annotate-open"]'))
      await expect(sheet).toBeVisible()

      for (const label of ['Inbox', 'Up Next', 'Later', 'Archive', 'Stash', 'Read']) {
        const chip = bar.locator('.reader-bar-chip', { hasText: label })
        await expect(chip).toBeVisible()
        expect(await hits(chip), `${label} under the open sheet`).toBe(true)
      }

      // And the sheet is still a sheet: it has not been pushed off the screen
      // to make room for the bar.
      const room = await sheet.evaluate((node) => node.getBoundingClientRect().height)
      expect(room).toBeGreaterThan(100)

      // The bar is what the sheet clears, measured rather than guessed.
      await tap(bar.locator('[data-action="location-archive"]'))
      await expect
        .poll(async () => (await api<LibraryItem>(server.baseURL, `/api/library/items/${own.id}`)).location)
        .toBe('archive')
    })

    test('renders no collapse control in the drawer', async ({ page }) => {
      await boot(page, '/')

      await tap(page.locator('[data-action="abrir-navegacao"]'))
      const drawer = page.locator('#app-drawer')
      await expect(drawer.locator('button.app-collapse')).toHaveCount(0)
      // The full navigation, not a 52px strip: the panel is as wide as the
      // drawer and its links are there to be tapped.
      await expect(drawer.locator('nav[aria-label="Principal"]')).toBeVisible()
      const width = await drawer.locator('.app-sidebar').evaluate((node) => node.getBoundingClientRect().width)
      expect(width).toBeGreaterThan(200)
      // The drawer slides in, so the link reaches its place a moment after the
      // tap; a single hit test can land while it is still off the left edge.
      await expect.poll(() => hits(drawer.locator('a.app-line-link', { hasText: 'Library' }))).toBe(true)
    })
  })
}

test.describe('at 1440x900, unchanged', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('keeps the sidebar, the header actions and the hover reveal', async ({ page }) => {
    const own = await seed('Tela larga')
    // The test below marks it "não lido", which only offers itself once it is read.
    await api(server.baseURL, `/api/library/items/${own.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ unread: false })
    })
    await boot(page, '/library?v=all')

    // The sidebar is the layout, not a drawer over it, and there is no menu.
    await expect(page.locator('.app-sidebar')).toBeVisible()
    await expect(page.locator('[data-action="abrir-navegacao"]')).toBeHidden()

    const row = page.locator('.item', { hasText: article.title })
    // The group is rendered and revealed by the pointer, which is what it did
    // before this bead; the "more" button belongs to the phone and is not here.
    await expect(row.locator('[data-action="more"]')).toHaveCount(0)
    const actions = row.locator('[role="group"][aria-label="Actions"]')
    await expect(actions).toHaveCount(1)
    await row.hover()
    await expect(actions).toBeVisible()
    await actions.locator('button[aria-label="Mark as unread"]').click()
    await expect.poll(async () => (await item()).unread).toBe(true)

    await row.locator('.item-title').click()
    await expect(page).toHaveURL(new RegExp(`/library/${article.id}$`))
    // The reader's own actions are in the header, and the phone's bar and sheet
    // are not rendered at all.
    await expect(page.locator('.reader-top-actions [data-action="read"]')).toBeVisible()
    await expect(page.locator('nav[aria-label="Reading actions"]')).toHaveCount(0)
    await expect(page.locator('[data-reader-sheet]')).toHaveCount(0)
    // And the panel is under the article, where a wide screen has room for it.
    await expect(page.locator('#notes-reader-title')).toBeVisible()

    // The reader is as wide as the window, not as wide as the sidebar it does
    // not render: a two-track grid with one item used to put it in track one.
    const width = await page.locator('main.reader').evaluate((node) => node.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(1000)
  })
})

test.describe('at 1440x900, on a long article', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('keeps Destacar in view once a passage near the top is selected', async ({ page }) => {
    const own = await seed('Texto longo na tela larga', { fillerParagraphs: 80 })
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    const scroller = page.locator('.reader-scroll')
    const overflow = await scroller.evaluate((node) => node.scrollHeight - node.clientHeight)
    // Without this the check below would pass for any placement of the bar.
    expect(overflow).toBeGreaterThan(2000)

    await selectPassage(page, PASSAGE)
    const highlight = page.locator('.notes-selection-bar [data-action="highlight"]')
    await expect(highlight).toBeEnabled()
    await expect(highlight).toBeInViewport({ ratio: 1 })

    await highlight.click()
    await expect
      .poll(async () => {
        const page_ = await api<NotesPage<{ exact: string }>>(
          server.baseURL,
          `/api/notes/highlights?item_id=${own.id}`
        )
        return page_.items.map((highlight) => highlight.exact)
      })
      .toEqual([PASSAGE])
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
