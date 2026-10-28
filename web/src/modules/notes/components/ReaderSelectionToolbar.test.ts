import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LibraryItemRecord } from '@/modules/library/data/source'
import { fakeLibrarySource, libraryRecord } from '@/modules/library/data/testing'
import ReaderView from '@/modules/library/views/ReaderView.vue'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { endPassageReselect } from '../data/passageAttach'
import ReaderSelectionToolbar, { type ToolbarAnchor } from './ReaderSelectionToolbar.vue'
import { annotationRecord, fakeNotesSource, highlightRecord, type FakeNotesRecords } from '../data/testing'

// Imported for its side effect: what puts the highlight action in the reader's
// slots is the module's own index, and the gesture under test starts in the
// reader.
import '../index'

const ARTICLE_HTML = '<p>Before the passage. The marked passage. After the passage.</p>'
const PASSAGE = 'The marked passage.'

function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({ id: 'item-1', title: 'A kept text', content_html: ARTICLE_HTML, ...overrides })
}

/**
 * Everything mounted by a case, so `afterEach` can take it down.
 *
 * The reader reads the selection a fifth of a second after it settles, and a
 * reader left mounted fires that timer once jsdom is gone — which surfaces
 * against whichever file runs next.
 */
const mounted: Array<{ unmount: () => void }> = []

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
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, notes, library }
}

/** A selection over a text node of `within`, as the browser would report one. */
function selectText(within: string, needle: string): void {
  const host = document.querySelector(within)
  if (!host) throw new Error(`${within} is not on the page`)
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
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
  throw new Error(`${within} does not hold ${needle}`)
}

