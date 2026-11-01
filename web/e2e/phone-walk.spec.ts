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
async function seed(title: string, options: { fillerParagraphs?: number; sections?: string[]; headingless?: boolean } = {}): Promise<SeededArticle> {
  article = await seedArticle(server.baseURL, {
    url: `https://example.invalid/${encodeURIComponent(title)}`,
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
    await seed('Walked with a thumb')
    await boot(page, '/')

    // --- the drawer ------------------------------------------------------
    const drawer = page.locator('#app-drawer')
    await expect(drawer).toBeHidden()
    const menu = page.locator('[data-action="open-navigation"]')
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
    // and the floating controls are the only place they live, so neither is a
    // duplicate.
    await expect(page.locator('.reader-top-actions')).toHaveCount(0)
    await expect(page.locator('.reader-cluster [data-action="back"]')).toBeVisible()

    // --- a touch selection, which highlights nothing by itself -------------
    const toolbar = page.locator('.notes-seltool')
    await expect(toolbar).toHaveCount(0)
    await touchSelectPassage(page, PASSAGE)
    // The toolbar opens over the live selection and the first button offers to
    // highlight it, because nothing has been created: marking the text here
    // would change the DOM under the selection and take the handles with it,
    // which is what left a phone able to highlight single words only.
    await expect(toolbar).toBeVisible()
    await expect(toolbar.locator('button').first()).toHaveAttribute('aria-label', 'Highlight')
    await expect(page.locator('mark[data-notes-passage]')).toHaveCount(0)
    const storedPassages = async (): Promise<string[]> => {
      const page_ = await api<NotesPage<{ exact: string }>>(
        server.baseURL,
        `/api/notes/highlights?item_id=${article.id}`
      )
      return page_.items.map((highlight) => highlight.exact)
    }
    expect(await storedPassages()).toEqual([])

    await tap(toolbar.locator('[data-action="toolbar-highlight"]'))
    await expect.poll(storedPassages).toEqual([PASSAGE])
    await expect(page.locator(`mark[data-notes-passage="${PASSAGE}"]`).first()).toBeVisible()
    // The passage exists now, so the toolbar offers to undo it instead.
    await expect(toolbar.locator('button').first()).toHaveAttribute('aria-label', 'Remove highlight')

    // --- a note written in the toolbar, with a thumb ------------------------
    await tap(toolbar.locator('[data-action="toolbar-annotate"]'))
    await toolbar.locator('.notes-seltool-field').fill('Read this part again.')
    await tap(toolbar.locator('[data-action="toolbar-save-annotation"]'))
    await expect
      .poll(async () => {
        const answered = await api<NotesPage<{ text: string; highlight_id?: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        return answered.items.map((annotation) => [annotation.text, annotation.highlight_id !== undefined])
      })
      .toEqual([['Read this part again.', true]])
    // The toolbar is gone with the note saved, and the bar is still the bar.
    await expect(toolbar).toHaveCount(0)
    await expect(bar).toBeVisible()

    // --- the annotations sheet --------------------------------------------
    const sheet = page.locator('[data-reader-sheet]')
    await expect(sheet).toBeHidden()
    await tap(bar.locator('[data-action="annotate-open"]'))
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('#notes-reader-annotation')).toBeVisible()

    await sheet.locator('#notes-reader-annotation').fill('Worth reading again.')
    await tap(sheet.locator('[data-action="annotate"]'))
    await expect
      .poll(async () => {
        const answered = await api<NotesPage<{ text: string }>>(
          server.baseURL,
          `/api/notes/annotations?item_id=${article.id}`
        )
        // Sorted, because what is claimed is that both notes are stored and not
        // the order the list returns them in.
        return answered.items.map((annotation) => annotation.text).sort()
      })
      .toEqual(['Read this part again.', 'Worth reading again.'])

    // --- a question --------------------------------------------------------
    await tap(bar.locator('[data-action="question-open"]'))
    await sheet.locator('#notes-reader-question').fill('What does this change in practice?')
    await tap(sheet.locator('[data-action="turn-into-question"]'))
    await expect
      .poll(async () => {
        const answered = await api<NotesPage<{ text: string }>>(
          server.baseURL,
          `/api/notes/questions?item_id=${article.id}`
        )
        return answered.items.map((question) => question.text)
      })
      .toEqual(['What does this change in practice?'])

    await tap(sheet.locator('[data-action="close-notes"]'))
    await expect(sheet).toBeHidden()

    // --- marked read, from the round button --------------------------------
    await tap(page.locator('.reader-cluster [data-action="read"]'))
    await expect.poll(async () => (await item()).unread).toBe(false)
  })

  test('draws the selection toolbar as a column at the right edge, before and after highlighting', async ({ page }) => {
    await seed('Toolbar column beside the passage')
    await boot(page, `/library/${article.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    // The handles are adjusted before the tap: a one-step selection is how a
    // touch bug stays hidden, so the first words are selected and then grown.
    await touchSelectPassage(page, PASSAGE.split(' ').slice(0, 3).join(' '))
    const toolbar = page.locator('.notes-seltool')
    await expect(toolbar).toBeVisible()
    await touchSelectPassage(page, PASSAGE)
    await expect(toolbar).toBeVisible()

    await expect(toolbar).toHaveAttribute('data-layout', 'column')
    await expect(toolbar).toHaveCSS('position', 'fixed')
    await expect(toolbar.locator('.notes-seltool-row')).toHaveCSS('flex-direction', 'column')
    const viewportWidth = page.viewportSize()?.width ?? 0
    await expect
      .poll(async () => {
        const box = await toolbar.boundingBox()
        return box ? viewportWidth - (box.x + box.width) : NaN
      })
      .toBeCloseTo(14, 0)

    // Five round 36px icon buttons, top to bottom, none carrying text.
    const buttons = toolbar.locator('.notes-seltool-row > button, .notes-seltool-row .nt-menu-trigger')
    await expect(buttons).toHaveCount(5)
    const boxes = []
    for (let i = 0; i < 5; i++) boxes.push(await buttons.nth(i).boundingBox())
    for (const box of boxes) {
      expect(box?.width).toBeCloseTo(36, 0)
      expect(box?.height).toBeCloseTo(36, 0)
    }
    for (let i = 1; i < 5; i++) expect(boxes[i]?.y ?? NaN).toBeGreaterThan(boxes[i - 1]?.y ?? Infinity)
    expect(await buttons.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()))).toEqual(['', '', '', '', ''])
    expect(
      await buttons.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-action') ?? node.getAttribute('aria-label'))
      )
    ).toEqual(['toolbar-highlight', 'toolbar-annotate', 'toolbar-question', 'More', 'toolbar-close'])

    // The column's top is the top of the selection's last line, clamped.
    const lastLineTop = await page.evaluate(() => {
      const rects = document.getSelection()?.getRangeAt(0).getClientRects()
      return rects && rects.length > 0 ? rects[rects.length - 1].top : NaN
    })
    const topBefore = (await toolbar.boundingBox())?.y ?? NaN
    expect(topBefore).toBeCloseTo(Math.max(lastLineTop, 8), -1)

    await tap(toolbar.locator('[data-action="toolbar-highlight"]'))
    await expect(page.locator(`mark[data-notes-passage="${PASSAGE}"]`).first()).toBeVisible()
    await expect(toolbar.locator('button').first()).toHaveAttribute('aria-label', 'Remove highlight')
    // Highlighting swaps the selection for a mark; the column stays where it was.
    expect(Math.abs(((await toolbar.boundingBox())?.y ?? NaN) - topBefore)).toBeLessThanOrEqual(2)

    // The more menu opens beside the column, fully on the screen.
    await tap(toolbar.locator('.nt-menu-trigger'))
    const panel = toolbar.locator('.nt-menu-panel')
    await expect(panel).toBeVisible()
    const panelBox = await panel.boundingBox()
    expect(panelBox?.x ?? NaN).toBeGreaterThanOrEqual(0)
    expect((panelBox?.x ?? NaN) + (panelBox?.width ?? NaN)).toBeLessThanOrEqual(viewportWidth)
    await expect(panel).toContainText('Copy text')
    await expect(panel).toContainText('Re-select passage')
    await tap(toolbar.locator('.nt-menu-trigger'))

    // Close drops the toolbar and leaves nothing selected.
    await touchSelectPassage(page, PASSAGE)
    await tap(toolbar.locator('[data-action="toolbar-close"]'))
    await expect(toolbar).toHaveCount(0)
    expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true)
  })

  test('reaches the Notes screen and its tabs by tap', async ({ page }) => {
    const own = await seed('Notes on the phone')
    const highlight = await api<{ id: string }>(server.baseURL, '/api/notes/highlights', {
      method: 'POST',
      body: JSON.stringify({ item_id: own.id, exact: PASSAGE })
    })
    await api(server.baseURL, '/api/notes/annotations', {
      method: 'POST',
      body: JSON.stringify({ item_id: own.id, highlight_id: highlight.id, text: 'Worth reading again.' })
    })
    await api(server.baseURL, '/api/notes/questions', {
      method: 'POST',
      body: JSON.stringify({ item_id: own.id, text: 'What does this change in practice?' })
    })
    await boot(page, '/')

    await tap(page.locator('[data-action="open-navigation"]'))
    const drawer = page.locator('#app-drawer')
    await tap(drawer.locator('a.app-line-link', { hasText: 'Notes' }))
    await expect(page).toHaveURL(/\/notes$/)

    // Every tab of the screen is a control a thumb can reach; the test seeded
    // a highlight, an annotation and a question, so each tab has a row.
    for (const [tab, section, text] of [
      ['Highlights', 'Highlights list', PASSAGE],
      ['Annotations', 'Annotations list', 'Worth reading again.'],
      ['Questions', 'Questions list', 'What does this change in practice?']
    ] as const) {
      await tap(page.locator('.nt-seg-btn', { hasText: tab }))
      await expect(page.locator(`[aria-label="${section}"]`)).toContainText(text)
    }
  })
})

/**
 * The phone reader's floating controls: where they sit, when they leave and
 * what they open.
 */
test.describe('the reader chrome at 390x844, with touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  const strip = (page: Page): Locator => page.locator('nav[aria-label="Reading actions"]')
  const cluster = (page: Page): Locator => page.locator('.reader-cluster')

  /** Scrolls the reader's own container and waits for the scroll event to be delivered. */
  async function scrollReaderTo(page: Page, top: number): Promise<void> {
    await page.locator('.reader-scroll').evaluate(async (node, to) => {
      node.scrollTop = to
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, top)
  }

  async function openTall(page: Page, title: string, paragraphs: number): Promise<number> {
    const own = await seed(title, { fillerParagraphs: paragraphs })
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)
    return page.locator('.reader-scroll').evaluate((node) => node.clientHeight)
  }

  test('draws round translucent buttons on top and a 48px translucent strip below', async ({ page }) => {
    await openTall(page, 'Chrome geometry', 0)

    await expect(page.locator('.reader-top')).toHaveCount(0)
    // Back, the contents (the seeded text has headings), and mark read.
    await expect(cluster(page).locator('button, a')).toHaveCount(3)
    for (const button of await cluster(page).locator('button, a').all()) {
      const look = await button.evaluate((node) => {
        const box = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return { width: box.width, height: box.height, border: style.borderTopWidth, background: style.backgroundColor }
      })
      expect(look.width).toBe(34)
      expect(look.height).toBe(34)
      expect(look.border).toBe('0px')
      expect(alphaOf(look.background)).toBeLessThan(0.95)
    }
    // The cluster itself is a transparent row, not a bar across the screen.
    expect(alphaOf(await cluster(page).evaluate((node) => getComputedStyle(node).backgroundColor))).toBe(0)

    const look = await strip(page).evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        height: node.getBoundingClientRect().height,
        border: style.borderTopWidth,
        background: style.backgroundColor,
        buttons: [...node.querySelectorAll('button')].map((button) => ({
          action: button.getAttribute('data-action'),
          text: (button.textContent ?? '').trim(),
          label: button.getAttribute('aria-label'),
          title: button.getAttribute('title'),
          strokes: [...button.querySelectorAll('svg')].map((svg) => svg.getAttribute('stroke-width'))
        }))
      }
    })
    expect(look.height).toBe(48)
    expect(look.border).toBe('0px')
    expect(alphaOf(look.background)).toBeLessThan(0.95)
    expect(look.buttons.map((button) => button.action)).toEqual([
      'annotate-open',
      'question-open',
      'notebook-open',
      'location-open',
      'more-open'
    ])
    for (const button of look.buttons) {
      expect(button.text, button.action ?? '').toBe('')
      expect(button.label).toBeTruthy()
      expect(button.title).toBe(button.label)
      expect(button.strokes).toEqual(['1.5'])
    }
    const published = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--norte-library-reader-bar-height').trim()
    )
    expect(published).toBe('48px')
  })

  test('stays up inside the first viewport', async ({ page }) => {
    const viewport = await openTall(page, 'Chrome first viewport', 14)

    await scrollReaderTo(page, 0)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    const reach = await page.locator('.reader-scroll').evaluate((node) => node.scrollHeight - node.clientHeight)
    expect(reach, 'the article has to be scrollable past 500px for this to mean anything').toBeGreaterThan(500)
    await scrollReaderTo(page, 300)
    await scrollReaderTo(page, Math.min(500, viewport - 20))

    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await expect(cluster(page)).toHaveAttribute('data-hidden', 'false')
  })

  test('slides both away on a downward scroll and back on the first upward one', async ({ page }) => {
    const viewport = await openTall(page, 'Chrome hides', 80)
    const reach = await page.locator('.reader-scroll').evaluate((node) => node.scrollHeight - node.clientHeight)
    expect(reach, 'at least four viewports of text').toBeGreaterThan(viewport * 3)

    await scrollReaderTo(page, viewport * 2)
    await scrollReaderTo(page, viewport * 2 - 1)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await scrollReaderTo(page, viewport * 2 + 38)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await scrollReaderTo(page, viewport * 2 + 80)

    await expect(strip(page)).toHaveAttribute('data-hidden', 'true')
    await expect(cluster(page)).toHaveAttribute('data-hidden', 'true')
    await expect.poll(async () => (await strip(page).boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(844)
    await expect.poll(async () => ((await cluster(page).boundingBox())?.y ?? 0) + 34).toBeLessThanOrEqual(0)

    await scrollReaderTo(page, viewport * 2 + 79)

    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await expect(cluster(page)).toHaveAttribute('data-hidden', 'false')
    await expect.poll(async () => (await strip(page).boundingBox())?.y ?? 0).toBeLessThan(844)
  })

  test('draws a two pixel progress line only while the controls are away', async ({ page }) => {
    const viewport = await openTall(page, 'Chrome progress', 80)
    const progress = page.locator('[data-reader-progress]')
    await expect(progress).toHaveCount(0)

    await scrollReaderTo(page, viewport * 2)
    await scrollReaderTo(page, viewport * 2 + 120)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'true')

    await expect(progress).toHaveCount(1)
    const measured = await page.evaluate(() => {
      const node = document.querySelector('[data-reader-progress]') as HTMLElement
      const scroller = document.querySelector('.reader-scroll') as HTMLElement
      const box = node.getBoundingClientRect()
      return {
        height: box.height,
        bottom: box.bottom,
        percent: (box.width / window.innerWidth) * 100,
        fraction: (scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight)) * 100
      }
    })
    expect(measured.height).toBe(2)
    expect(measured.bottom).toBe(844)
    expect(Math.abs(measured.percent - measured.fraction)).toBeLessThan(1)

    await scrollReaderTo(page, viewport * 2 + 100)
    await expect(progress).toHaveCount(0)
  })

  test('holds still under an open sheet and under a live selection', async ({ page }) => {
    const viewport = await openTall(page, 'Chrome frozen', 80)

    // A live selection, made while the controls are up.
    await touchSelectPassage(page, PASSAGE)
    await expect(page.locator('.notes-seltool')).toBeVisible()
    await scrollReaderTo(page, viewport * 2)
    await scrollReaderTo(page, viewport * 2 + 200)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await scrollReaderTo(page, viewport * 2 + 100)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await page.evaluate(() => document.getSelection()?.removeAllRanges())
    await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')))
    await expect(page.locator('.notes-seltool')).toHaveCount(0)

    // An open sheet, whichever it is, while the controls are up.
    await scrollReaderTo(page, viewport * 2 + 90)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await tap(strip(page).locator('[data-action="more-open"]'))
    await expect(page.locator('[data-reader-sheet="more"]')).toBeVisible()
    await scrollReaderTo(page, viewport * 2 + 400)
    await expect(strip(page)).toHaveAttribute('data-hidden', 'false')
    await expect(cluster(page)).toHaveAttribute('data-hidden', 'false')
  })

  test('opens the contents drawer, jumps to the third heading and offers none on a headingless text', async ({ page }) => {
    const own = await seed('Contents drawer', { sections: ['Alpha part', 'Beta part', 'Gamma part'] })
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText('Gamma part')
    const scroller = page.locator('.reader-scroll')
    const drawer = page.locator('[data-reader-drawer="contents"]')
    const gammaTop = (): Promise<number> =>
      scroller.evaluate((node) => {
        const heading = [...node.querySelectorAll('h2')].find((h) => h.textContent === 'Gamma part')
        return (heading?.getBoundingClientRect().top ?? 0) - node.getBoundingClientRect().top
      })

    // Back, contents | mark read: the contents sits beside back, on the left.
    const xOf = async (action: string): Promise<number> =>
      (await cluster(page).locator(`[data-action="${action}"]`).boundingBox())?.x ?? -1
    const [back, contents, read] = [await xOf('back'), await xOf('contents-open'), await xOf('read')]
    expect(back).toBeLessThan(contents)
    expect(contents).toBeLessThan(195)
    expect(contents).toBeLessThan(read)
    await expect(cluster(page).locator('button, a')).toHaveCount(3)

    await tap(cluster(page).locator('[data-action="contents-open"]'))
    await expect(drawer).toBeVisible()
    const box = await drawer.boundingBox()
    expect(Math.abs((box?.width ?? 0) - 390 * 0.86)).toBeLessThanOrEqual(2)
    expect(box?.x).toBe(0)
    // The article's own title and the sample's fixed section come ahead of the three.
    await expect(drawer.locator('.reader-contents-row')).toHaveText([
      'Contents drawer',
      'Uma seção',
      'Alpha part',
      'Beta part',
      'Gamma part'
    ])

    // Dismissing, by key or by the scrim, leaves the text where it was.
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await tap(cluster(page).locator('[data-action="contents-open"]'))
    await page.locator('.reader-drawer-scrim').tap({ position: { x: 380, y: 400 } })
    await expect(drawer).toHaveCount(0)
    expect(await scroller.evaluate((node) => node.scrollTop)).toBe(0)

    await tap(cluster(page).locator('[data-action="contents-open"]'))
    await tap(drawer.locator('.reader-contents-row', { hasText: 'Gamma part' }))
    await expect(drawer).toHaveCount(0)
    await expect.poll(async () => Math.abs((await gammaTop()) - 16), { timeout: 5000 }).toBeLessThanOrEqual(4)

    // Reopened (a pixel upward brings the controls back), the section now at the top is the marked one.
    await scrollReaderTo(page, (await scroller.evaluate((node) => node.scrollTop)) - 1)
    await tap(cluster(page).locator('[data-action="contents-open"]'))
    await expect(drawer.locator('[aria-current="true"]')).toHaveText('Gamma part')
    await expect(cluster(page).locator('[data-action="contents-open"] svg')).toHaveAttribute('stroke-width', '1.5')

    // The controls hold still under the open drawer, as under any sheet.
    const at = await scroller.evaluate((node) => node.scrollTop)
    await scrollReaderTo(page, at - 300)
    await scrollReaderTo(page, at + 400)
    await scrollReaderTo(page, at + 800)
    await expect(cluster(page)).toHaveAttribute('data-hidden', 'false')
  })

  test('draws no contents button on a text without headings', async ({ page }) => {
    const own = await seed('No headings here', { headingless: true })
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)
    await expect(cluster(page)).toBeVisible()
    await expect(cluster(page).locator('[data-action="contents-open"]')).toHaveCount(0)
  })

  test('moves the item from the location sheet in one tap, and the Library shows it there', async ({ page }) => {
    const own = await seed('Chrome moves the item')
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await tap(strip(page).locator('[data-action="location-open"]'))
    const sheet = page.locator('[data-reader-sheet="location"]')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('button')).toHaveCount(5)
    await expect(sheet.locator('[aria-pressed="true"]')).toHaveAttribute('data-action', 'location-inbox')
    for (const button of await sheet.locator('svg').all()) {
      await expect(button).toHaveAttribute('stroke-width', '1.5')
    }

    await tap(sheet.locator('[data-action="location-archive"]'))
    await expect(sheet).toHaveCount(0)
    await expect.poll(async () => (await item()).location).toBe('archive')

    await boot(page, '/library?v=archive')
    await expect(page.locator('.item', { hasText: own.title })).toBeVisible()
  })

  test('opens the original from the more sheet and deletes only once confirmed', async ({ page }) => {
    const own = await seed('Chrome deletes the item')
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    await tap(strip(page).locator('[data-action="more-open"]'))
    const sheet = page.locator('[data-reader-sheet="more"]')
    await expect(sheet.locator('a, button')).toHaveText(['Open the original', 'Delete'])
    const link = sheet.locator('a')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toHaveAttribute('href', `https://example.invalid/${encodeURIComponent(own.title)}`)

    await tap(sheet.locator('[data-action="delete"]'))
    await tap(page.locator('[data-action="cancel-delete"]'))
    await expect(sheet).toBeVisible()
    expect((await item()).id).toBe(own.id)

    await tap(sheet.locator('[data-action="delete"]'))
    await tap(page.locator('[data-action="confirm-delete"]'))
    await expect(page).toHaveURL(/\/library\?v=all$/)
    const gone = await fetch(`${server.baseURL}/api/library/items/${own.id}`)
    expect(gone.status).toBe(404)
  })
})

