import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import router from '@/router'
import { store } from '@/mock/store'

import NotesView from './NotesView.vue'

async function mountNotes(path = '/notas') {
  await router.push(path)
  await router.isReady()
  return mount(NotesView, { global: { plugins: [router] } })
}

describe('NotesView', () => {
  beforeEach(async () => {
    await router.push('/notas')
  })

  it('renders the title, the segmented control, filter, and active notes list', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.get('h1').text()).toBe('Highlights')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.get('#notes-filter').attributes('placeholder')).toBe('Filtrar por texto ou fonte…')
    expect(wrapper.find('[aria-label="Lista de highlights"]').exists()).toBe(true)
  })

  it('opens the tab named in the query and keeps switching tabs in the query', async () => {
    const wrapper = await mountNotes('/notas?tab=perguntas')

    expect(wrapper.get('h1').text()).toBe('Perguntas')
    expect(wrapper.find('#new-question').exists()).toBe(true)

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.tab).toBe('anotacoes')
    expect(wrapper.get('h1').text()).toBe('Anotações')
  })

  it('filters the active list and validates then adds a question at the top', async () => {
    const wrapper = await mountNotes('/notas?tab=perguntas')
    const initialQuestionCount = store.questions.length

    await wrapper.get('#new-question').setValue('Uma pergunta sem final')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('A pergunta precisa terminar com “?”.')
    expect(store.questions).toHaveLength(initialQuestionCount)

    await wrapper.get('#new-question').setValue('Por que registrar exemplos ajuda?')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(store.questions).toHaveLength(initialQuestionCount + 1)
    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('Por que registrar exemplos ajuda?')

    await wrapper.get('#notes-filter').setValue('registrar exemplos')
    expect(wrapper.findAll('.notes-question')).toHaveLength(1)
  })

  it('uses material and decision routes for linked notes', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.get('.notes-highlight .notes-links a').attributes('href')).toBe('/material/post/post-compilation')
    expect(wrapper.get('.notes-highlight .notes-links a + a').attributes('href')).toBe('/decisoes/decision-parser-shape')
  })
})
