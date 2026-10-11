import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { libraryRecord } from '@/modules/library/data/testing'
import type { LibraryItemRecord } from '@/modules/library/data/source'
import { fakeLibrarySource } from '@/modules/library/data/testing'
import { readerSlotProps } from '@/modules/library/readerSlotsTesting'
import ReaderView from '@/modules/library/views/ReaderView.vue'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import ReaderHighlightAction from './ReaderHighlightAction.vue'
import { fakeNotesSource, highlightRecord, type FakeNotesRecords } from '../data/testing'

// Imported for its side effect: the registrations that fill the reader's slots
// live in the module's own index, and the point of this suite is that the
// reader renders what they put there.
import '../index'

const ARTICLE_HTML = '<p>Before the passage. The marked passage. After the passage.</p>'

const SELECTION = {
  exact: 'The marked passage.',
  prefix: 'Before the passage. ',
  suffix: ' After the passage.'
}

function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({
    id: 'item-1',
    title: 'A kept text',
    content_html: ARTICLE_HTML,
    ...overrides
  })
}

/**
 * Everything mounted by a case, so `afterEach` can take it down.
 *
 * The reader listens for `selectionchange` on the document and reads the range
 * a fifth of a second later, and selecting a passage is what most of these
 * cases do: a reader left mounted keeps that timer, and it fires once the file
 * is over and jsdom is gone, which surfaces as `window is not defined` against
 * whichever file runs next.
 */
const mounted: Array<{ unmount: () => void }> = []

/** The reader, with whatever this module registered for its slots. */
async function mountReader(
  options: { item?: LibraryItemRecord; notes?: FakeNotesRecords; modules?: string[] } = {}
) {
  setEnabledModules(options.modules ?? ['library', 'notes'])
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

/**
 * A selection inside the article, as the browser would report one.
 *
 * jsdom has a real Selection, so the range is made over the article's own text
 * node: what the reader computes from it — the passage and the context around
 * it — is then measured against the same text the server extracted.
 */
function selectInArticle(needle: string): void {
  const article = document.querySelector('.article-content')
  if (!article) throw new Error('the article is not on the page')
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const at = (node.textContent ?? '').indexOf(needle)
    if (at >= 0) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    node = walker.nextNode()
  }
  throw new Error(`the article does not hold ${needle}`)
}

beforeEach(() => {
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  resetModuleMounting()
  document.body.innerHTML = ''
})

/** The highlight action over an article built from `html`, without the reader around it. */
async function markedArticle(html: string, highlights: Array<Parameters<typeof highlightRecord>[0]>) {
  setEnabledModules(['library', 'notes'])
  const root = document.createElement('div')
  root.innerHTML = html
  const notes = fakeNotesSource({
    highlights: highlights.map((overrides) => highlightRecord({ item_id: 'item-1', ...overrides }))
  })
  mounted.push(
    mount(ReaderHighlightAction, {
      props: readerSlotProps({ articleRoot: root }),
      global: { plugins: [sourcesPlugin({ notes })] }
    })
  )
  await flushReads()
  const marks = Array.from(root.querySelectorAll('mark[data-notes-passage]'))
  return { root, marks, markedText: marks.map((mark) => mark.textContent).join('|') }
}

