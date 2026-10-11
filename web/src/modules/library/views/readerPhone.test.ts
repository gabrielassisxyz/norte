import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
  it('puts the actions in a bar and takes them out of the header', async () => {
    const { wrapper } = await mountReader()

    expect(wrapper.find('.reader-top-actions').exists()).toBe(false)
    const bar = wrapper.get('nav[aria-label="Reading actions"]')
    for (const action of ['location-inbox', 'location-up_next', 'location-later', 'location-archive', 'location-stash', 'read']) {
      expect(bar.find(`[data-action="${action}"]`).exists()).toBe(true)
    }
    // The notes module's own controls arrive through the bottom-actions slot.
    expect(bar.find('[data-action="destacar"]').exists()).toBe(true)
    expect(bar.find('[data-action="anotar-abrir"]').exists()).toBe(true)
    expect(bar.find('[data-action="pergunta-abrir"]').exists()).toBe(true)
  })

  it('marks the item read from the bar', async () => {
    const { wrapper, library } = await mountReader()

    await wrapper.get('nav[aria-label="Reading actions"] [data-action="read"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { unread: false } }])
  })

  it('moves the item to another shelf from the bar', async () => {
    const { wrapper, library } = await mountReader()

    await wrapper.get('[data-action="location-later"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { location: 'later' } }])
  })

  it('reads a selection that fired no mouseup, and highlights it from the bar', async () => {
    const { wrapper, notes } = await mountReader()

    // A long press and the handles that follow it produce neither a mouseup nor
    // a keyup, which is all the reader used to listen to. This is that case.
    expect(wrapper.get('[data-action="destacar"]').attributes('disabled')).toBeDefined()

    selectInArticle('The marked passage.')
    document.dispatchEvent(new Event('selectionchange'))
    await settleSelection()

    expect(wrapper.get('[data-action="destacar"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-action="destacar"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedHighlights).toHaveLength(1)
    expect(notes.calls.addedHighlights[0].exact).toBe('The marked passage.')
    expect(notes.calls.addedHighlights[0].prefix).toContain('Before the passage.')
  })

  it('reads the selection once per burst of selectionchange, not once per event', async () => {
    const { wrapper } = await mountReader()

    selectInArticle('The marked passage.')
    for (let i = 0; i < 5; i += 1) document.dispatchEvent(new Event('selectionchange'))
    // Nothing yet: the debounce is what keeps the control from flickering
    // through every passage a dragged handle passes over.
    await flushReads()
    expect(wrapper.get('[data-action="destacar"]').attributes('disabled')).toBeDefined()

    await settleSelection()
    expect(wrapper.get('[data-action="destacar"]').attributes('disabled')).toBeUndefined()
  })

  it('opens the annotations sheet from the bar and closes it again', async () => {
    const { wrapper } = await mountReader()

    const sheet = () => wrapper.get('[data-reader-sheet]')
    expect(sheet().attributes('style')).toContain('display: none')

    await wrapper.get('[data-action="anotar-abrir"]').trigger('click')
    expect(sheet().attributes('style')).not.toContain('display: none')
    expect(sheet().find('#notes-reader-annotation').exists()).toBe(true)

    await wrapper.get('[data-action="close-notes"]').trigger('click')
    expect(sheet().attributes('style')).toContain('display: none')
  })

  it('closes the sheet on Escape', async () => {
    const { wrapper } = await mountReader()
    await wrapper.get('[data-action="anotar-abrir"]').trigger('click')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-reader-sheet]').attributes('style')).toContain('display: none')
  })

  it('writes a question from the sheet', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('[data-action="pergunta-abrir"]').trigger('click')
    await flushReads()

    const field = wrapper.get('[data-reader-sheet] #notes-reader-question')
    await field.setValue('What does this change?')
    await wrapper.get('[data-reader-sheet] [data-action="virar-pergunta"]').trigger('click')
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
    await wrapper.get('[data-action="anotar-abrir"]').trigger('click')
    await wrapper.get('[data-action="close-notes"]').trigger('click')

    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
  })
})
