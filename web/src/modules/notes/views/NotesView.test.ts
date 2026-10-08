import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import router from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { NotesList, NotesSource } from '../data/source'
import NotesView from './NotesView.vue'

let store: MockStore

beforeEach(async () => {
  store = createMockStore()
  await router.push('/notas')
})

async function mountNotes(path = '/notas', sources?: Partial<AppSources>) {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(NotesView, {
    global: { plugins: [router, sourcesPlugin(sources ?? createMockSources(store))] }
  })
  await flushReads()
  return wrapper
}

function notesWith(overrides: Partial<NotesSource>): Partial<AppSources> {
  const empty: NotesList = { items: [], next_cursor: null, counts: { highlights: 0, anotacoes: 0, perguntas: 0 } }
  return {
    notes: {
      listNotes: async () => empty,
      materialNotes: async () => ({ highlights: [], annotations: [] }),
      summary: async () => empty.counts,
      addQuestion: async () => {
        throw new Error('not faked')
      },
      addHighlight: async () => {
        throw new Error('not faked')
      },
      addAnnotation: async () => {
        throw new Error('not faked')
      },
      ...overrides
    } as unknown as AppSources['notes']
  }
}

describe('NotesView', () => {
  it('renders the title, the segmented control, filter, and active notes list', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.get('h1').text()).toBe('Highlights')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.get('#notes-filter').attributes('placeholder')).toBe('Filtrar por texto ou fonte…')
    expect(wrapper.find('[aria-label="Lista de highlights"]').exists()).toBe(true)
    expect(wrapper.findAll('.notes-highlight')).toHaveLength(10)
    expect(wrapper.get('.notes-count').text()).toContain('10 itens')
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
    expect(wrapper.findAll('.notes-annotation')).toHaveLength(10)
  })

  it('filters the active list through the source and adds a question at the top', async () => {
    const wrapper = await mountNotes('/notas?tab=perguntas')
    const initialQuestionCount = store.questions.length

    await wrapper.get('#new-question').setValue('Uma pergunta sem final')
    await wrapper.get('form').trigger('submit')
    await flushReads()
    expect(wrapper.get('[role="alert"]').text()).toBe('A pergunta precisa terminar com “?”.')
    expect(store.questions).toHaveLength(initialQuestionCount)

    await wrapper.get('#new-question').setValue('Por que registrar exemplos ajuda?')
    await wrapper.get('form').trigger('submit')
    await flushReads()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(store.questions).toHaveLength(initialQuestionCount + 1)
    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('Por que registrar exemplos ajuda?')

    await wrapper.get('#notes-filter').setValue('registrar exemplos')
    await flushReads()
    expect(wrapper.findAll('.notes-question')).toHaveLength(1)
  })

  it('uses material and decision routes for linked notes', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.get('.notes-highlight .notes-links a').attributes('href')).toBe('/material/post/post-compilation')
    expect(wrapper.get('.notes-highlight .notes-links a + a').attributes('href')).toBe('/decisoes/decision-parser-shape')
  })

  it('says it is loading before the list answers', async () => {
    await router.push('/notas')
    await router.isReady()
    const wrapper = mount(NotesView, {
      global: {
        plugins: [router, sourcesPlugin(notesWith({ listNotes: () => new Promise<NotesList>(() => {}) }))]
      }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando as notas…')
    expect(wrapper.find('.notes-highlight').exists()).toBe(false)
  })

  it('says the tab is empty once it has answered with nothing', async () => {
    const wrapper = await mountNotes('/notas', notesWith({}))

    expect(wrapper.get('.notes-state').text()).toContain('Nenhum highlight ainda')
    expect(wrapper.get('.notes-count').text()).toContain('0 itens')
  })

  it('says why the notes could not be read, and reads again when asked', async () => {
    let attempts = 0
    const wrapper = await mountNotes(
      '/notas',
      notesWith({
        listNotes: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede indisponível')
          return { items: [], next_cursor: null, counts: { highlights: 0, anotacoes: 0, perguntas: 0 } }
        }
      })
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
      notesWith({
        addQuestion: async () => {
          throw new Error('conflito no servidor')
        }
      })
    )

    await wrapper.get('#new-question').setValue('Por que isto falhou?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível salvar: conflito no servidor')
    expect((wrapper.get('#new-question').element as HTMLTextAreaElement).value).toBe('Por que isto falhou?')
    expect(wrapper.findAll('.notes-question')).toHaveLength(0)
  })

  it('shows the question the source answered with, not the one it was sent', async () => {
    const wrapper = await mountNotes(
      '/notas?tab=perguntas',
      notesWith({
        addQuestion: async () => ({
          id: 'question-nova',
          tab: 'perguntas',
          text: 'A pergunta como o servidor a guardou?',
          createdAt: '2026-10-03T12:00:00Z',
          questionKind: 'why'
        })
      })
    )

    await wrapper.get('#new-question').setValue('A pergunta como eu a escrevi?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('A pergunta como o servidor a guardou?')
    expect(wrapper.get('.notes-count').text()).toContain('1 item')
  })

  it('aborts the list in flight when the filter changes again', async () => {
    const signals: AbortSignal[] = []
    const wrapper = await mountNotes(
      '/notas',
      notesWith({
        listNotes: (_query, signal) => {
          signals.push(signal)
          return new Promise<NotesList>(() => {})
        }
      })
    )

    await wrapper.get('#notes-filter').setValue('ide')
    await wrapper.get('#notes-filter').setValue('ideia')

    expect(signals).toHaveLength(3)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(true)
    expect(signals[2].aborted).toBe(false)
  })
})
