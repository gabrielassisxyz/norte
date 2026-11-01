import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubPhoneViewport } from '@/lib/phoneViewport.testing'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { fakeNotesSource, highlightRecord, type FakeNotesRecords } from '@/modules/notes/data/testing'
import { routes } from '@/router'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeLibrarySource, libraryRecord } from '../data/testing'
import type { LibraryItemRecord } from '../data/source'
import ReaderView from './ReaderView.vue'

// Imported for its side effect: the notes module's registrations are what put
// the highlight control and the sheet's panel in the reader's slots, and the
// bar is only the bar once something is in it.
import '@/modules/notes/index'

const ARTICLE_HTML = '<p>Before the passage. The marked passage. After the passage.</p>'

/**
 * The reader in its phone shape.
 *
 * The shape is chosen by `matchMedia`, which jsdom answers false for, so the
 * stub is what puts the reader on a phone. jsdom computes no layout, so nothing
 * here claims the bar is at the bottom of the screen — only that it is on the
 * page, that the top actions are not, and that every one of its controls does
 * what it says. Where the bar sits is the Playwright walk's claim.
 */
function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({ id: 'item-1', title: 'A saved text', content_html: ARTICLE_HTML, ...overrides })
}

let restoreViewport: () => void

beforeEach(() => {
  restoreViewport = stubPhoneViewport()
  // jsdom has no scrollIntoView, and the sheet uses it to bring the question
  // form into view when the bar asks for it.
  HTMLElement.prototype.scrollIntoView = () => {}
  // It computes no layout either, so a Range answers neither of the two calls
  // the selection toolbar is placed with. Where it lands is the Playwright
  // walk's claim; that it is on the page is this file's.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
})

afterEach(() => {
  restoreViewport()
  resetModuleMounting()
  document.body.innerHTML = ''
})

async function mountReader(options: { item?: LibraryItemRecord; notes?: FakeNotesRecords } = {}) {
  setEnabledModules(['library', 'notes'])
  const library = fakeLibrarySource([options.item ?? record()])
  const notes = fakeNotesSource(options.notes ?? {})
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/library/item-1')
  await router.isReady()
  const wrapper = mount(ReaderView, {
    global: { plugins: [router, sourcesPlugin({ library, notes })] },
    attachTo: document.body
  })
  await flushReads()
  return { wrapper, library, notes }
}

/** A selection over the article's own text, as a browser would report one. */
function selectInArticle(needle: string): void {
  const article = document.querySelector('.article-content')
  if (!article) throw new Error('the article is not on the page')
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? '').indexOf(needle)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + needle.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return
  }
  throw new Error(`the article does not hold ${needle}`)
}

/**
 * Wait out the reader's selection debounce.
 *
 * On a real clock, because the reader also runs an extraction poll and a
 * reading-position timer, and a fake clock would have to be advanced past
 * those too for a claim about one of them.
 */
async function settleSelection(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 260))
  await flushReads()
}

