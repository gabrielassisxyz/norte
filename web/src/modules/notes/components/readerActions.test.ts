import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { libraryRecord } from '@/modules/library/data/testing'
import type { LibraryItemRecord } from '@/modules/library/data/source'
import { fakeLibrarySource } from '@/modules/library/data/testing'
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

const ARTICLE_HTML = '<p>Antes do trecho. O trecho marcado. Depois do trecho.</p>'

const SELECTION = {
  exact: 'O trecho marcado.',
  prefix: 'Antes do trecho. ',
  suffix: ' Depois do trecho.'
}

function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({
    id: 'item-1',
    title: 'Um texto guardado',
    content_html: ARTICLE_HTML,
    ...overrides
  })
}

/** The reader, with whatever this module registered for its slots. */
async function mountReader(
  options: { item?: LibraryItemRecord; notes?: FakeNotesRecords; modules?: string[] } = {}
) {
  setEnabledModules(options.modules ?? ['library', 'notes'])
  const library = fakeLibrarySource([options.item ?? record()])
  const notes = fakeNotesSource(options.notes ?? {})
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/biblioteca/item-1')
  await router.isReady()
  const wrapper = mount(ReaderView, {
    global: { plugins: [router, sourcesPlugin({ library, notes })] },
    attachTo: document.body
  })
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
  mount(ReaderHighlightAction, {
    props: {
      itemId: 'item-1',
      savedSelection: null,
      liveSelection: null,
      clearSelection: () => {},
      articleRoot: root,
      renderedAt: 1,
      scrollToPassage: () => {}
    },
    global: { plugins: [sourcesPlugin({ notes })] }
  })
  await flushReads()
  const marks = Array.from(root.querySelectorAll('mark[data-notes-passage]'))
  return { root, marks, markedText: marks.map((mark) => mark.textContent).join('|') }
}

describe('marking a passage in the article', () => {
  it('marks the occurrence its context points at, not the first one', async () => {
    const { root, marks } = await markedArticle('<p>Um: a mesma frase. fim. Dois: a mesma frase. fim.</p>', [
      { id: 'h-1', exact: 'a mesma frase.', prefix: 'Dois: ', suffix: ' fim.' }
    ])

    expect(marks).toHaveLength(1)
    expect(marks[0].previousSibling?.textContent).toBe('Um: a mesma frase. fim. Dois: ')
    expect(root.textContent).toBe('Um: a mesma frase. fim. Dois: a mesma frase. fim.')
  })

  it('marks a passage that crosses an inline element, one mark per text node', async () => {
    const { markedText, marks } = await markedArticle(
      '<p>Antes. O trecho <em>muito marcado</em> de <a href="#">verdade</a>. Depois.</p>',
      [{ id: 'h-1', exact: 'O trecho muito marcado de verdade.', prefix: 'Antes. ', suffix: ' Depois.' }]
    )

    expect(marks.length).toBeGreaterThan(1)
    expect(markedText).toBe('O trecho |muito marcado| de |verdade|.')
  })

  it('marks a passage whose DOM text has a newline and a double space in it', async () => {
    const { markedText } = await markedArticle('<p>Antes do trecho.\n  O trecho\nmarcado  agora.\nDepois.</p>', [
      { id: 'h-1', exact: 'O trecho marcado agora.', prefix: 'Antes do trecho. ', suffix: ' Depois.' }
    ])

    expect(markedText).toBe('O trecho\nmarcado  agora.')
  })

  it('marks nothing when two occurrences have the same context', async () => {
    const { marks } = await markedArticle('<p>Igual: a mesma frase. fim. Igual: a mesma frase. fim.</p>', [
      { id: 'h-1', exact: 'a mesma frase.', prefix: 'Igual: ', suffix: ' fim.' }
    ])

    expect(marks).toHaveLength(0)
  })

  it('marks nothing when the words around the passage are not the stored ones', async () => {
    const { marks } = await markedArticle('<p>Outra coisa. O trecho marcado. Mais outra.</p>', [
      { id: 'h-1', exact: 'O trecho marcado.', prefix: 'Antes do trecho. ', suffix: ' Depois do trecho.' }
    ])

    expect(marks).toHaveLength(0)
  })
})