/** Select a passage of the article and release it, which is the whole gesture. */
async function releaseSelection(
  wrapper: Awaited<ReturnType<typeof mountReader>>['wrapper'],
  needle = PASSAGE
): Promise<void> {
  selectText('.article-content', needle)
  await wrapper.get('.reader-scroll').trigger('mouseup')
  await flushReads()
}

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  // jsdom computes no layout and gives a Range neither `getClientRects` nor
  // `getBoundingClientRect`, which is how the reader finds the selection's
  // first line. Where the toolbar lands is this file's own claim, made against
  // a rectangle it states rather than against a measured one.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
  window.getSelection()?.removeAllRanges()
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  resetModuleMounting()
  // What the next selection is for is module state: a case that failed while
  // a passage was waiting to be re-selected would hand that wait to the next.
  endPassageReselect()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('selecting a passage in the reader', () => {
  it('highlights it at once, with the words around it, and opens the toolbar', async () => {
    const { wrapper, notes } = await mountReader()

    await releaseSelection(wrapper)

    expect(notes.calls.addedHighlights).toHaveLength(1)
    const sent = notes.calls.addedHighlights[0]
    expect(sent.item_id).toBe('item-1')
    expect(sent.exact).toBe(PASSAGE)
    // The context is what tells two occurrences of one sentence apart, so it
    // has to travel: the server refuses to guess between them without it.
    expect(sent.prefix).toContain('Before the passage.')
    expect(sent.suffix).toContain('After the passage.')
    expect(wrapper.find('.notes-seltool').exists()).toBe(true)
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
  })

  it('sends one request for one gesture, even while the first is still in flight', async () => {
    const { wrapper, notes } = await mountReader()

    /*
      The window between the request going out and the selection being dropped
      is the one that matters, and it is the only one a test can hold open: the
      reader reports a selection from a mouse, from a key and from
      `selectionchange`, and until the answer arrives the browser's selection is
      still there to be reported again. Each report used to be another
      highlight, and nothing before this held that window open long enough to
      show it.
    */
    const sent: Array<{ exact: string }> = []
    let answer = (highlight: ReturnType<typeof highlightRecord>): void => void highlight
    const inFlight = new Promise<ReturnType<typeof highlightRecord>>((resolve) => {
      answer = resolve
    })
    notes.addHighlight = async (highlight) => {
      sent.push({ exact: highlight.exact })
      return inFlight
    }

    selectText('.article-content', PASSAGE)
    await wrapper.get('.reader-scroll').trigger('mouseup')
    expect(sent).toHaveLength(1)

    // The same selection, reported again while the first request is unanswered.
    await wrapper.get('.reader-scroll').trigger('keyup')
    document.dispatchEvent(new Event('selectionchange'))
    await flushReads()

    answer(highlightRecord({ id: 'h-new', item_id: 'item-1', exact: PASSAGE }))
    await flushReads()

    expect(sent).toEqual([{ exact: PASSAGE }])
  })

  it('sends nothing for a selection outside the article', async () => {
    const { wrapper, notes } = await mountReader()

    selectText('.reader-title', 'A kept text')
    await wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()

    expect(notes.calls.addedHighlights).toEqual([])
    expect(wrapper.find('.notes-seltool').exists()).toBe(false)
  })

  it('offers the four actions, in order, named for what each one does', async () => {
    const { wrapper } = await mountReader()

    await releaseSelection(wrapper)

    const labels = wrapper
      .get('.notes-seltool')
      .findAll('button')
      .map((button) => button.attributes('aria-label'))
      .filter((label) => label !== undefined)
    expect(labels).toEqual(['Remove highlight', 'Annotate', 'Ask a question', 'More'])
  })

  it('offers no Highlight and no Cancel button anywhere in the reader', async () => {
    const { wrapper } = await mountReader()

    // The release is the highlight, so there is nothing left to confirm; a
    // button that still offered to do it would highlight the passage twice.
    expect(wrapper.find('[data-action="highlight"]').exists()).toBe(false)
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Cancel')

    await releaseSelection(wrapper)

    expect(wrapper.find('[data-action="highlight"]').exists()).toBe(false)
  })

  it('opens the toolbar for a passage already in the text when it is clicked', async () => {
    const { wrapper } = await mountReader({
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: PASSAGE })] }
    })
    expect(wrapper.find('.notes-seltool').exists()).toBe(false)

    await wrapper.get('mark[data-notes-passage]').trigger('click')
    await flushReads()

    expect(wrapper.find('.notes-seltool').exists()).toBe(true)
    // Nothing was created: the passage was already there.
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
  })

  it('closes on Escape and leaves the highlight where it is', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushReads()

    expect(wrapper.find('.notes-seltool').exists()).toBe(false)
    expect(notes.calls.deletedHighlights).toEqual([])
    expect(notes.held.highlights.map((highlight) => highlight.exact)).toEqual([PASSAGE])
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
  })

  it('removes the highlight it just made, and unmarks the passage', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)
    const created = notes.held.highlights[0].id

    await wrapper.get('[data-action="toolbar-remove"]').trigger('click')
    await flushReads()

    expect(notes.calls.deletedHighlights).toEqual([created])
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)
    expect(wrapper.find('.notes-seltool').exists()).toBe(false)
  })

  it('asks before removing a passage that already carries notes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { wrapper, notes } = await mountReader({
      notes: {
        highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: PASSAGE })],
        annotations: [annotationRecord({ id: 'a-1', item_id: 'item-1', highlight_id: 'h-1', text: 'Kept.' })]
      }
    })

    await wrapper.get('mark[data-notes-passage]').trigger('click')
    await wrapper.get('[data-action="toolbar-remove"]').trigger('click')
    await flushReads()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(notes.calls.deletedHighlights).toEqual([])
  })

  it('writes a note on the passage, and the list beside the text shows it', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)
    const created = notes.held.highlights[0].id

    await wrapper.get('[data-action="toolbar-annotate"]').trigger('click')
    await wrapper.get('.notes-seltool-field').setValue('Worth coming back to.')
    await wrapper.get('[data-action="toolbar-save-annotation"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedAnnotations).toEqual([
      { item_id: 'item-1', text: 'Worth coming back to.', highlight_id: created }
    ])
    // The panel under the article holds its own copy of the item's notes: the
    // row is here only because the creation made that copy read again.
    expect(wrapper.get('[aria-labelledby="notes-reader-title"]').text()).toContain('Worth coming back to.')
  })

  it('attaches the passage to a note written without one instead of creating a second note', async () => {
    const { wrapper, notes } = await mountReader({
      notes: { annotations: [annotationRecord({ id: 'a-loose', item_id: 'item-1', text: 'Written earlier.' })] }
    })
    await releaseSelection(wrapper)
    const created = notes.held.highlights[0].id

    await wrapper.get('[data-action="toolbar-annotate"]').trigger('click')
    await wrapper.get('[data-action="toolbar-attach"][data-note="a-loose"]').trigger('click')
    await flushReads()

    expect(notes.calls.attachedPassages).toEqual([{ id: 'a-loose', highlight_id: created }])
    expect(notes.calls.addedAnnotations).toEqual([])
    expect(notes.held.annotations[0].highlight_id).toBe(created)
  })

  it('asks a question about the passage, with no trailing question mark demanded', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)
    const created = notes.held.highlights[0].id

    await wrapper.get('[data-action="toolbar-question"]').trigger('click')
    await wrapper.get('.notes-seltool-field').setValue('Why this holds')
    await wrapper.get('[data-action="toolbar-save-question"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([
      { item_id: 'item-1', text: 'Why this holds', highlight_id: created }
    ])
  })

  it('copies the passage from the more menu', async () => {
    const { wrapper } = await mountReader()
    await releaseSelection(wrapper)

    await wrapper.get('[aria-label="More"]').trigger('click')
    await wrapper.get('[data-action="toolbar-copy"]').trigger('click')
    await flushReads()

    expect(writeText).toHaveBeenCalledWith(PASSAGE)
  })
})