describe('marking a passage in the article', () => {
  it('marks the occurrence its context points at, not the first one', async () => {
    const { root, marks } = await markedArticle('<p>One: the same sentence. end. Two: the same sentence. end.</p>', [
      { id: 'h-1', exact: 'the same sentence.', prefix: 'Two: ', suffix: ' end.' }
    ])

    expect(marks).toHaveLength(1)
    expect(marks[0].previousSibling?.textContent).toBe('One: the same sentence. end. Two: ')
    expect(root.textContent).toBe('One: the same sentence. end. Two: the same sentence. end.')
  })

  it('marks a passage that crosses an inline element, one mark per text node', async () => {
    const { markedText, marks } = await markedArticle(
      '<p>Before. The passage <em>deeply marked</em> for <a href="#">real</a>. After.</p>',
      [{ id: 'h-1', exact: 'The passage deeply marked for real.', prefix: 'Before. ', suffix: ' After.' }]
    )

    expect(marks.length).toBeGreaterThan(1)
    expect(markedText).toBe('The passage |deeply marked| for |real|.')
  })

  it('marks a passage whose DOM text has a newline and a double space in it', async () => {
    const { markedText } = await markedArticle('<p>Before the passage.\n  The passage\nmarked  now.\nAfter.</p>', [
      { id: 'h-1', exact: 'The passage marked now.', prefix: 'Before the passage. ', suffix: ' After.' }
    ])

    expect(markedText).toBe('The passage\nmarked  now.')
  })

  it('marks nothing when two occurrences have the same context', async () => {
    const { marks } = await markedArticle('<p>Same: the same sentence. end. Same: the same sentence. end.</p>', [
      { id: 'h-1', exact: 'the same sentence.', prefix: 'Same: ', suffix: ' end.' }
    ])

    expect(marks).toHaveLength(0)
  })

  it('marks nothing when the words around the passage are not the stored ones', async () => {
    const { marks } = await markedArticle('<p>Something else. The marked passage. More besides.</p>', [
      { id: 'h-1', exact: 'The marked passage.', prefix: 'Before the passage. ', suffix: ' After the passage.' }
    ])

    expect(marks).toHaveLength(0)
  })
})