describe('the reader on a phone', () => {
  it('puts the actions in floating controls and takes them out of the header', async () => {
    const { wrapper } = await mountReader()

    expect(wrapper.find('.reader-top').exists()).toBe(false)
    expect(wrapper.find('.reader-top-actions').exists()).toBe(false)
    const cluster = wrapper.get('.reader-cluster')
    expect(cluster.findAll('button, a').map((node) => node.attributes('data-action'))).toEqual(['back', 'read'])

    const strip = wrapper.get('nav[aria-label="Reading actions"]')
    // The notes module's own controls arrive through the bottom-actions slot,
    // ahead of the two the library owns. Highlighting is not one of them: a
    // selection highlights itself.
    expect(strip.findAll('button').map((node) => node.attributes('data-action'))).toEqual([
      'annotate-open',
      'question-open',
      'notebook-open',
      'location-open',
      'more-open'
    ])
    for (const button of strip.findAll('button')) {
      expect(button.text(), button.attributes('data-action')).toBe('')
      expect(button.attributes('aria-label')).toBeTruthy()
      expect(button.attributes('title')).toBe(button.attributes('aria-label'))
    }
    expect(strip.find('[data-action="highlight"]').exists()).toBe(false)
  })

  it('marks the item read from the cluster and shows the filled state once it is', async () => {
    const { wrapper, library } = await mountReader()
    const read = () => wrapper.get('.reader-cluster [data-action="read"]')
    expect(read().attributes('aria-pressed')).toBe('false')

    await read().trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { unread: false } }])
    expect(read().attributes('aria-pressed')).toBe('true')
  })

  it('opens the location sheet, ticks the current row and moves the item in one tap', async () => {
    const { wrapper, library } = await mountReader()
    expect(wrapper.find('[data-reader-sheet="location"]').exists()).toBe(false)

    await wrapper.get('[data-action="location-open"]').trigger('click')

    const sheet = wrapper.get('[data-reader-sheet="location"]')
    expect(sheet.attributes('role')).toBe('dialog')
    expect(sheet.findAll('button').map((node) => node.attributes('data-action'))).toEqual([
      'location-inbox',
      'location-up_next',
      'location-later',
      'location-archive',
      'location-stash'
    ])
    expect(sheet.findAll('[aria-pressed="true"]').map((node) => node.attributes('data-action'))).toEqual([
      'location-inbox'
    ])

    await sheet.get('[data-action="location-later"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { location: 'later' } }])
    expect(wrapper.find('[data-reader-sheet="location"]').exists()).toBe(false)
  })

  it('offers the original page and a confirmed delete from the more sheet', async () => {
    const { wrapper, library } = await mountReader({ item: record({ url: 'https://example.invalid/original' }) })
    const router = wrapper.vm.$router
    await wrapper.get('[data-action="more-open"]').trigger('click')

    const sheet = wrapper.get('[data-reader-sheet="more"]')
    const link = sheet.get('a')
    expect(link.text()).toBe('Open the original')
    expect(link.attributes()).toMatchObject({
      href: 'https://example.invalid/original',
      target: '_blank',
      rel: 'noopener noreferrer'
    })

    await sheet.get('[data-action="delete"]').trigger('click')
    expect(library.calls.delete).toEqual([])
    await wrapper.get('[data-action="cancel-delete"]').trigger('click')
    expect(library.calls.delete).toEqual([])
    expect(wrapper.find('[data-reader-sheet="more"]').exists()).toBe(true)

    await sheet.get('[data-action="delete"]').trigger('click')
    await wrapper.get('[data-action="confirm-delete"]').trigger('click')
    await flushReads()

    await flushReads()

    expect(library.calls.delete).toEqual(['item-1'])
    // The Library's screen is a lazy route, so arriving takes more than a tick.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('library'))
    expect(router.currentRoute.value.query).toEqual({ v: 'all' })
  })

  it('opens the whole notebook from its own icon', async () => {
    const { wrapper } = await mountReader()

    await wrapper.get('[data-action="notebook-open"]').trigger('click')

    expect(wrapper.get('[data-reader-sheet=""]').attributes('style') ?? '').not.toContain('display: none')
  })

  it('publishes the strip height on the document root and takes it back on unmount', async () => {
    const { wrapper } = await mountReader()
    expect(document.documentElement.style.getPropertyValue('--norte-library-reader-bar-height')).not.toBe('')

    wrapper.unmount()

    expect(document.documentElement.style.getPropertyValue('--norte-library-reader-bar-height')).toBe('')
  })

  it('highlights a selection that fired no mouseup, and opens the toolbar over it', async () => {
    const { wrapper, notes } = await mountReader()

    // A long press and the handles that follow it produce neither a mouseup nor
    // a keyup, which is all the reader used to listen to. This is that case.
    selectInArticle('The marked passage.')
    document.dispatchEvent(new Event('selectionchange'))
    await settleSelection()

    expect(notes.calls.addedHighlights).toHaveLength(1)
    expect(notes.calls.addedHighlights[0].exact).toBe('The marked passage.')
    expect(notes.calls.addedHighlights[0].prefix).toContain('Before the passage.')
    expect(wrapper.find('.notes-seltool').exists()).toBe(true)
  })

  it('reads the selection once per burst of selectionchange, not once per event', async () => {
    const { wrapper, notes } = await mountReader()

    selectInArticle('The marked passage.')
    for (let i = 0; i < 5; i += 1) document.dispatchEvent(new Event('selectionchange'))
    // Nothing yet: the debounce is what keeps a dragged handle from highlighting
    // every passage the finger passes over.
    await flushReads()
    expect(notes.calls.addedHighlights).toEqual([])

    await settleSelection()
    expect(notes.calls.addedHighlights).toHaveLength(1)
    expect(wrapper.find('.notes-seltool').exists()).toBe(true)
  })

  it('opens the annotations sheet from the strip and closes it again', async () => {
    const { wrapper } = await mountReader()

    const sheet = () => wrapper.get('[data-reader-sheet]')
    expect(sheet().attributes('style')).toContain('display: none')

    await wrapper.get('[data-action="annotate-open"]').trigger('click')
    expect(sheet().attributes('style')).not.toContain('display: none')
    expect(sheet().find('#notes-reader-annotation').exists()).toBe(true)

    await wrapper.get('[data-action="close-notes"]').trigger('click')
    expect(sheet().attributes('style')).toContain('display: none')
  })

  it('closes the sheet on Escape', async () => {
    const { wrapper } = await mountReader()
    await wrapper.get('[data-action="annotate-open"]').trigger('click')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-reader-sheet]').attributes('style')).toContain('display: none')
  })

  it('writes a question from the sheet', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('[data-action="question-open"]').trigger('click')
    await flushReads()

    const field = wrapper.get('[data-reader-sheet] #notes-reader-question')
    await field.setValue('What does this change?')
    await wrapper.get('[data-reader-sheet] [data-action="turn-into-question"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedQuestions).toHaveLength(1)
    expect(notes.calls.addedQuestions[0].text).toBe('What does this change?')
  })

  it('keeps the sheet mounted while it is shut, so the marking in the text survives', async () => {
    const { wrapper } = await mountReader({
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'The marked passage.' })] }
    })

    // The panel is behind the sheet and it is also what wraps the passage in the
    // article. A `v-if` would undo the marking every time the sheet was closed.
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
    await wrapper.get('[data-action="annotate-open"]').trigger('click')
    await wrapper.get('[data-action="close-notes"]').trigger('click')

    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
  })
})
