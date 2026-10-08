import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeLibrarySource, libraryRecord, type FakeLibrarySource } from '../data/testing'
import type { LibraryItemRecord } from '../data/source'
import ReaderView from './ReaderView.vue'

const ARTICLE_HTML = `
  <p>Abertura do artigo.</p>
  <h2 id="uma-secao">Uma seção</h2>
  <p>Corpo da seção.</p>
  <h2 id="outra-secao">Outra seção</h2>
  <p>Fim.</p>
`

const HEADINGS = JSON.stringify([
  { level: 2, text: 'Uma seção', anchor: 'uma-secao' },
  { level: 2, text: 'Outra seção', anchor: 'outra-secao' }
])

/** The article after a re-extraction that dropped the section it had. */
const REWRITTEN_HTML = '<p>Abertura do artigo.</p><h2 id="secao-nova">Seção nova</h2><p>Fim.</p>'
const REWRITTEN_HEADINGS = JSON.stringify([{ level: 2, text: 'Seção nova', anchor: 'secao-nova' }])

function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({
    id: 'item-1',
    title: 'Um texto guardado',
    author: 'Equipe Norte',
    site: 'notas.example',
    content_html: ARTICLE_HTML,
    content_headings: HEADINGS,
    ...overrides
  })
}

async function mountReader(library: FakeLibrarySource, id = 'item-1') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/biblioteca/${id}`)
  await router.isReady()
  const wrapper = mount(ReaderView, {
    global: { plugins: [router, sourcesPlugin({ library })] },
    attachTo: document.body
  })
  await flushReads()
  return { wrapper, router }
}

/**
 * A layout, because jsdom does not produce one.
 *
 * The reader restores its position as soon as the final text is mounted, which
 * is before any test can reach into the DOM — so the geometry has to be in
 * place before the first render, and that means the prototype rather than one
 * element. A heading's offset is keyed by its anchor, which is the same thing
 * the reader looks it up by.
 */
const HEADING_OFFSETS: Record<string, number> = {}
const SCROLL_TOPS = new WeakMap<HTMLElement, number>()
let scrollGeometry = { scrollHeight: 2000, clientHeight: 500 }

function installLayout(geometry: { scrollHeight: number; clientHeight: number }): void {
  scrollGeometry = geometry
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return HEADING_OFFSETS[this.id] ?? 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollGeometry.scrollHeight
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => scrollGeometry.clientHeight
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return SCROLL_TOPS.get(this) ?? 0
    },
    set(this: HTMLElement, value: number) {
      SCROLL_TOPS.set(this, value)
    }
  })
}

function removeLayout(): void {
  for (const property of ['offsetTop', 'scrollHeight', 'clientHeight', 'scrollTop']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property]
  }
  for (const anchor of Object.keys(HEADING_OFFSETS)) delete HEADING_OFFSETS[anchor]
}

function scroller(wrapper: VueWrapper) {
  const element = wrapper.get('.reader-scroll').element as HTMLElement
  return {
    element,
    scrollTo(value: number) {
      element.scrollTop = value
      element.dispatchEvent(new Event('scroll'))
    },
    nudge() {
      element.dispatchEvent(new Event('scroll'))
    }
  }
}

function positionPatches(library: FakeLibrarySource) {
  return library.calls.patch.filter((call) => call.patch.read_position !== undefined)
}

beforeEach(() => {
  setEnabledModules(['library'])
  installLayout({ scrollHeight: 2000, clientHeight: 500 })
})

afterEach(() => {
  removeLayout()
  resetModuleMounting()
  vi.useRealTimers()
})

describe('the reader while the text is still being extracted', () => {
  it('says it is extracting, then shows the article, and stops asking on leave', async () => {
    vi.useFakeTimers()
    const pending = record({ extract_status: 'pending', content_html: undefined })
    const library = fakeLibrarySource([pending])
    const { wrapper } = await mountReader(library)

    expect(wrapper.get('[role="status"]').text()).toContain('Extraindo o texto')
    expect(wrapper.find('.article-content').exists()).toBe(false)
    const asksBefore = library.calls.get.length

    // The extraction finishes between two asks.
    library.records[0].extract_status = 'done'
    library.records[0].content_html = ARTICLE_HTML
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(library.calls.get.length).toBe(asksBefore + 1)
    expect(wrapper.find('.reader-pending').exists()).toBe(false)
    expect(wrapper.get('.article-content').text()).toContain('Abertura do artigo')

    // Done is done: no further asks, whatever the clock does.
    const asksAfter = library.calls.get.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(library.calls.get.length).toBe(asksAfter)
  })

  it('backs the asks off while the answer stays pending', async () => {
    vi.useFakeTimers()
    const library = fakeLibrarySource([record({ extract_status: 'pending', content_html: undefined })])
    await mountReader(library)
    const asksBefore = library.calls.get.length

    // 1 s, then 2 s, then 4 s, then every 10 s.
    await vi.advanceTimersByTimeAsync(999)
    expect(library.calls.get.length).toBe(asksBefore)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(library.calls.get.length).toBe(asksBefore + 1)

    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(library.calls.get.length).toBe(asksBefore + 2)
    await vi.advanceTimersByTimeAsync(4000)
    await flushPromises()
    expect(library.calls.get.length).toBe(asksBefore + 3)
    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()
    expect(library.calls.get.length).toBe(asksBefore + 4)
  })

  it('asks nothing more once the reader is gone', async () => {
    vi.useFakeTimers()
    const library = fakeLibrarySource([record({ extract_status: 'pending', content_html: undefined })])
    const { wrapper } = await mountReader(library)

    wrapper.unmount()
    const asks = library.calls.get.length
    await vi.advanceTimersByTimeAsync(60_000)

    expect(library.calls.get.length).toBe(asks)
  })
})

describe('the reader when the extraction failed', () => {
  it('shows the reason and queues another extraction from the button', async () => {
    const library = fakeLibrarySource([
      record({
        extract_status: 'failed',
        content_html: undefined,
        extract_error: 'a página respondeu 403'
      })
    ])
    const { wrapper } = await mountReader(library)

    expect(wrapper.get('[role="alert"]').text()).toContain('a página respondeu 403')

    await wrapper.get('[data-action="retry-extraction"]').trigger('click')
    await flushReads()

    expect(library.calls.extract).toEqual(['item-1'])
    // The item says what happened next, and it is back to pending.
    expect(wrapper.get('[role="status"]').text()).toContain('Extraindo o texto')
  })
})

describe('the reader and the place reading stopped', () => {
  it('records the opening once and nothing else on arrival', async () => {
    const library = fakeLibrarySource([record()])
    await mountReader(library)

    expect(library.calls.open).toEqual(['item-1'])
    expect(library.calls.patch).toEqual([])
  })

  it('goes back to the saved heading, and writes nothing for the scroll that gets it there', async () => {
    vi.useFakeTimers()
    HEADING_OFFSETS['uma-secao'] = 400
    HEADING_OFFSETS['outra-secao'] = 1200
    // The percent is deliberately nowhere near the heading's offset: with the
    // two agreeing, a reader that ignored the anchor would land on the same
    // pixel and the case would pass for the wrong reason.
    const library = fakeLibrarySource([
      record({ read_position: { v: 1, anchor: 'outra-secao', percent: 0.2 } })
    ])
    const { wrapper } = await mountReader(library)
    const view = scroller(wrapper)

    expect(view.element.scrollTop).toBe(1200)

    // A scroll delivered while the restore is still settling is that restore,
    // not the reader moving.
    view.nudge()
    await vi.advanceTimersByTimeAsync(3000)
    expect(positionPatches(library)).toEqual([])
  })

  it('falls back to the saved percent when the heading is gone from the new text', async () => {
    const library = fakeLibrarySource([
      record({
        content_html: REWRITTEN_HTML,
        content_headings: REWRITTEN_HEADINGS,
        read_position: { v: 1, anchor: 'outra-secao', percent: 0.5 }
      })
    ])
    const { wrapper } = await mountReader(library)

    expect(wrapper.find('[id="outra-secao"]').exists()).toBe(false)
    // Half of 2000 - 500.
    expect(scroller(wrapper).element.scrollTop).toBe(750)
    expect(positionPatches(library)).toEqual([])
  })

  it('writes one position for a burst of scrolling, naming the heading above the fold', async () => {
    vi.useFakeTimers()
    HEADING_OFFSETS['uma-secao'] = 400
    HEADING_OFFSETS['outra-secao'] = 1200
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library)
    const view = scroller(wrapper)

    // Past the restore window, so the guard is down.
    await vi.advanceTimersByTimeAsync(10)

    for (const top of [200, 400, 600, 800, 900]) view.scrollTo(top)
    expect(positionPatches(library)).toEqual([])

    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    const written = positionPatches(library)
    expect(written).toHaveLength(1)
    // The last scroll of the burst is the position worth keeping, and 900 is
    // past the first heading and short of the second.
    expect(written[0].patch.read_position).toEqual({ v: 1, anchor: 'uma-secao', percent: 0.6 })

    // A second burst is a second write, no sooner than the cadence allows.
    view.scrollTo(1500)
    await vi.advanceTimersByTimeAsync(1999)
    expect(positionPatches(library)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(positionPatches(library)).toHaveLength(2)
    expect(positionPatches(library)[1].patch.read_position).toMatchObject({ anchor: 'outra-secao' })
  })

  it('writes no position after the reader is gone', async () => {
    vi.useFakeTimers()
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library)
    const view = scroller(wrapper)
    await vi.advanceTimersByTimeAsync(10)

    for (const top of [200, 400, 600]) view.scrollTo(top)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    // One scroll per pending write would be bad enough; a write that lands
    // after the reader is gone belongs to a screen nobody is looking at.
    expect(positionPatches(library)).toEqual([])
  })
})

describe('the reader and what was selected when the link was saved', () => {
  it('shows the passage, read-only, under its own label', async () => {
    const library = fakeLibrarySource([
      record({ selection: { exact: 'o detalhe observável é o material', prefix: 'antes', suffix: 'depois' } })
    ])
    const { wrapper } = await mountReader(library)
    const section = wrapper.get('.reader-selection')

    expect(section.text()).toContain('Trecho selecionado ao salvar')
    expect(section.get('blockquote').text()).toBe('o detalhe observável é o material')
    expect(section.find('button').exists()).toBe(false)
    expect(section.find('textarea').exists()).toBe(false)
  })

  it('shows nothing there for an item that was saved without one', async () => {
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library)

    expect(wrapper.find('.reader-selection').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Trecho selecionado ao salvar')
  })

  it('shows nothing there for a selection that is only whitespace', async () => {
    const library = fakeLibrarySource([record({ selection: { exact: '   ' } })])
    const { wrapper } = await mountReader(library)

    expect(wrapper.find('.reader-selection').exists()).toBe(false)
  })
})

describe('the reader and the shelf an item sits on', () => {
  it('marks it read and shows what came back', async () => {
    const library = fakeLibrarySource([record({ unread: true })])
    const { wrapper } = await mountReader(library)

    expect(wrapper.get('[data-action="read"]').text()).toBe('Marcar como lido')
    await wrapper.get('[data-action="read"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { unread: false } }])
    expect(wrapper.get('[data-action="read"]').text()).toBe('Marcar como não lido')
  })

  it('moves it to another shelf, and asks for nothing when it is already there', async () => {
    const library = fakeLibrarySource([record({ status: 'inbox' })])
    const { wrapper } = await mountReader(library)

    const chips = wrapper.findAll('.reader-chip')
    const depois = chips.find((chip) => chip.text() === 'Depois')!
    await depois.trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { status: 'depois' } }])
    expect(wrapper.findAll('.reader-chip').find((chip) => chip.text() === 'Depois')!.classes()).toContain(
      'is-current'
    )

    await wrapper.findAll('.reader-chip').find((chip) => chip.text() === 'Depois')!.trigger('click')
    await flushReads()
    expect(library.calls.patch).toHaveLength(1)
  })
})

describe('the reader for an item that is not there', () => {
  it('says so instead of rendering an empty article', async () => {
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library, 'nao-existe')

    expect(wrapper.text()).toContain('Este item não está na biblioteca')
    expect(wrapper.find('.article-content').exists()).toBe(false)
  })
})
