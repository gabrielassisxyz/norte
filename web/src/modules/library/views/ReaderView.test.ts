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
  <p>Opening of the article.</p>
  <h2 id="a-section">A section</h2>
  <p>Body of the section.</p>
  <h2 id="another-section">Another section</h2>
  <p>End.</p>
`

const HEADINGS = JSON.stringify([
  { level: 2, text: 'A section', anchor: 'a-section' },
  { level: 2, text: 'Another section', anchor: 'another-section' }
])

/** The article after a re-extraction that dropped the section it had. */
const REWRITTEN_HTML = '<p>Opening of the article.</p><h2 id="new-section">New section</h2><p>End.</p>'
const REWRITTEN_HEADINGS = JSON.stringify([{ level: 2, text: 'New section', anchor: 'new-section' }])

function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({
    id: 'item-1',
    title: 'A saved text',
    author: 'Norte team',
    site: 'notes.example',
    content_html: ARTICLE_HTML,
    content_headings: HEADINGS,
    ...overrides
  })
}

async function mountReader(library: FakeLibrarySource, id = 'item-1') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/library/${id}`)
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
  // A heading's rectangle is its offset minus how far its container has
  // scrolled, which is what a browser reports. `offsetTop` is deliberately not
  // stubbed: the reader must not depend on which ancestor is positioned.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const container = this.closest('.reader-scroll') as HTMLElement | null
      const top = container && container !== this ? (HEADING_OFFSETS[this.id] ?? 0) - container.scrollTop : 0
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
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
  for (const property of ['getBoundingClientRect', 'scrollHeight', 'clientHeight', 'scrollTop']) {
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

    expect(wrapper.get('[role="status"]').text()).toContain('Extracting this material')
    expect(wrapper.find('.article-content').exists()).toBe(false)
    const asksBefore = library.calls.get.length

    // The extraction finishes between two asks.
    library.records[0].extract_status = 'done'
    library.records[0].content_html = ARTICLE_HTML
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(library.calls.get.length).toBe(asksBefore + 1)
    expect(wrapper.find('.reader-pending').exists()).toBe(false)
    expect(wrapper.get('.article-content').text()).toContain('Opening of the article')

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

  it('names the failure behind a retry the server is already making', async () => {
    // An extraction the server is retrying is pending and carries the error of
    // the attempt before it. Saying only "extracting" leaves a reader watching
    // a spinner for minutes with the reason already on the record.
    const library = fakeLibrarySource([
      record({
        extract_status: 'pending',
        content_html: undefined,
        extract_error: 'resolving example.test: no such host'
      })
    ])
    const { wrapper } = await mountReader(library)

    const pending = wrapper.get('[role="status"]')
    expect(pending.text()).toContain('Extracting this material')
    expect(pending.text()).toContain('resolving example.test: no such host')
    // It is still the pending state: no retry button, because one is running.
    expect(wrapper.find('[data-action="retry-extraction"]').exists()).toBe(false)
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
        extract_error: 'the page answered 403'
      })
    ])
    const { wrapper } = await mountReader(library)

    expect(wrapper.get('[role="alert"]').text()).toContain('the page answered 403')

    await wrapper.get('[data-action="retry-extraction"]').trigger('click')
    await flushReads()

    expect(library.calls.extract).toEqual(['item-1'])
    // The item says what happened next, and it is back to pending.
    expect(wrapper.get('[role="status"]').text()).toContain('Extracting this material')
  })
})

