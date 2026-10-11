import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArticleContent from './ArticleContent.vue'

/**
 * Every element the server's sanitizer admits.
 *
 * The list is the policy's, not a convenient subset of it: a component that
 * styles half the allowlist renders the other half as the browser's defaults,
 * and nothing says which half until an article arrives carrying one.
 */
const ALLOWLISTED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'em',
  'strong',
  'i',
  'b',
  'u',
  's',
  'sub',
  'sup',
  'small',
  'mark',
  'span',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'a',
  'img'
]

const FIXTURE_HTML = `
  <h1 id="the-title">The title</h1>
  <p>A paragraph with <em>emphasis</em>, <strong>weight</strong>, <i>italic</i>, <b>bold</b>,
    <u>underlined</u>, <s>struck</s>, <small>small</small>, <mark>marked</mark>,
    <span>a passage</span>, H<sub>2</sub>O and x<sup>2</sup>.<br />Second line.</p>
  <h2 id="a-section">A section</h2>
  <ul><li>First</li><li>Second</li></ul>
  <ol start="3"><li>Third</li></ol>
  <dl><dt>Term</dt><dd>Definition</dd></dl>
  <blockquote cite="https://example.test/source">A quotation.</blockquote>
  <pre class="language-go"><code class="language-go">fmt.Println("hi")</code></pre>
  <p>Press <kbd>Ctrl</kbd>, see <samp>output</samp> and replace <var>n</var>.</p>
  <h3 id="deeper">Deeper</h3>
  <h4 id="and-more">And more</h4>
  <h5 id="even-more">Even more</h5>
  <h6 id="the-bottom">The bottom</h6>
  <figure>
    <img src="https://images.test/chart.png" alt="A chart of the growth" width="640" height="480" />
    <figcaption>Figure caption.</figcaption>
  </figure>
  <table>
    <caption>A table</caption>
    <thead><tr><th>Key</th><th>Value</th></tr></thead>
    <tbody><tr><td colspan="2">A wide cell</td></tr></tbody>
    <tfoot><tr><td>End</td><td>of the table</td></tr></tfoot>
  </table>
  <hr />
  <p>
    <a href="https://other-site.test/article">An external link</a>
    <a href="#a-section">An internal link</a>
    <a href="mailto:someone@example.test">An email</a>
  </p>
  <p><img src="https://images.test/second.png" alt="The second image" /></p>
`

/**
 * The walk runs after Vue has replaced the markup, so every case waits for it.
 * That delay is the component's contract, not an accident: decorating before
 * the new nodes exist would decorate the previous article.
 */
