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
  <h1 id="o-titulo">O título</h1>
  <p>Um parágrafo com <em>ênfase</em>, <strong>peso</strong>, <i>itálico</i>, <b>negrito</b>,
    <u>sublinhado</u>, <s>riscado</s>, <small>miúdo</small>, <mark>marcado</mark>,
    <span>um trecho</span>, H<sub>2</sub>O e x<sup>2</sup>.<br />Segunda linha.</p>
  <h2 id="uma-secao">Uma seção</h2>
  <ul><li>Primeiro</li><li>Segundo</li></ul>
  <ol start="3"><li>Terceiro</li></ol>
  <dl><dt>Termo</dt><dd>Definição</dd></dl>
  <blockquote cite="https://exemplo.test/fonte">Uma citação.</blockquote>
  <pre class="language-go"><code class="language-go">fmt.Println("oi")</code></pre>
  <p>Aperte <kbd>Ctrl</kbd>, veja <samp>saída</samp> e substitua <var>n</var>.</p>
  <h3 id="mais-fundo">Mais fundo</h3>
  <h4 id="e-mais">E mais</h4>
  <h5 id="ainda-mais">Ainda mais</h5>
  <h6 id="o-fundo">O fundo</h6>
  <figure>
    <img src="https://imagens.test/grafico.png" alt="Um gráfico do crescimento" width="640" height="480" />
    <figcaption>Legenda da figura.</figcaption>
  </figure>
  <table>
    <caption>Uma tabela</caption>
    <thead><tr><th>Chave</th><th>Valor</th></tr></thead>
    <tbody><tr><td colspan="2">Uma célula larga</td></tr></tbody>
    <tfoot><tr><td>Fim</td><td>da tabela</td></tr></tfoot>
  </table>
  <hr />
  <p>
    <a href="https://outro-site.test/artigo">Um link externo</a>
    <a href="#uma-secao">Um link interno</a>
    <a href="mailto:alguem@exemplo.test">Um e-mail</a>
  </p>
  <p><img src="https://imagens.test/segunda.png" alt="A segunda imagem" /></p>
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
    const external = wrapper.get('a[href="https://outro-site.test/artigo"]')

    expect(external.attributes('target')).toBe('_blank')
    // Without noreferrer the opened page can reach back through window.opener.
    expect(external.attributes('rel')).toBe('noopener noreferrer')

    const internal = wrapper.get('a[href="#uma-secao"]')
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
    const image = wrapper.get('img[src="https://imagens.test/grafico.png"]')

    expect(wrapper.text()).not.toContain('Um gráfico do crescimento')
    image.element.dispatchEvent(new Event('error'))

    expect(wrapper.text()).toContain('Um gráfico do crescimento')
    expect(wrapper.find('img[src="https://imagens.test/grafico.png"]').exists()).toBe(false)
    // The other image is untouched: one failure is not the article's failure.
    expect(wrapper.find('img[src="https://imagens.test/segunda.png"]').exists()).toBe(true)
  })

  it('says an image is unavailable when it was described as nothing', async () => {
    const wrapper = await mountArticle('<p><img src="https://imagens.test/sem-alt.png" alt="" /></p>')

    wrapper.get('img').element.dispatchEvent(new Event('error'))

    expect(wrapper.text()).toContain('Imagem indisponível')
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

  const PENDING = '<p>Extraindo…</p>'
  const FINAL =
    '<p><a href="https://outro-site.test/a">Externo</a><img src="https://imagens.test/um.png" alt="Um" /></p>'
  const AGAIN =
    '<p><a href="https://outro-site.test/b">Outro externo</a><img src="https://imagens.test/dois.png" alt="Dois" /></p>'

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
    expect(current.getAttribute('src')).toBe('https://imagens.test/dois.png')

    // The node that left still fires its event; nothing is listening, so the
    // article is not rewritten behind the reader's back.
    dropped.dispatchEvent(new Event('error'))
    expect(wrapper.text()).not.toContain('Um')
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