describe("the reader's notes actions", () => {
  it('highlights the passage the person selected, with the words around it', async () => {
    const { wrapper, notes } = await mountReader()

    selectInArticle('The marked passage.')
    await wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()

    await wrapper.get('[data-action="highlight"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedHighlights).toHaveLength(1)
    const sent = notes.calls.addedHighlights[0]
    expect(sent.item_id).toBe('item-1')
    expect(sent.exact).toBe('The marked passage.')
    // The context is what tells two occurrences of one sentence apart, so it
    // has to travel: the server refuses to guess between them without it.
    expect(sent.prefix).toContain('Before the passage.')
    expect(sent.suffix).toContain('After the passage.')
  })

  /** Highlight against a server that answers with `orphan`, which is what it stores. */
  async function destacarAnsweredWith(orphan: Partial<Parameters<typeof highlightRecord>[0]>) {
    const mounted = await mountReader()
    mounted.notes.addHighlight = async (highlight) =>
      highlightRecord({
        id: 'h-new',
        item_id: highlight.item_id,
        exact: highlight.exact,
        ...orphan
      })

    selectInArticle('The marked passage.')
    await mounted.wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()
    await mounted.wrapper.get('[data-action="highlight"]').trigger('click')
    await flushReads()
    return mounted
  }

  it('tells the reader the passage is repeated when that is why it has no position', async () => {
    const { wrapper } = await destacarAnsweredWith({ status: 'orphaned', ambiguous: true })

    expect(wrapper.get('[data-notes-unplaced="repeated"]').text()).toBe(
      'repeated passage: highlight kept without a position'
    )
  })

  it('tells the reader the passage was not found when the answer carries no reason', async () => {
    // The server sends `ambiguous` only for a repeated passage: one it simply
    // could not find comes back `orphaned` and nothing else, which showed the
    // person no mark and no message at all.
    const { wrapper } = await destacarAnsweredWith({ status: 'orphaned' })

    expect(wrapper.get('[data-notes-unplaced="missing"]').text()).toBe(
      'passage not found in this text: highlight kept without a position'
    )
  })

  it('says nothing about a position when the highlight was anchored', async () => {
    const { wrapper } = await destacarAnsweredWith({ status: 'anchored', ambiguous: true })

    // `ambiguous` on an anchored answer is not a reason to warn: the passage is
    // in the text, and the mark is on it.
    expect(wrapper.find('[data-notes-unplaced]').exists()).toBe(false)
  })

  it('marks an anchored passage in the text', async () => {
    const { wrapper } = await mountReader({
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'The marked passage.' })] }
    })

    const marked = wrapper.findAll('mark[data-notes-passage]')
    expect(marked).toHaveLength(1)
    expect(marked[0].text()).toBe('The marked passage.')
  })

  it('marks the passage again every time the article renders, not once', async () => {
    // The article's element stands in for what `v-html` produces, because what
    // is under test is exactly what happens to it: a re-extraction replaces the
    // whole subtree, every wrapper the marking put in it is gone with it, and
    // the only signal that it happened is the render counter.
    setEnabledModules(['library', 'notes'])
    const root = document.createElement('div')
    root.innerHTML = ARTICLE_HTML
    const notes = fakeNotesSource({
      highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'The marked passage.' })]
    })
    const wrapper = mount(ReaderHighlightAction, {
      props: readerSlotProps({ articleRoot: root }),
      global: { plugins: [sourcesPlugin({ notes })] }
    })
    mounted.push(wrapper)
    await flushReads()
    expect(root.querySelectorAll('mark[data-notes-passage]')).toHaveLength(1)

    root.innerHTML = ARTICLE_HTML
    expect(root.querySelectorAll('mark[data-notes-passage]')).toHaveLength(0)

    await wrapper.setProps({ renderedAt: 2 })
    await flushReads()
    expect(root.querySelectorAll('mark[data-notes-passage]')).toHaveLength(1)
  })

  it('writes a note in the margin against the passage it was opened on', async () => {
    const { wrapper, notes } = await mountReader({
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'The marked passage.' })] }
    })

    await wrapper.get('.nt-ann button').trigger('click')
    await wrapper.get('#notes-reader-annotation').setValue('Revisit this idea.')
    await wrapper.get('[data-action="annotate"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedAnnotations).toEqual([
      { item_id: 'item-1', text: 'Revisit this idea.', highlight_id: 'h-1' }
    ])
  })

  it('keeps the one note per item in its own tab', async () => {
    const { wrapper, notes } = await mountReader()

    const tabs = wrapper.findAll('[aria-label="Notes for this reading"] [role="tab"]')
    await tabs[tabs.length - 1].trigger('click')
    await flushReads()

    await wrapper.get('#notes-reader-note').setValue('A note about the whole text.')
    await wrapper.get('[data-action="save-note"]').trigger('click')
    await flushReads()

    expect(notes.calls.writtenNotes).toEqual([
      { itemId: 'item-1', text: 'A note about the whole text.' }
    ])
  })

  it('lists an orphaned passage below the text instead of hiding it', async () => {
    const { wrapper } = await mountReader({
      notes: {
        highlights: [
          highlightRecord({
            id: 'h-lost',
            item_id: 'item-1',
            status: 'orphaned',
            exact: 'A passage that left the text.'
          })
        ]
      }
    })

    const orphans = wrapper.get('[aria-labelledby="notes-orphans-title"]')
    expect(orphans.text()).toContain('A passage that left the text.')
    expect(orphans.text()).toContain('not found in this text')
    // The reader cannot know why a stored passage has no position, so it must
    // not name a reason: `ambiguous` rides the create response and is never
    // stored, and a re-extraction is only one of the two ways this list fills.
    expect(orphans.text()).not.toContain('extracted again')
    expect(orphans.text()).toContain('They may be repeated in the text or no longer in it')
    // An orphaned passage is not marked in the text: that is the whole reason
    // it is listed here.
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)
  })

  it('turns a reading into a question, pointing at the margin note it came from', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('#notes-reader-annotation').setValue('This deserves a question.')
    await wrapper.get('[data-action="annotate"]').trigger('click')
    await flushReads()
    const annotationId = notes.held.annotations[0].id

    await wrapper.get('[aria-label="Source annotation"]').setValue(annotationId)
    await wrapper.get('#notes-reader-question').setValue('Why does this deserve a question?')
    // The conversion carries one verb everywhere: the button reads as it acts.
    expect(wrapper.get('[data-action="turn-into-question"]').text()).toBe('Turn into a question')
    await wrapper.get('[data-action="turn-into-question"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([
      {
        item_id: 'item-1',
        text: 'Why does this deserve a question?',
        annotation_id: annotationId
      }
    ])
  })

  it('refuses a question that does not end in a question mark', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('#notes-reader-question').setValue('This is not a question')
    await wrapper.get('[data-action="turn-into-question"]').trigger('click')
    await flushReads()

    expect(wrapper.get('#notes-reader-question-error').text()).toBe('A question has to end with “?”.')
    expect(notes.calls.addedQuestions).toHaveLength(0)
  })

  it('turns the saved selection into a highlight with that exact text', async () => {
    const { wrapper, notes } = await mountReader({ item: record({ selection: SELECTION }) })

    expect(wrapper.get('.reader-selection').text()).toContain('The marked passage.')
    expect(wrapper.get('[data-action="turn-into-highlight"]').text()).toBe('Turn into a highlight')
    await wrapper.get('[data-action="turn-into-highlight"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedHighlights).toEqual([
      {
        item_id: 'item-1',
        exact: 'The marked passage.',
        prefix: 'Before the passage. ',
        suffix: ' After the passage.'
      }
    ])
  })

  it('marks the saved selection in the text as soon as it is stored, with no reload', async () => {
    const { wrapper } = await mountReader({ item: record({ selection: SELECTION }) })
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)

    await wrapper.get('[data-action="turn-into-highlight"]').trigger('click')
    await flushReads()

    // The passage layer is a second copy of the item's notes, held by the
    // action under the article: it only learns about the new highlight because
    // the creation makes every copy read again.
    const marked = wrapper.findAll('mark[data-notes-passage]')
    expect(marked).toHaveLength(1)
    expect(marked[0].text()).toBe('The marked passage.')
  })

  it('stops offering "Turn into a highlight" once the passage is stored', async () => {
    const { wrapper } = await mountReader({ item: record({ selection: SELECTION }) })

    await wrapper.get('[data-action="turn-into-highlight"]').trigger('click')
    await flushReads()

    expect(wrapper.find('[data-action="turn-into-highlight"]').exists()).toBe(false)
    expect(wrapper.get('.notes-selection-done').text()).toBe('Passage kept in the highlights.')
  })

  it('does not offer "Turn into a highlight" for a passage the item already holds', async () => {
    // What a reload looks like: the highlight is on the server and the action is
    // mounted knowing nothing of the click that made it. Offering the button
    // again is how a second copy of one passage got stored.
    const { wrapper } = await mountReader({
      item: record({ selection: SELECTION }),
      notes: {
        highlights: [
          highlightRecord({
            id: 'h-stored',
            item_id: 'item-1',
            exact: 'The marked passage.',
            prefix: 'Before the passage. ',
            suffix: ' After the passage.'
          })
        ]
      }
    })

    expect(wrapper.find('[data-action="turn-into-highlight"]').exists()).toBe(false)
    expect(wrapper.get('.notes-selection-done').text()).toBe('Passage kept in the highlights.')
  })

  it('puts a passage highlighted with Highlight in the margin list, with no reload', async () => {
    const { wrapper } = await mountReader()
    expect(wrapper.findAll('.nt-ann')).toHaveLength(0)

    selectInArticle('The marked passage.')
    await wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()
    await wrapper.get('[data-action="highlight"]').trigger('click')
    await flushReads()

    // The panel under the article holds its own copy of the item's notes, so
    // this row is only here because the creation made that copy read again.
    const rows = wrapper.findAll('.nt-ann')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('The marked passage.')
  })

  it('renders none of the five actions when the server lists only the library', async () => {
    const { wrapper } = await mountReader({
      item: record({ selection: SELECTION }),
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'The marked passage.' })] },
      modules: ['library']
    })

    // The article is there: this is a reader, not an empty page.
    expect(wrapper.get('.article-content').text()).toContain('The marked passage.')
    // And the saved selection still shows, without the action under it.
    expect(wrapper.get('.reader-selection').text()).toContain('The marked passage.')

    expect(wrapper.find('[data-action="turn-into-highlight"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="highlight"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="annotate"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="save-note"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="turn-into-question"]').exists()).toBe(false)
    expect(wrapper.find('[aria-labelledby="notes-reader-title"]').exists()).toBe(false)
  })
})