describe('where the toolbar puts itself', () => {
  /** The toolbar alone, against a rectangle a case states. */
  function mountToolbar(anchor: ToolbarAnchor) {
    const notes = fakeNotesSource({})
    const wrapper = mount(ReaderSelectionToolbar, {
      props: {
        itemId: 'item-1',
        highlight: highlightRecord({ id: 'h-1', item_id: 'item-1', exact: PASSAGE }),
        measure: () => anchor,
        looseNotes: [],
        notesOnPassage: 0
      },
      global: { plugins: [sourcesPlugin({ notes })] },
      attachTo: document.body
    })
    mounted.push(wrapper)
    return wrapper
  }

  it('sits eight pixels above the first line of the selection', () => {
    const style = mountToolbar({ top: 300, bottom: 320, left: 100, width: 200 }).get('.notes-seltool').attributes('style')

    expect(style).toContain('top: 292px')
    expect(style).toContain('translate(-50%, -100%)')
  })

  it('flips below a selection with no room above it', () => {
    const toolbar = mountToolbar({ top: 20, bottom: 40, left: 100, width: 200 }).get('.notes-seltool')

    // 48px from the top of the window is the toolbar's own height plus its gap:
    // above the selection it would be drawn where nothing can be clicked.
    expect(toolbar.classes()).toContain('is-below')
    expect(toolbar.attributes('style')).toContain('top: 48px')
    expect(toolbar.attributes('style')).toContain('translate(-50%, 0)')
  })

  describe('for a selection made by touch', () => {
    const FIRST = { top: 300, bottom: 320, left: 100, width: 200 }
    const LAST = { top: 340, bottom: 360, left: 40, width: 120 }

    function mountTouchToolbar(anchor: ToolbarAnchor) {
      const wrapper = mount(ReaderSelectionToolbar, {
        props: {
          itemId: 'item-1',
          highlight: highlightRecord({ id: 'h-1', item_id: 'item-1', exact: PASSAGE }),
          measure: () => anchor,
          looseNotes: [],
          notesOnPassage: 0,
          touch: true
        },
        global: { plugins: [sourcesPlugin({ notes: fakeNotesSource({}) })] },
        attachTo: document.body
      })
      mounted.push(wrapper)
      return wrapper.get('.notes-seltool')
    }

    afterEach(() => {
      document.documentElement.style.removeProperty('--norte-library-reader-bar-height')
    })

    it('sits 24px below the last line, centred on it, clear of the end handle', () => {
      const toolbar = mountTouchToolbar({ ...FIRST, last: LAST })

      expect(toolbar.attributes('style')).toContain('top: 384px')
      expect(toolbar.attributes('style')).toContain('left: 100px')
      expect(toolbar.attributes('style')).toContain('translate(-50%, 0)')
    })

    it('keeps the 8px edge when the last line is at the window margin', () => {
      const toolbar = mountTouchToolbar({ ...FIRST, last: { top: 340, bottom: 360, left: 0, width: 0 } })

      // Half the toolbar's width is 0 in jsdom, so the clamp is the edge itself.
      expect(toolbar.attributes('style')).toContain('left: 8px')
    })

    it('flips above the first line when the bottom action bar would cover the placement', () => {
      document.documentElement.style.setProperty('--norte-library-reader-bar-height', '80px')
      // 384px plus the toolbar is past 768 - 80, the top of the bar.
      const toolbar = mountTouchToolbar({ top: 400, bottom: 420, left: 100, width: 200, last: { ...LAST, top: 640, bottom: 660 } })

      expect(toolbar.classes()).not.toContain('is-below')
      expect(toolbar.attributes('style')).toContain('top: 392px')
      expect(toolbar.attributes('style')).toContain('translate(-50%, -100%)')
    })

    it('stays below when the same placement clears the bar', () => {
      document.documentElement.style.setProperty('--norte-library-reader-bar-height', '80px')
      const toolbar = mountTouchToolbar({ ...FIRST, last: LAST })

      expect(toolbar.classes()).toContain('is-below')
    })

    it('flips above when there is no room below and the bar is unset', () => {
      const toolbar = mountTouchToolbar({ top: 400, bottom: 420, left: 100, width: 200, last: { ...LAST, top: 730, bottom: 750 } })

      expect(toolbar.classes()).not.toContain('is-below')
      expect(toolbar.attributes('style')).toContain('top: 392px')
    })
  })

  it('measures again when the selection it stands over changes, without a scroll', async () => {
    let anchor: ToolbarAnchor = { top: 300, bottom: 320, left: 100, width: 200 }
    const wrapper = mount(ReaderSelectionToolbar, {
      props: {
        itemId: 'item-1',
        highlight: null,
        pendingText: 'The marked',
        measure: () => anchor,
        looseNotes: [],
        notesOnPassage: 0
      },
      global: { plugins: [sourcesPlugin({ notes: fakeNotesSource({}) })] },
      attachTo: document.body
    })
    mounted.push(wrapper)
    expect(wrapper.get('.notes-seltool').attributes('style')).toContain('top: 292px')

    // A handle was dragged: the words and the line they end on are new.
    anchor = { top: 400, bottom: 420, left: 100, width: 200 }
    await wrapper.setProps({ pendingText: 'The marked passage.' })

    expect(wrapper.get('.notes-seltool').attributes('style')).toContain('top: 392px')
  })

  it('closes once the passage has scrolled out of the window', async () => {
    const anchor: ToolbarAnchor = { top: 300, bottom: 320, left: 100, width: 200 }
    const wrapper = mount(ReaderSelectionToolbar, {
      props: {
        itemId: 'item-1',
        highlight: highlightRecord({ id: 'h-1', item_id: 'item-1', exact: PASSAGE }),
        measure: () => anchor,
        looseNotes: [],
        notesOnPassage: 0
      },
      global: { plugins: [sourcesPlugin({ notes: fakeNotesSource({}) })] },
      attachTo: document.body
    })
    mounted.push(wrapper)

    anchor.top = 300
    window.dispatchEvent(new Event('scroll'))
    expect(wrapper.emitted('close')).toBeUndefined()

    anchor.top = -200
    anchor.bottom = -180
    window.dispatchEvent(new Event('scroll'))

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

/**
 * Correcting a mark that caught the wrong words, which is the whole gesture:
 * the passage is picked in the article, so what proves it is the reader rather
 * than a component on its own — the toolbar that asks, the banner while the
 * person picks, the one request, and the mark that ends up on the new words.
 */
describe("re-selecting a highlight's passage", () => {
  const CORRECTED = 'After the passage.'

  /** The banner over the article, which is teleported out of the passage layer. */
  function banner(): HTMLElement | null {
    return document.querySelector('[data-notes-reselect]')
  }

  function markedPassages(wrapper: Awaited<ReturnType<typeof mountReader>>['wrapper']): string[] {
    return wrapper.findAll('mark[data-notes-passage]').map((mark) => mark.attributes('data-notes-passage') ?? '')
  }

  it('moves the mark onto the new words with one request, keeping the highlight', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)
    const created = notes.held.highlights[0].id

    await wrapper.get('[aria-label="More"]').trigger('click')
    await wrapper.get('[data-action="toolbar-reselect"]').trigger('click')
    await flushReads()

    // The toolbar is out of the way and the banner says what the next
    // selection is for.
    expect(wrapper.find('.notes-seltool').exists()).toBe(false)
    expect(banner()?.textContent).toContain('Select the new passage')

    await releaseSelection(wrapper, CORRECTED)

    expect(notes.calls.reselectedPassages).toHaveLength(1)
    const sent = notes.calls.reselectedPassages[0]
    expect(sent.id).toBe(created)
    expect(sent.passage.exact).toBe(CORRECTED)
    // The context travels for the reason it does on a creation: it is what
    // tells two occurrences of one sentence apart.
    expect(sent.passage.prefix).toContain('marked passage')
    // An offset measured in the browser's DOM says nothing about the server's
    // text, so the hint is 0 and the server searches.
    expect(sent.passage.position_hint).toBe(0)

    // Moved, not made again: the id is the one the notes on it reference.
    expect(notes.calls.addedHighlights).toHaveLength(1)
    expect(notes.held.highlights.map((highlight) => [highlight.id, highlight.exact])).toEqual([[created, CORRECTED]])
    expect(markedPassages(wrapper)).toEqual([CORRECTED])
    expect(banner()).toBeNull()
  })

  it('keeps the notes written on the passage, which is what the correction is for', async () => {
    const { wrapper, notes } = await mountReader({
      notes: {
        highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: PASSAGE })],
        annotations: [annotationRecord({ id: 'a-1', item_id: 'item-1', highlight_id: 'h-1', text: 'Worth keeping.' })]
      }
    })

    await wrapper.get('mark[data-notes-passage]').trigger('click')
    await wrapper.get('[aria-label="More"]').trigger('click')
    await wrapper.get('[data-action="toolbar-reselect"]').trigger('click')
    await releaseSelection(wrapper, CORRECTED)

    expect(notes.held.annotations.map((annotation) => [annotation.text, annotation.highlight_id])).toEqual([
      ['Worth keeping.', 'h-1']
    ])
    // And the margin beside the text quotes the corrected words under that note.
    const row = wrapper.get('.notes-reader-entry[data-key="annotation-a-1"]')
    expect(row.text()).toContain('Worth keeping.')
    expect(row.text()).toContain(CORRECTED)
  })

  it('anchors a passage the text no longer holds, from the list beside the text', async () => {
    const { wrapper, notes } = await mountReader({
      notes: {
        highlights: [
          highlightRecord({
            id: 'h-gone',
            item_id: 'item-1',
            exact: 'A sentence this text never held.',
            status: 'orphaned'
          })
        ]
      }
    })
    expect(wrapper.find('.notes-reader-orphans').exists()).toBe(true)

    await wrapper.get('.notes-reader-orphan-row [data-action="reselect-passage"]').trigger('click')
    await releaseSelection(wrapper)
    await flushReads()

    expect(notes.calls.reselectedPassages.map((call) => [call.id, call.passage.exact])).toEqual([['h-gone', PASSAGE]])
    expect(notes.held.highlights[0].status).toBe('anchored')
    // Out of the section it was listed in, and marked in the text instead.
    expect(wrapper.find('.notes-reader-orphans').exists()).toBe(false)
    expect(markedPassages(wrapper)).toEqual([PASSAGE])
  })

  it('goes back to highlighting after Cancel, rather than correcting the next selection', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)

    await wrapper.get('[aria-label="More"]').trigger('click')
    await wrapper.get('[data-action="toolbar-reselect"]').trigger('click')
    await flushReads()
    ;(banner()?.querySelector('[data-action="cancel-reselect"]') as HTMLButtonElement).click()
    await flushReads()
    expect(banner()).toBeNull()

    await releaseSelection(wrapper, CORRECTED)

    expect(notes.calls.reselectedPassages).toEqual([])
    expect(notes.calls.addedHighlights).toHaveLength(2)
  })

  it('sends nothing for a selection made after Escape', async () => {
    const { wrapper, notes } = await mountReader()
    await releaseSelection(wrapper)

    await wrapper.get('[aria-label="More"]').trigger('click')
    await wrapper.get('[data-action="toolbar-reselect"]').trigger('click')
    await flushReads()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushReads()

    expect(banner()).toBeNull()
    await releaseSelection(wrapper, CORRECTED)
    expect(notes.calls.reselectedPassages).toEqual([])
  })
})