async function mountArticle(html: string) {
  const wrapper = mount(ArticleContent, { props: { html }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function replaceArticle(wrapper: Awaited<ReturnType<typeof mountArticle>>, html: string) {
  await wrapper.setProps({ html })
  await flushPromises()
}

describe('ArticleContent over a fixture carrying every allowlisted element', () => {
  it('renders each one of them', async () => {
    const wrapper = await mountArticle(FIXTURE_HTML)

    for (const tag of ALLOWLISTED_TAGS) {
      expect(wrapper.find(tag).exists(), `the fixture rendered no <${tag}>`).toBe(true)
    }
  })

  it('opens a link that leaves the app in a new tab, and leaves the others alone', async () => {
    const wrapper = await mountArticle(FIXTURE_HTML)
    const external = wrapper.get('a[href="https://other-site.test/article"]')

    expect(external.attributes('target')).toBe('_blank')
    // Without noreferrer the opened page can reach back through window.opener.
    expect(external.attributes('rel')).toBe('noopener noreferrer')

    const internal = wrapper.get('a[href="#a-section"]')
    expect(internal.attributes('target')).toBeUndefined()
    expect(internal.attributes('rel')).toBeUndefined()

    // mailto is not http, so it is not a tab to open either.
    const mail = wrapper.get('a[href^="mailto:"]')
    expect(mail.attributes('target')).toBeUndefined()
  })

  it('loads every image lazily', async () => {
    const wrapper = await mountArticle(FIXTURE_HTML)
    const images = wrapper.findAll('img')

    expect(images).toHaveLength(2)
    for (const image of images) expect(image.attributes('loading')).toBe('lazy')
  })

  it('puts an image that fails to load behind its own alt text', async () => {
    const wrapper = await mountArticle(FIXTURE_HTML)
    const image = wrapper.get('img[src="https://images.test/chart.png"]')

    expect(wrapper.text()).not.toContain('A chart of the growth')
    image.element.dispatchEvent(new Event('error'))

    expect(wrapper.text()).toContain('A chart of the growth')
    expect(wrapper.find('img[src="https://images.test/chart.png"]').exists()).toBe(false)
    // The other image is untouched: one failure is not the article's failure.
    expect(wrapper.find('img[src="https://images.test/second.png"]').exists()).toBe(true)
  })

  it('says an image is unavailable when it was described as nothing', async () => {
    const wrapper = await mountArticle('<p><img src="https://images.test/no-alt.png" alt="" /></p>')

    wrapper.get('img').element.dispatchEvent(new Event('error'))

    expect(wrapper.text()).toContain('Image unavailable')
  })
})

describe('ArticleContent when the article it holds is replaced', () => {
  let added: number
  let removed: number

  beforeEach(() => {
    added = 0
    removed = 0
    // The bookkeeping is what the case is about, and it is invisible in the
    // DOM: a handler left on a node nobody can reach any more looks exactly
    // like a handler that was taken off.
    vi.spyOn(HTMLImageElement.prototype, 'addEventListener').mockImplementation(function (
      this: HTMLImageElement,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type === 'error') added += 1
      return EventTarget.prototype.addEventListener.call(this, type, listener, options)
    } as typeof HTMLImageElement.prototype.addEventListener)

    vi.spyOn(HTMLImageElement.prototype, 'removeEventListener').mockImplementation(function (
      this: HTMLImageElement,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ) {
      if (type === 'error') removed += 1
      return EventTarget.prototype.removeEventListener.call(this, type, listener, options)
    } as typeof HTMLImageElement.prototype.removeEventListener)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const PENDING = '<p>Extracting…</p>'
  const FINAL =
    '<p><a href="https://other-site.test/a">External</a><img src="https://images.test/one.png" alt="One" /></p>'
  const AGAIN =
    '<p><a href="https://other-site.test/b">Another external</a><img src="https://images.test/two.png" alt="Two" /></p>'

  it('decorates the final article, not the placeholder it replaced', async () => {
    const wrapper = await mountArticle(PENDING)
    expect(wrapper.findAll('img')).toHaveLength(0)

    await replaceArticle(wrapper, FINAL)

    expect(wrapper.get('a').attributes('target')).toBe('_blank')
    expect(wrapper.get('a').attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.get('img').attributes('loading')).toBe('lazy')
    expect(added).toBe(1)
    expect(removed).toBe(0)
  })

  it('leaves one listener per current image and none on the nodes it dropped', async () => {
    const wrapper = await mountArticle(PENDING)
    await replaceArticle(wrapper, FINAL)
    const dropped = wrapper.get('img').element

    await replaceArticle(wrapper, AGAIN)

    // Two images have ever existed, one listener each, and the first one's was
    // taken off when its node left the document.
    expect(added).toBe(2)
    expect(removed).toBe(1)

    const current = wrapper.get('img').element
    expect(current).not.toBe(dropped)
    expect(current.getAttribute('src')).toBe('https://images.test/two.png')

    // The node that left still fires its event; nothing is listening, so the
    // article is not rewritten behind the reader's back.
    dropped.dispatchEvent(new Event('error'))
    expect(wrapper.text()).not.toContain('One')
    expect(wrapper.get('a').attributes('rel')).toBe('noopener noreferrer')
  })

  it('takes its listeners off when it is unmounted', async () => {
    const wrapper = await mountArticle(PENDING)
    await replaceArticle(wrapper, FINAL)
    expect(removed).toBe(0)

    wrapper.unmount()

    expect(removed).toBe(1)
  })
})
