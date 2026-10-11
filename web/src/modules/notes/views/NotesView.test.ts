import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import router from '@/router'
import type { AppSources } from '@/sources'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { NotesPage, NotesSource, QuestionRecord } from '../data/source'
import {
  annotationRecord,
  fakeNotesSource,
  highlightRecord,
  noteSource,
  questionRecord,
  type FakeNotesRecords
} from '../data/testing'
import NotesView from './NotesView.vue'

const compilation = noteSource({ id: 'item-compilation', title: 'Como compiladores leem código' })
const garden = noteSource({ id: 'item-garden', title: 'O jardim digital' })

/** A small set of each kind, enough for the tabs, the filter and the links. */
function records(): FakeNotesRecords {
  return {
    highlights: [
      highlightRecord({ id: 'h-1', item_id: compilation.id, exact: 'Observe o exemplo antes de concluir.', source: compilation }),
      highlightRecord({ id: 'h-2', item_id: garden.id, exact: 'Plantar ideias devagar.', source: garden })
    ],
    annotations: [
      annotationRecord({ id: 'a-1', item_id: compilation.id, text: 'Registrar exemplos ajuda.', source: compilation }),
      annotationRecord({ id: 'a-2', item_id: garden.id, text: 'Testar em uma atividade pequena.', source: garden })
    ],
    questions: [
      questionRecord({ id: 'q-1', item_id: compilation.id, text: 'Como aplicar isto amanhã?', source: compilation })
    ]
  }
}

const mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  setEnabledModules(['library', 'notes'])
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

async function mountNotes(path = '/notas', notes: AppSources['notes'] = fakeNotesSource(records())) {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(NotesView, {
    global: { plugins: [router, sourcesPlugin({ notes })] }
  })
  mounted.push(wrapper)
  await flushReads()
  return wrapper
}