/**
 * When a gesture is finished, which is what decides whether anything is created.
 *
 * A drag fires `selectionchange` and settles while the button is still down, and
 * highlighting there handed out half a sentence and ended the drag: the marks
 * change the DOM under the live selection. A finger has no release the reader
 * can see at all, so there the toolbar opens over the selection and creates
 * nothing until a button asks for it.
 *
 * The timers are fake because the claim is about a selection that holds still
 * for a second, and a second of real waiting per case is the suite's time for a
 * fact a counter already proves.
 */
describe('a selection that is still being made', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Let the reader's settle timer fire, and every read it starts answer. */
  async function settle(ms = 1000): Promise<void> {
    vi.advanceTimersByTime(ms)
    await flushReads()
  }

  /** The toolbar's buttons by what they say, which is what a person acts on. */
  function toolbarLabels(wrapper: Awaited<ReturnType<typeof mountReader>>['wrapper']): string[] {
    return wrapper
      .get('.notes-seltool')
      .findAll('button')
      .map((button) => button.attributes('aria-label'))
      .filter((label): label is string => label !== undefined)
  }

  it('creates nothing while the mouse button is still down, however long it holds still', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('.reader-scroll').trigger('pointerdown', { pointerType: 'mouse' })
    selectText('.article-content', PASSAGE)
    document.dispatchEvent(new Event('selectionchange'))
    await settle()

    expect(notes.calls.addedHighlights).toEqual([])
    expect(wrapper.find('.notes-seltool').exists()).toBe(false)
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)
  })

  it('highlights the whole passage once the button is released, and opens the toolbar', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('.reader-scroll').trigger('pointerdown', { pointerType: 'mouse' })
    // Mid-drag: the words so far, held still long enough to settle.
    selectText('.article-content', 'The marked')
    document.dispatchEvent(new Event('selectionchange'))
    await settle()
    // The rest of the drag, and then the release.
    selectText('.article-content', PASSAGE)
    window.dispatchEvent(new Event('pointerup'))
    await flushReads()

    expect(notes.calls.addedHighlights.map((sent) => sent.exact)).toEqual([PASSAGE])
    expect(wrapper.find('.notes-seltool').exists()).toBe(true)
  })

  it('highlights a selection made with the keyboard on the key release, once', async () => {
    const { wrapper, notes } = await mountReader()

    selectText('.article-content', PASSAGE)
    await wrapper.get('.reader-scroll').trigger('keyup')
    await flushReads()
    // Releasing another key over the same selection is the same gesture. The
    // settle timer is deliberately not advanced: the claim is about the key's
    // own release, and jsdom's own `selectionchange` would otherwise publish
    // the selection a second time and answer for it.
    await wrapper.get('.reader-scroll').trigger('keyup')
    await flushReads()

    expect(notes.calls.addedHighlights.map((sent) => sent.exact)).toEqual([PASSAGE])
    expect(toolbarLabels(wrapper)[0]).toBe('Remove highlight')
  })

  /** A long press and the selection it leaves behind, as a phone reports it. */
  async function touchSelect(
    wrapper: Awaited<ReturnType<typeof mountReader>>['wrapper'],
    needle = PASSAGE
  ): Promise<void> {
    await wrapper.get('.reader-scroll').trigger('pointerdown', { pointerType: 'touch' })
    selectText('.article-content', needle)
    document.dispatchEvent(new Event('selectionchange'))
    window.dispatchEvent(new Event('pointerup'))
    await settle()
  }

  it('opens the toolbar over a touch selection in its pending state, creating nothing', async () => {
    const { wrapper, notes } = await mountReader()

    await touchSelect(wrapper)

    expect(notes.calls.addedHighlights).toEqual([])
    // Nothing in the text either: a mark would change the DOM under the live
    // selection, and the handles would go with it.
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)
    expect(toolbarLabels(wrapper)).toEqual(['Highlight', 'Annotate', 'Ask a question', 'More'])
  })

  it('moves the pending toolbar when the handles change the selection, and sends nothing', async () => {
    const { wrapper, notes } = await mountReader()
    await touchSelect(wrapper, 'The marked')

    // Dragging a handle is the browser's own chrome: it fires `selectionchange`
    // and no pointer event of ours, which is why the gesture is remembered.
    selectText('.article-content', PASSAGE)
    document.dispatchEvent(new Event('selectionchange'))
    await settle()

    expect(notes.calls.addedHighlights).toEqual([])
    expect(toolbarLabels(wrapper)[0]).toBe('Highlight')

    await wrapper.get('[data-action="toolbar-highlight"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedHighlights.map((sent) => sent.exact)).toEqual([PASSAGE])
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(1)
    // The passage exists now, so the toolbar offers to undo it rather than to
    // make it again.
    expect(toolbarLabels(wrapper)[0]).toBe('Remove highlight')
  })

  it('creates the highlight first when a pending toolbar is asked for a note', async () => {
    const { wrapper, notes } = await mountReader()
    await touchSelect(wrapper)

    await wrapper.get('[data-action="toolbar-annotate"]').trigger('click')
    await flushReads()
    expect(notes.calls.addedHighlights).toHaveLength(1)
    const created = notes.held.highlights[0].id

    await wrapper.get('.notes-seltool-field').setValue('Worth coming back to.')
    await wrapper.get('[data-action="toolbar-save-annotation"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedAnnotations).toEqual([
      { item_id: 'item-1', text: 'Worth coming back to.', highlight_id: created }
    ])
  })

  it('creates the highlight first when a pending toolbar is asked for a question', async () => {
    const { wrapper, notes } = await mountReader()
    await touchSelect(wrapper)

    await wrapper.get('[data-action="toolbar-question"]').trigger('click')
    await flushReads()
    expect(notes.calls.addedHighlights).toHaveLength(1)
    const created = notes.held.highlights[0].id

    await wrapper.get('.notes-seltool-field').setValue('Why this holds')
    await wrapper.get('[data-action="toolbar-save-question"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([
      { item_id: 'item-1', text: 'Why this holds', highlight_id: created }
    ])
  })

  it('copies a pending selection without creating anything', async () => {
    const { wrapper, notes } = await mountReader()
    await touchSelect(wrapper)

    await wrapper.get('[aria-label="More"]').trigger('click')
    await wrapper.get('[data-action="toolbar-copy"]').trigger('click')
    await flushReads()

    expect(writeText).toHaveBeenCalledWith(PASSAGE)
    expect(notes.calls.addedHighlights).toEqual([])
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)
  })

  it('closes a pending toolbar when the selection is collapsed', async () => {
    const { wrapper } = await mountReader()
    await touchSelect(wrapper)
    expect(wrapper.find('.notes-seltool').exists()).toBe(true)

    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await settle()

    expect(wrapper.find('.notes-seltool').exists()).toBe(false)
  })
})
