import { expect, test, type Page } from '@playwright/test'

import { startNorte, type NorteServer } from './helpers/norteServer'

/**
 * The frame of the application, in the browser, against a real `norte serve`.
 *
 * Every defect here lived in the seam between the boot, the router and the
 * network, and none of them is visible to a component test: what a switched-off
 * module's screen *requests* needs a network, what a tab is *called* needs a
 * document, and a chunk that will not load needs a real dynamic import.
 *
 * `GET /api/config` is answered from here rather than by starting the server
 * with a different `NORTE_MODULES` or `NORTE_TIMEZONE`, because the shared
 * helper takes no environment and belongs to every suite that uses it. The
 * server under test is still the real one -- it serves the built frontend, the
 * content security policy and every other endpoint the page calls; only the one
 * answer the boot reads is substituted, which is exactly the input whose
 * handling is under test.
 */
let server: NorteServer

test.beforeAll(async () => {
  server = await startNorte()
})

test.afterAll(async () => {
  await server?.stop()
})

interface ConfigAnswer {
  modules: string[]
  timezone: string
}

async function answerConfigWith(page: Page, answer: ConfigAnswer): Promise<void> {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...answer, llm: false, telegram: false, version: 'test' })
    })
  )
}

/** Every path the page asked the API for, in order. */
function recordApiPaths(page: Page): string[] {
  const paths: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/')) paths.push(path)
  })
  return paths
}

function recordConsoleErrors(page: Page): string[] {
  const messages: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') messages.push(message.text())
  })
  page.on('pageerror', (error) => messages.push(error.message))
  return messages
}

test.describe('deep-linking into a module the server is not serving', () => {
  test('shows only the switched-off page, and asks that module for nothing', async ({ page }) => {
    await answerConfigWith(page, { modules: ['library'], timezone: 'America/Sao_Paulo' })
    const apiPaths = recordApiPaths(page)
    const errors = recordConsoleErrors(page)

    await page.goto(`${server.baseURL}/notas`)
    await expect(page.getByRole('heading', { name: 'Módulo desligado' })).toBeVisible()
    // The screen's own reads would be the next thing to happen, so settling
    // here is what makes their absence below mean something.
    await page.waitForTimeout(1000)

    expect(apiPaths.filter((path) => path.startsWith('/api/notes/'))).toEqual([])
    expect(errors).toEqual([])
    await expect(page.getByRole('heading', { name: 'Notas', exact: true })).toHaveCount(0)
  })
})

test.describe('a configuration the browser cannot use', () => {
  test('boots on the browser zone and says so, rather than blaming the server', async ({ page }) => {
    await answerConfigWith(page, { modules: ['library', 'notes'], timezone: 'Mars/Olympus' })
    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text())
    })

    await page.goto(`${server.baseURL}/`)

    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator('.server-unavailable')).toHaveCount(0)
    expect(warnings.filter((text) => text.includes('Mars/Olympus'))).toHaveLength(1)
  })
})

test.describe('the browser tab and the addresses nothing claims', () => {
  test('names the tab after the screen', async ({ page }) => {
    await page.goto(`${server.baseURL}/`)
    await expect(page).toHaveTitle('Início · Norte')

    await page.getByRole('link', { name: 'Library' }).first().click()
    await expect(page).toHaveTitle('Library · Norte')
  })

  test('answers an unknown address with a page that says so', async ({ page }) => {
    await page.goto(`${server.baseURL}/nao-existe`)

    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Voltar ao início' })).toBeVisible()
    await expect(page).toHaveTitle('Página não encontrada · Norte')
  })
})

test.describe('a navigation whose screen never arrives', () => {
  test('says so, and offers the address again', async ({ page }) => {
    await page.goto(`${server.baseURL}/library`)
    await expect(page.locator('.app-shell')).toBeVisible()

    // The server going away, as far as this page is concerned. The home screen
    // is a dynamic import nobody has fetched yet, so the click below is a
    // network request and the click is all the person did.
    await page.route('**/*', (route) => route.abort())
    await page.getByRole('link', { name: 'Início' }).click()

    // One second is the promise the shell makes about a click: not a figure
    // this asserts, a deadline it has to beat.
    const message = page.locator('.navigation-failed')
    await expect(message).toBeVisible({ timeout: 1000 })
    await expect(message).toContainText('Não foi possível abrir esta tela')
    await expect(message.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  })
})