/** The alpha of a computed colour, whichever notation the browser answers in. */
function alphaOf(colour: string): number {
  if (colour === 'transparent') return 0
  if (/^rgb\(/.test(colour)) return 1
  const numbers = colour.match(/[\d.]+(?=\s*\))/)
  return numbers ? Number(numbers[0]) : 1
}

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
      const own = await seed(`No sideways scrolling on the ${phone.name}`)
      const routes = ['/', '/library?v=all', `/library/${own.id}`, '/notes', '/notes/sets', '/projects', '/review', '/study']

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
      const own = await seed(`A reachable result on the ${phone.name}`)
      await boot(page, '/')

      await tap(page.locator('[data-action="open-navigation"]'))
      const drawer = page.locator('#app-drawer')
      await expect(drawer).toBeVisible()
      await tap(drawer.locator('.app-foot button', { hasText: 'Search' }))

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

      await tap(page.locator('[data-action="open-navigation"]'))
      const drawer = page.locator('#app-drawer')
      await tap(drawer.locator('.app-foot button', { hasText: 'Preferences' }))

      await expect(drawer).toBeHidden()
      const option = page.locator('.shell-theme-option', { hasText: 'Dark' })
      await expect(option).toBeVisible()
      expect(await hits(option)).toBe(true)
    })

    test('keeps every library control inside the screen', async ({ page }) => {
      await seed(`Library controls on the ${phone.name}`)
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

    test('leaves the whole action strip tappable under the notes sheet', async ({ page }) => {
      const own = await seed(`The notes sheet on the ${phone.name}`)
      await boot(page, `/library/${own.id}`)
      await expect(page.locator('.article-content')).toContainText(PASSAGE)

      const bar = page.locator('nav[aria-label="Reading actions"]')
      const sheet = page.locator('[data-reader-sheet=""]')
      await tap(bar.locator('[data-action="annotate-open"]'))
      await expect(sheet).toBeVisible()

      for (const action of ['annotate-open', 'question-open', 'notebook-open', 'location-open', 'more-open']) {
        const button = bar.locator(`[data-action="${action}"]`)
        await expect(button).toBeVisible()
        expect(await hits(button), `${action} under the open sheet`).toBe(true)
      }

      // And the sheet is still a sheet: it has not been pushed off the screen
      // to make room for the strip.
      const room = await sheet.evaluate((node) => node.getBoundingClientRect().height)
      expect(room).toBeGreaterThan(100)

      // The strip is what the sheet clears, measured rather than guessed.
      await tap(bar.locator('[data-action="location-open"]'))
      await tap(page.locator('[data-reader-sheet="location"] [data-action="location-archive"]'))
      await expect
        .poll(async () => (await api<LibraryItem>(server.baseURL, `/api/library/items/${own.id}`)).location)
        .toBe('archive')
    })

    test('renders no collapse control in the drawer', async ({ page }) => {
      await boot(page, '/')

      await tap(page.locator('[data-action="open-navigation"]'))
      const drawer = page.locator('#app-drawer')
      await expect(drawer.locator('button.app-collapse')).toHaveCount(0)
      // The full navigation, not a 52px strip: the panel is as wide as the
      // drawer and its links are there to be tapped.
      await expect(drawer.locator('nav[aria-label="Main"]')).toBeVisible()
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
    const own = await seed('A wide screen')
    // The test below marks it unread, which only offers itself once it is read.
    await api(server.baseURL, `/api/library/items/${own.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ unread: false })
    })
    await boot(page, '/library?v=all')

    // The sidebar is the layout, not a drawer over it, and there is no menu.
    await expect(page.locator('.app-sidebar')).toBeVisible()
    await expect(page.locator('[data-action="open-navigation"]')).toBeHidden()

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
    // The text has headings, and still no contents button or drawer: that is the phone's.
    await expect(page.locator('.article-content h2').first()).toBeVisible()
    await expect(page.locator('[data-action="contents-open"], [data-reader-drawer]')).toHaveCount(0)
    // And the panel is under the article, where a wide screen has room for it.
    await expect(page.locator('#notes-reader-title')).toBeVisible()

    // The five location chips are one menu: a trigger naming the place, then the
    // read button, and choosing Archive moves the item there.
    const actionsBar = page.locator('.reader-top-actions')
    await expect(actionsBar.locator('.reader-chip')).toHaveCount(0)
    const locationTrigger = actionsBar.locator('[data-action="location-menu"] > button')
    await expect(locationTrigger).toHaveText('Inbox')
    await expect(locationTrigger.locator('svg')).toHaveCount(1)
    await locationTrigger.click()
    const rows = page.locator('[role="menu"] [role="menuitemradio"]')
    await expect(rows).toHaveCount(5)
    await expect(page.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(1)
    await expect(page.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveAttribute(
      'data-action',
      'location-inbox'
    )
    await page.locator('[data-action="location-archive"]').click()
    await expect(page.locator('[role="menu"]')).toHaveCount(0)
    await expect(locationTrigger).toHaveText('Archive')
    await expect.poll(async () => (await item()).location).toBe('archive')

    // The reader is as wide as the window, not as wide as the sidebar it does
    // not render: a two-track grid with one item used to put it in track one.
    const width = await page.locator('main.reader').evaluate((node) => node.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(1000)

    await boot(page, '/library?v=archive')
    await expect(page.locator('.item', { hasText: article.title })).toBeVisible()
  })
})

test.describe('at 1440x900, on a long article', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('keeps the toolbar in view once a passage near the top is selected', async ({ page }) => {
    const own = await seed('A long text on the wide screen', { fillerParagraphs: 80 })
    await boot(page, `/library/${own.id}`)
    await expect(page.locator('.article-content')).toContainText(PASSAGE)

    const scroller = page.locator('.reader-scroll')
    const overflow = await scroller.evaluate((node) => node.scrollHeight - node.clientHeight)
    // Without this the check below would pass for any placement of the bar.
    expect(overflow).toBeGreaterThan(2000)

    await selectPassage(page, PASSAGE)
    const toolbar = page.locator('.notes-seltool')
    await expect(toolbar).toBeVisible()
    // Whole, not merely on the page: a toolbar placed above a passage near the
    // top of the window is drawn where nothing can be tapped unless it flips.
    await expect(toolbar).toBeInViewport({ ratio: 1 })

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
/**
 * The same selection, announced as a finger's.
 *
 * Which gesture is selecting comes from the last `pointerdown`'s `pointerType`,
 * and that is the whole difference between a passage highlighted on release and
 * one the person is still adjusting. The native long press cannot be driven
 * from a test, so the press and the lift are dispatched and the Range is built
 * as above.
 */
async function touchSelectPassage(page: Page, needle: string): Promise<void> {
  await page.dispatchEvent('.reader-scroll', 'pointerdown', { pointerType: 'touch' })
  await selectPassage(page, needle)
  await page.evaluate(() => window.dispatchEvent(new Event('pointerup')))
}

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