describe("the reader's notes actions", () => {
  it('highlights the passage the person selected, with the words around it', async () => {
    const { wrapper, notes } = await mountReader()

    selectInArticle('O trecho marcado.')
    await wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()

    await wrapper.get('[data-action="destacar"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedHighlights).toHaveLength(1)
    const sent = notes.calls.addedHighlights[0]
    expect(sent.item_id).toBe('item-1')
    expect(sent.exact).toBe('O trecho marcado.')
    // The context is what tells two occurrences of one sentence apart, so it
    // has to travel: the server refuses to guess between them without it.
    expect(sent.prefix).toContain('Antes do trecho.')
    expect(sent.suffix).toContain('Depois do trecho.')
  })

  it('tells the reader when the highlight was kept without a position', async () => {
    const { wrapper, notes } = await mountReader()
    notes.addHighlight = async (highlight) =>
      highlightRecord({
        id: 'h-new',
        item_id: highlight.item_id,
        exact: highlight.exact,
        status: 'orphaned',
        ambiguous: true
      })

    selectInArticle('O trecho marcado.')
    await wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()
    await wrapper.get('[data-action="destacar"]').trigger('click')
    await flushReads()

    expect(wrapper.get('[data-notes-ambiguous]').text()).toBe('trecho repetido: destaque guardado sem posição')
  })

  it('says nothing about repetition when the highlight was anchored', async () => {
    const { wrapper } = await mountReader()

    selectInArticle('O trecho marcado.')
    await wrapper.get('.reader-scroll').trigger('mouseup')
    await flushReads()
    await wrapper.get('[data-action="destacar"]').trigger('click')
    await flushReads()

    expect(wrapper.find('[data-notes-ambiguous]').exists()).toBe(false)
  })

  it('marks an anchored passage in the text', async () => {
    const { wrapper } = await mountReader({
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'O trecho marcado.' })] }
    })

    const marked = wrapper.findAll('mark[data-notes-passage]')
    expect(marked).toHaveLength(1)
    expect(marked[0].text()).toBe('O trecho marcado.')
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
      highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'O trecho marcado.' })]
    })
    const wrapper = mount(ReaderHighlightAction, {
      props: {
        itemId: 'item-1',
        savedSelection: null,
        liveSelection: null,
        clearSelection: () => {},
        articleRoot: root,
        renderedAt: 1,
        scrollToPassage: () => {}
      },
      global: { plugins: [sourcesPlugin({ notes })] }
    })
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
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'O trecho marcado.' })] }
    })

    await wrapper.get('.nt-ann button').trigger('click')
    await wrapper.get('#notes-reader-annotation').setValue('Revisar esta ideia.')
    await wrapper.get('[data-action="anotar"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedAnnotations).toEqual([
      { item_id: 'item-1', text: 'Revisar esta ideia.', highlight_id: 'h-1' }
    ])
  })

  it('keeps the one note per item in its own tab', async () => {
    const { wrapper, notes } = await mountReader()

    const tabs = wrapper.findAll('[aria-label="Notas desta leitura"] [role="tab"]')
    await tabs[tabs.length - 1].trigger('click')
    await flushReads()

    await wrapper.get('#notes-reader-note').setValue('Uma nota sobre o texto inteiro.')
    await wrapper.get('[data-action="salvar-nota"]').trigger('click')
    await flushReads()

    expect(notes.calls.writtenNotes).toEqual([
      { itemId: 'item-1', text: 'Uma nota sobre o texto inteiro.' }
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
            exact: 'Um trecho que saiu do texto.'
          })
        ]
      }
    })

    const orphans = wrapper.get('[aria-labelledby="notes-orphans-title"]')
    expect(orphans.text()).toContain('Um trecho que saiu do texto.')
    expect(orphans.text()).toContain('não estão mais neste texto')
    // An orphaned passage is not marked in the text: that is the whole reason
    // it is listed here.
    expect(wrapper.findAll('mark[data-notes-passage]')).toHaveLength(0)
  })

  it('turns a reading into a question, pointing at the margin note it came from', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('#notes-reader-annotation').setValue('Isto merece uma pergunta.')
    await wrapper.get('[data-action="anotar"]').trigger('click')
    await flushReads()
    const annotationId = notes.held.annotations[0].id

    await wrapper.get('[aria-label="Anotação de origem"]').setValue(annotationId)
    await wrapper.get('#notes-reader-question').setValue('Por que isto merece uma pergunta?')
    await wrapper.get('[data-action="virar-pergunta"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([
      {
        item_id: 'item-1',
        text: 'Por que isto merece uma pergunta?',
        annotation_id: annotationId
      }
    ])
  })

  it('refuses a question that does not end in a question mark', async () => {
    const { wrapper, notes } = await mountReader()

    await wrapper.get('#notes-reader-question').setValue('Isto não é uma pergunta')
    await wrapper.get('[data-action="virar-pergunta"]').trigger('click')
    await flushReads()

    expect(wrapper.get('#notes-reader-question-error').text()).toBe('A pergunta precisa terminar com “?”.')
    expect(notes.calls.addedQuestions).toHaveLength(0)
  })

  it('turns the saved selection into a highlight with that exact text', async () => {
    const { wrapper, notes } = await mountReader({ item: record({ selection: SELECTION }) })

    expect(wrapper.get('.reader-selection').text()).toContain('O trecho marcado.')
    await wrapper.get('[data-action="virar-highlight"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedHighlights).toEqual([
      {
        item_id: 'item-1',
        exact: 'O trecho marcado.',
        prefix: 'Antes do trecho. ',
        suffix: ' Depois do trecho.'
      }
    ])
  })

  it('renders none of the five actions when the server lists only the library', async () => {
    const { wrapper } = await mountReader({
      item: record({ selection: SELECTION }),
      notes: { highlights: [highlightRecord({ id: 'h-1', item_id: 'item-1', exact: 'O trecho marcado.' })] },
      modules: ['library']
    })

    // The article is there: this is a reader, not an empty page.
    expect(wrapper.get('.article-content').text()).toContain('O trecho marcado.')
    // And the saved selection still shows, without the action under it.
    expect(wrapper.get('.reader-selection').text()).toContain('O trecho marcado.')

    expect(wrapper.find('[data-action="virar-highlight"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="destacar"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="anotar"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="salvar-nota"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="virar-pergunta"]').exists()).toBe(false)
    expect(wrapper.find('[aria-labelledby="notes-reader-title"]').exists()).toBe(false)
  })
})