describe('the reader and the place reading stopped', () => {
  it('records the opening once and nothing else on arrival', async () => {
    const library = fakeLibrarySource([record()])
    await mountReader(library)

    expect(library.calls.open).toEqual(['item-1'])
    expect(library.calls.patch).toEqual([])
  })

  // 30%, 45% and 90% of the article, each paired with the heading that sits
  // above it — which is what the reader stores, and what it used to scroll to
  // instead: a reader that followed the anchor restored 30% and 45% at the top
  // of the first section and 90% at the top of the second.
  const STOPPING_POINTS: Array<{ percent: number; anchor: string; pixels: number }> = [
    { percent: 0.3, anchor: 'a-section', pixels: 450 },
    { percent: 0.45, anchor: 'a-section', pixels: 675 },
    { percent: 0.9, anchor: 'another-section', pixels: 1350 }
  ]

  for (const { percent, anchor, pixels } of STOPPING_POINTS) {
    it(`goes back to ${percent * 100}% of the article rather than to the heading above it`, async () => {
      vi.useFakeTimers()
      HEADING_OFFSETS['a-section'] = 400
      HEADING_OFFSETS['another-section'] = 1200
      const library = fakeLibrarySource([record({ read_position: { v: 1, anchor, percent } })])
      const { wrapper } = await mountReader(library)
      const view = scroller(wrapper)

      expect(view.element.scrollTop).toBe(pixels)
      // The criterion as it is written: within 2% of the stored percent. 1500 is
      // the scrollable extent, 2000 - 500.
      expect(Math.abs(view.element.scrollTop / 1500 - percent)).toBeLessThanOrEqual(0.02)
      // It is also not where the anchor is, which is the whole defect.
      expect(view.element.scrollTop).not.toBe(HEADING_OFFSETS[anchor])

      // A scroll delivered while the restore is still settling is that restore,
      // not the reader moving.
      view.nudge()
      await vi.advanceTimersByTimeAsync(3000)
      expect(positionPatches(library)).toEqual([])
    })
  }

  it('snaps to the saved heading when the text moved under the percent by a little', async () => {
    // The case the anchor was stored for: a re-extraction shifted the article a
    // few pixels, so the percent now points just short of the heading reading
    // had reached. 680 is 5px from 0.45 of 1500, inside the 1% correction.
    HEADING_OFFSETS['a-section'] = 680
    const library = fakeLibrarySource([
      record({ read_position: { v: 1, anchor: 'a-section', percent: 0.45 } })
    ])
    const { wrapper } = await mountReader(library)

    expect(scroller(wrapper).element.scrollTop).toBe(680)
  })

  it('uses the saved heading for a position that carries no percent', async () => {
    // A position written before the percent was recorded: the heading is the
    // only thing it says, so it is the only thing to follow.
    HEADING_OFFSETS['another-section'] = 1200
    const library = fakeLibrarySource([record({ read_position: { v: 1, anchor: 'another-section' } })])
    const { wrapper } = await mountReader(library)

    expect(scroller(wrapper).element.scrollTop).toBe(1200)
  })

  it('falls back to the saved percent when the heading is gone from the new text', async () => {
    const library = fakeLibrarySource([
      record({
        content_html: REWRITTEN_HTML,
        content_headings: REWRITTEN_HEADINGS,
        read_position: { v: 1, anchor: 'another-section', percent: 0.5 }
      })
    ])
    const { wrapper } = await mountReader(library)

    expect(wrapper.find('[id="another-section"]').exists()).toBe(false)
    // Half of 2000 - 500.
    expect(scroller(wrapper).element.scrollTop).toBe(750)
    expect(positionPatches(library)).toEqual([])
  })

  it('writes one position for a burst of scrolling, naming the heading above the fold', async () => {
    vi.useFakeTimers()
      HEADING_OFFSETS['a-section'] = 400
      HEADING_OFFSETS['another-section'] = 1200
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
    expect(written[0].patch.read_position).toEqual({ v: 1, anchor: 'a-section', percent: 0.6 })

    // A second burst is a second write, no sooner than the cadence allows.
    view.scrollTo(1500)
    await vi.advanceTimersByTimeAsync(1999)
    expect(positionPatches(library)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(positionPatches(library)).toHaveLength(2)
    expect(positionPatches(library)[1].patch.read_position).toMatchObject({ anchor: 'another-section' })
  })

  it('writes the position it was still holding when the reader is torn down', async () => {
    vi.useFakeTimers()
      HEADING_OFFSETS['a-section'] = 400
      HEADING_OFFSETS['another-section'] = 1200
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library)
    const view = scroller(wrapper)
    await vi.advanceTimersByTimeAsync(10)

    // Well inside the debounce: nothing has been written yet when the reader
    // goes, which is the case that used to lose the last scroll of a reading.
    for (const top of [200, 400, 600]) view.scrollTo(top)
    await vi.advanceTimersByTimeAsync(300)
    expect(positionPatches(library)).toEqual([])

    wrapper.unmount()
    await flushPromises()

    const written = positionPatches(library)
    expect(written).toHaveLength(1)
    expect(written[0]).toEqual({
      id: 'item-1',
      patch: { read_position: { v: 1, anchor: 'a-section', percent: 0.4 } }
    })

    // The timer went with the reader: the flush is one write, not the first of two.
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(positionPatches(library)).toHaveLength(1)
  })

  it('writes nothing on the way out when no scroll is waiting', async () => {
    vi.useFakeTimers()
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library)
    await vi.advanceTimersByTimeAsync(10)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    // Opening an article and leaving it is not a reading position.
    expect(positionPatches(library)).toEqual([])
  })

  it('writes the position of the article being left, not of the one being opened', async () => {
    vi.useFakeTimers()
      HEADING_OFFSETS['a-section'] = 400
      HEADING_OFFSETS['another-section'] = 1200
    const library = fakeLibrarySource([record({ id: 'item-1' }), record({ id: 'item-2' })])
    const { wrapper, router } = await mountReader(library, 'item-1')
    const view = scroller(wrapper)
    await vi.advanceTimersByTimeAsync(10)

    view.scrollTo(600)
    await router.push('/library/item-2')
    await flushPromises()

    const written = positionPatches(library)
    expect(written).toHaveLength(1)
    // The id is captured with the position, so the route having already moved
    // on cannot put one article's place in another article's record.
    expect(written[0].id).toBe('item-1')
    expect(written[0].patch.read_position).toMatchObject({ percent: 0.4 })
  })
})