describe('NotesView', () => {
  it('renders the title, the segmented control, the filter and the active list', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.get('h1').text()).toBe('Highlights')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.get('#notes-filter').attributes('placeholder')).toBe('Filtrar por texto ou fonte…')
    expect(wrapper.find('[aria-label="Lista de highlights"]').exists()).toBe(true)
    expect(wrapper.findAll('.notes-highlight')).toHaveLength(2)
    expect(wrapper.get('.notes-count').text()).toContain('2 itens')
  })

  it('shows each row with the title of where it came from', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.text()).toContain('Como compiladores leem código')
    expect(wrapper.text()).toContain('O jardim digital')
  })

  it('opens the tab named in the query and keeps switching tabs in the query', async () => {
    const wrapper = await mountNotes('/notas?tab=perguntas')

    expect(wrapper.get('h1').text()).toBe('Perguntas')
    expect(wrapper.find('#new-question').exists()).toBe(true)

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    await flushReads()

    expect(router.currentRoute.value.query.tab).toBe('anotacoes')
    expect(wrapper.get('h1').text()).toBe('Anotações')
    expect(wrapper.findAll('.notes-annotation')).toHaveLength(2)
  })

  it('filters the active list through the source rather than in the page', async () => {
    const notes = fakeNotesSource(records())
    const wrapper = await mountNotes('/notas?tab=anotacoes', notes)

    await wrapper.get('#notes-filter').setValue('registrar exemplos')
    await flushReads()

    expect(wrapper.findAll('.notes-annotation')).toHaveLength(1)
    // The narrowing travelled: a page filtered in the browser would be one page
    // of fifty narrowed down, and would call that the answer.
    expect(notes.calls.annotations.map((call) => call.q)).toContain('registrar exemplos')
  })

  it('filters by the source title as well as by the note text', async () => {
    const wrapper = await mountNotes('/notas?tab=anotacoes')

    await wrapper.get('#notes-filter').setValue('jardim')
    await flushReads()

    expect(wrapper.findAll('.notes-annotation')).toHaveLength(1)
    expect(wrapper.text()).toContain('Testar em uma atividade pequena.')
  })

  it('writes a question with the item chosen rather than a hard-coded one', async () => {
    const notes = fakeNotesSource(records())
    const wrapper = await mountNotes('/notas?tab=perguntas', notes)

    await wrapper.get('#new-question').setValue('Uma pergunta sem final')
    await wrapper.get('form').trigger('submit')
    await flushReads()
    expect(wrapper.get('[role="alert"]').text()).toBe('A pergunta precisa terminar com “?”.')
    expect(notes.calls.addedQuestions).toHaveLength(0)

    await wrapper.get('#new-question-item').setValue(garden.id)
    await wrapper.get('#new-question').setValue('Por que registrar exemplos ajuda?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(notes.calls.addedQuestions).toEqual([
      { text: 'Por que registrar exemplos ajuda?', item_id: garden.id }
    ])
    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('Por que registrar exemplos ajuda?')
  })

  it('offers "sem material" and sends no item when that is chosen', async () => {
    const notes = fakeNotesSource(records())
    const wrapper = await mountNotes('/notas?tab=perguntas', notes)

    await wrapper.get('#new-question').setValue('O que eu ainda não entendi?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([{ text: 'O que eu ainda não entendi?' }])
  })

  it('says a highlight is no longer in the text when the server calls it orphaned', async () => {
    const wrapper = await mountNotes(
      '/notas',
      fakeNotesSource({
        highlights: [
          highlightRecord({ id: 'h-lost', status: 'orphaned', exact: 'Um trecho que saiu do texto.', source: compilation })
        ]
      })
    )

    expect(wrapper.get('.notes-orphaned').text()).toContain('não está mais no texto')
    // The passage itself is still the person's, so it is still on the page.
    expect(wrapper.text()).toContain('Um trecho que saiu do texto.')
  })

  it('links to the reader only while the library is mounted', async () => {
    const withLibrary = await mountNotes()
    expect(withLibrary.get('.notes-highlight .notes-links a').attributes('href')).toBe(
      `/library/${compilation.id}`
    )

    // Notes alone: the registry still gives the title, and there is nowhere to
    // open the source, so the row carries no link.
    setEnabledModules(['notes'])
    const withoutLibrary = await mountNotes()
    expect(withoutLibrary.text()).toContain('Como compiladores leem código')
    expect(withoutLibrary.find('.notes-highlight .notes-links a').exists()).toBe(false)
  })

  // Every tab is a paginated list, so every tab has to be able to grow. One
  // case per tab, because a shared composable proved on one of them is a
  // composable that could be wired into only one of them.
  it.each([
    ['highlights', '/notas', '.notes-highlight'],
    ['anotacoes', '/notas?tab=anotacoes', '.notes-annotation'],
    ['perguntas', '/notas?tab=perguntas', '.notes-question']
  ])('loads a further page of %s when asked, keeping the rows already shown', async (_tab, path, selector) => {
    const many = Array.from({ length: 60 }, (_, index) => index)
    const wrapper = await mountNotes(
      path,
      fakeNotesSource({
        highlights: many.map((index) => highlightRecord({ id: `h-${index}`, exact: `Trecho ${index}`, source: compilation })),
        annotations: many.map((index) => annotationRecord({ id: `a-${index}`, text: `Anotação ${index}`, source: compilation })),
        questions: many.map((index) => questionRecord({ id: `q-${index}`, text: `Pergunta ${index}?`, source: compilation }))
      })
    )

    expect(wrapper.findAll(selector)).toHaveLength(50)

    await wrapper.get('[data-action="carregar-mais"]').trigger('click')
    await flushReads()

    expect(wrapper.findAll(selector)).toHaveLength(60)
    expect(wrapper.find('[data-action="carregar-mais"]').exists()).toBe(false)
  })

  it('says it is loading before the list answers', async () => {
    await router.push('/notas')
    await router.isReady()
    const wrapper = mount(NotesView, {
      global: {
        plugins: [
          router,
          sourcesPlugin({
            notes: fakeNotesSource(
              {},
              { listHighlights: () => new Promise<NotesPage<never>>(() => {}) } as Partial<NotesSource>
            )
          })
        ]
      }
    })
    mounted.push(wrapper)

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando as notas…')
    expect(wrapper.find('.notes-highlight').exists()).toBe(false)
  })

  it('says the tab is empty once it has answered with nothing', async () => {
    const wrapper = await mountNotes('/notas', fakeNotesSource())

    expect(wrapper.get('.notes-state').text()).toContain('Nenhum highlight ainda')
    expect(wrapper.get('.notes-count').text()).toContain('0 itens')
  })

  it('says why the notes could not be read, and reads again when asked', async () => {
    let attempts = 0
    const wrapper = await mountNotes(
      '/notas',
      fakeNotesSource(
        {},
        {
          async listHighlights() {
            attempts += 1
            if (attempts === 1) throw new Error('rede indisponível')
            return { items: [], next_cursor: null }
          }
        }
      )
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar as notas: rede indisponível')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('.notes-state').text()).toContain('Nenhum highlight ainda')
  })

  it('keeps the list and the typed question when the write fails', async () => {
    const wrapper = await mountNotes(
      '/notas?tab=perguntas',
      fakeNotesSource(
        {},
        {
          addQuestion() {
            return Promise.reject(new Error('conflito no servidor'))
          }
        }
      )
    )

    await wrapper.get('#new-question').setValue('Por que isto falhou?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível salvar: conflito no servidor')
    expect((wrapper.get('#new-question').element as HTMLTextAreaElement).value).toBe('Por que isto falhou?')
    expect(wrapper.findAll('.notes-question')).toHaveLength(0)
  })

  it('shows the question the source answered with, not the one it was sent', async () => {
    const answered: QuestionRecord = questionRecord({
      id: 'question-nova',
      text: 'A pergunta como o servidor a guardou?'
    })
    const wrapper = await mountNotes(
      '/notas?tab=perguntas',
      fakeNotesSource({}, { addQuestion: async () => answered })
    )

    await wrapper.get('#new-question').setValue('A pergunta como eu a escrevi?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('A pergunta como o servidor a guardou?')
    expect(wrapper.get('.notes-count').text()).toContain('1 item')
  })

  it('shows no kind badge for a question written on its own, and the label for one with a kind', async () => {
    const wrapper = await mountNotes(
      '/notas?tab=perguntas',
      fakeNotesSource({
        questions: [
          questionRecord({ id: 'q-kindless', text: 'Por quê?', source: compilation }),
          questionRecord({ id: 'q-kind', kind: 'why', text: 'Por que registrar exemplos ajuda?', source: garden })
        ]
      })
    )

    const rows = wrapper.findAll('.notes-question')
    expect(rows).toHaveLength(2)
    // A question written on its own has none of the set's six kinds.
    expect(rows[0].find('.nt-q-kind').exists()).toBe(false)
    expect(rows[1].get('.nt-q-kind').text()).toBe('Por quê')
  })

  it('shows a dropped question as discarded rather than open', async () => {
    const wrapper = await mountNotes(
      '/notas?tab=perguntas',
      fakeNotesSource({
        questions: [
          questionRecord({ id: 'q-open', text: 'O que ficou claro?', status: 'open', source: compilation }),
          questionRecord({ id: 'q-answered', text: 'O que foi respondido?', status: 'answered', source: compilation }),
          questionRecord({ id: 'q-dropped', text: 'O que foi descartado?', status: 'dropped', source: compilation })
        ]
      })
    )

    const rows = wrapper.findAll('.notes-question')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Aberta')
    expect(rows[1].text()).toContain('Respondida')
    expect(rows[2].text()).toContain('Descartada')
    expect(rows[2].text()).not.toContain('Aberta')
  })

  it('aborts the list in flight when the filter changes again', async () => {
    const signals: AbortSignal[] = []
    const wrapper = await mountNotes(
      '/notas',
      fakeNotesSource(
        {},
        {
          listHighlights: (_query, signal) => {
            signals.push(signal)
            return new Promise<NotesPage<never>>(() => {})
          }
        } as Partial<NotesSource>
      )
    )

    await wrapper.get('#notes-filter').setValue('ide')
    await wrapper.get('#notes-filter').setValue('ideia')

    expect(signals.length).toBeGreaterThanOrEqual(3)
    expect(signals[0].aborted).toBe(true)
    expect(signals[signals.length - 1].aborted).toBe(false)
  })
})
