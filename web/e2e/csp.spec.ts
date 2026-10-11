import { expect, test, type Page } from '@playwright/test'

import { articleHtml } from './helpers/article'
import { seedArticle, startNorte, type NorteServer, type SeededArticle } from './helpers/norteServer'
import { startTlsImage, type TlsImageServer } from './helpers/tlsImage'

/**
 * The app under the policy the server actually sends.
 *
 * `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
 * img-src 'self' https: data:` is a promise about two opposite things: that an
 * article's own image and the design system's inline styles still render, and
 * that a script in an article's text never runs. A unit test over the header
 * proves neither — only a browser applies a policy — so both halves live here.
 */
let server: NorteServer
let images: TlsImageServer
let article: SeededArticle

interface Violation {
  directive: string
  blocked: string
}

test.beforeAll(async () => {
  server = await startNorte()
  images = await startTlsImage()
  article = await seedArticle(server.baseURL, {
    url: 'https://exemplo.invalid/com-imagem',
    title: 'Com imagem',
    html: articleHtml({ imageSrc: images.imageURL })
  })
})

test.afterAll(async () => {
  await images?.stop()
  await server?.stop()
})

/**
 * Watch for violations from before the first byte of the app runs.
 *
 * The listener goes in through an init script because a violation during boot
 * is exactly the kind this is looking for, and a listener added after the page
 * has loaded would have missed it.
 */
async function watchViolations(page: Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    const seen: Violation[] = []
    ;(window as unknown as { __cspViolations: Violation[] }).__cspViolations = seen
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push({ directive: event.violatedDirective, blocked: event.blockedURI })
    })
  })
  return async () =>
    page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations)
}

test.describe('the content security policy the server sends', () => {
  test('renders the app, an external image and a dynamic style without a violation', async ({ page }) => {
    const violations = await watchViolations(page)
    await page.goto(`${server.baseURL}/library/${article.id}`)

    // The header is the promise; everything below is the browser keeping it.
    const policy = await page.evaluate(async () => {
      const answer = await fetch(window.location.href)
      return answer.headers.get('content-security-policy')
    })
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("img-src 'self' https: data:")

    // The article's own image comes from an https origin, which is the only
    // thing `img-src https:` is there for. A decoded image is the proof: a
    // blocked one has no intrinsic size.
    const image = page.locator('.article-content img')
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    // Two kinds of style written at runtime, both of which the policy allows
    // only because of `style-src 'unsafe-inline'`: a style attribute, which is
    // how the design system sets a progress bar's width, and a stylesheet built
    // and appended by script.
    const applied = await page.evaluate(() => {
      const bar = document.createElement('div')
      bar.id = 'csp-progress'
      bar.setAttribute('style', 'width: 37px')
      document.body.append(bar)
      const sheet = document.createElement('style')
      // A property the attribute does not set, because an attribute beats a
      // rule and the test would then be reading the attribute twice.
      sheet.textContent = '#csp-progress { height: 9px; }'
      document.head.append(sheet)
      const computed = window.getComputedStyle(bar)
      return { fromAttribute: computed.width, fromSheet: computed.height }
    })
    expect(applied.fromAttribute).toBe('37px')
    expect(applied.fromSheet).toBe('9px')

    expect(await violations()).toEqual([])
  })

  test('blocks an inline script injected into the page', async ({ page }) => {
    const violations = await watchViolations(page)
    await page.goto(`${server.baseURL}/library/${article.id}`)
    await expect(page.locator('.article-content')).toBeVisible()

    const ran = await page.evaluate(() => {
      const script = document.createElement('script')
      // What an article carrying a script would amount to if one ever reached
      // the page: `script-src 'self'` has no 'unsafe-inline', so this never runs.
      script.textContent = 'window.__norteInlineRan = true'
      document.body.append(script)
      return (window as unknown as { __norteInlineRan?: boolean }).__norteInlineRan === true
    })
    expect(ran).toBe(false)

    // Chromium reports the effective directive, `script-src-elem`, which is the
    // one `script-src` covers when no more specific directive is present.
    const reported = await violations()
    expect(reported.filter((violation) => violation.directive.startsWith('script-src'))).not.toEqual([])
    expect(reported.map((violation) => violation.blocked)).toContain('inline')
  })
})