describe('the reader and the restore guard', () => {
  it('still ignores the scroll event a browser delivers after a zero-delay timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    HEADING_OFFSETS['another-section'] = 1200
    const library = fakeLibrarySource([
      record({ read_position: { v: 1, anchor: 'another-section', percent: 0.2 } })
    ])
    const { wrapper } = await mountReader(library)
    const view = scroller(wrapper)

    // The old guard dropped on this tick; the event below arrives after it.
    await vi.advanceTimersByTimeAsync(0)
    view.nudge()
    await vi.advanceTimersByTimeAsync(3000)
    expect(positionPatches(library)).toEqual([])
  })

  it('reads again once the restore has settled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const library = fakeLibrarySource([
      record({ read_position: { v: 1, anchor: 'a-section', percent: 0.2 } })
    ])
    const { wrapper } = await mountReader(library)
    const view = scroller(wrapper)

    await vi.advanceTimersByTimeAsync(100)
    view.scrollTo(600)
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    expect(positionPatches(library)).toHaveLength(1)
  })
})

describe('the reader and what was selected when the link was saved', () => {
  it('shows the passage, read-only, under its own label', async () => {
    const library = fakeLibrarySource([
      record({ selection: { exact: 'the observable detail is the material', prefix: 'before', suffix: 'later' } })
    ])
    const { wrapper } = await mountReader(library)
    const section = wrapper.get('.reader-selection')

    expect(section.text()).toContain('Passage selected when it was saved')
    expect(section.get('blockquote').text()).toBe('the observable detail is the material')
    expect(section.find('button').exists()).toBe(false)
    expect(section.find('textarea').exists()).toBe(false)
  })

  it('shows nothing there for an item that was saved without one', async () => {
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library)

    expect(wrapper.find('.reader-selection').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Passage selected when it was saved')
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

    expect(wrapper.get('[data-action="read"]').text()).toBe('Mark as read')
    await wrapper.get('[data-action="read"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { unread: false } }])
    expect(wrapper.get('[data-action="read"]').text()).toBe('Mark as unread')
  })

  it('moves it to another shelf, and asks for nothing when it is already there', async () => {
    const library = fakeLibrarySource([record({ location: 'inbox' })])
    const { wrapper } = await mountReader(library)

    const chips = wrapper.findAll('.reader-chip')
    const later = chips.find((chip) => chip.text() === 'Later')!
    await later.trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { location: 'later' } }])
    expect(wrapper.findAll('.reader-chip').find((chip) => chip.text() === 'Later')!.classes()).toContain(
      'is-current'
    )

    await wrapper.findAll('.reader-chip').find((chip) => chip.text() === 'Later')!.trigger('click')
    await flushReads()
    expect(library.calls.patch).toHaveLength(1)
  })

  it('offers all five locations, so none of them is reachable from nowhere', async () => {
    const library = fakeLibrarySource([record({ location: 'inbox' })])
    const { wrapper } = await mountReader(library)

    const labels = wrapper.findAll('.reader-chip').map((chip) => chip.text())
    expect(labels).toEqual(['Inbox', 'Up Next', 'Later', 'Archive', 'Stash'])
  })

  it('sends up_next and stash as the patch body, which no other control can reach', async () => {
    for (const [label, location] of [
      ['Up Next', 'up_next'],
      ['Stash', 'stash']
    ] as const) {
      const library = fakeLibrarySource([record({ location: 'inbox' })])
      const { wrapper } = await mountReader(library)

      await wrapper.findAll('.reader-chip').find((chip) => chip.text() === label)!.trigger('click')
      await flushReads()

      expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { location } }])
      wrapper.unmount()
    }
  })
})

describe('the reader moving between items', () => {
  it('does not show the answer of the item it has already left', async () => {
    let release: (value: LibraryItemRecord) => void = () => {}
    const library = fakeLibrarySource([record({ id: 'item-1', title: 'First' }), record({ id: 'item-2', title: 'Second' })])
    const realOpen = library.openItem.bind(library)
    library.openItem = (id: string) =>
      id === 'item-1' ? new Promise<LibraryItemRecord>((resolve) => (release = resolve)) : realOpen(id)
    const { wrapper, router } = await mountReader(library, 'item-1')

    await router.push('/library/item-2')
    await flushReads()
    release(record({ id: 'item-1', title: 'First' }))
    await flushReads()

    expect(wrapper.text()).toContain('Second')
    expect(wrapper.text()).not.toContain('First')
  })
})

describe('the reader for an item that is not there', () => {
  it('says so instead of rendering an empty article', async () => {
    const library = fakeLibrarySource([record()])
    const { wrapper } = await mountReader(library, 'missing-item')

    expect(wrapper.text()).toContain('This item is not in the library')
    expect(wrapper.find('.article-content').exists()).toBe(false)
  })
})
