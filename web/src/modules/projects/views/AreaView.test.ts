import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

import AppSidebar from '@/shell/AppSidebar.vue'
import { routes } from '@/router'
import { store } from '@/mock/store'
import AreaView from './AreaView.vue'

async function mountArea(id: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/areas/${id}`)
  await router.isReady()
  const wrapper = mount(AreaView, { props: { id }, global: { plugins: [router] } })
  return { wrapper, router }
}

function resolveTarget(router: Router, href: string | undefined): string {
  if (!href) return ''
  return router.resolve(href).path
}

function clickSegment(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll('.nt-seg-btn').find((candidate) => candidate.text().includes(label))
  if (!button) throw new Error(`No segment labelled "${label}"`)
  return button.trigger('click')
}

describe('area view', () => {
  it('renders the area title and every main region', async () => {
    const { wrapper } = await mountArea('a-casa')

    expect(wrapper.find('h1').text()).toBe('Casa')
    for (const heading of ['Projetos', 'Tarefas da área', 'Decisões pendentes', 'Últimas sessões']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.text()).toContain('Manter o espaço funcional e acolhedor.')
  })

  it('lists only the projects, tasks, decisions and sessions of its own area', async () => {
    const { wrapper } = await mountArea('a-casa')

    const projectTitles = wrapper.findAll('.row-title').map((row) => row.text())
    expect(projectTitles).toEqual(['Horta da varanda', 'Inventário da despensa'])
    // The completed task of the Despensa project stays out of the open list.
    expect(wrapper.findAll('.task-title').map((row) => row.text())).toEqual([
      'Separar sementes de folhas',
      'Reutilizar vasos disponíveis'
    ])
    expect(wrapper.findAll('.decision-title').map((row) => row.text())).toEqual([
      'Definir o arranjo dos vasos'
    ])
    expect(wrapper.findAll('.session-row')).toHaveLength(1)
    expect(wrapper.find('.session-row').text()).toContain('Medi a área disponível.')
  })

  it('gives another area its own lists', async () => {
    const { wrapper } = await mountArea('a-aprendizagem')

    expect(wrapper.findAll('.row-title').map((row) => row.text())).toEqual([
      'Interpretador de expressões',
      'Caderno de estudo'
    ])
  })

  it('narrows the project list to the active ones', async () => {
    const { wrapper } = await mountArea('a-casa')

    await clickSegment(wrapper, 'Ativos')
    expect(wrapper.findAll('.row-title').map((row) => row.text())).toEqual(['Horta da varanda'])
    await clickSegment(wrapper, 'Todos')
    expect(wrapper.findAll('.row-title')).toHaveLength(2)
  })

  it('routes every project, task and decision row to its own screen', async () => {
    const { wrapper, router } = await mountArea('a-casa')

    expect(resolveTarget(router, wrapper.find('.row-proj').attributes('href'))).toBe(
      '/projetos/project-horta'
    )
    expect(resolveTarget(router, wrapper.find('.task-row').attributes('href'))).toBe(
      '/tarefas/task-sementes'
    )
    expect(resolveTarget(router, wrapper.find('.decision-row').attributes('href'))).toBe(
      '/decisoes/decision-garden-layout'
    )
    expect(resolveTarget(router, wrapper.find('.session-project').attributes('href'))).toBe(
      '/projetos/project-horta'
    )
  })

  it('edits the name and the intent in place', async () => {
    const { wrapper } = await mountArea('a-tecnologia')

    await wrapper.find('button.ghost').trigger('click')
    expect(wrapper.find('.area-edit-title').text()).toBe('Editar área')
    await wrapper.find('.nt-field input').setValue('Ferramentas')
    await wrapper.find('.nt-field textarea').setValue('Cuidar do que uso todo dia.')
    await wrapper.findAll('.nt-btn').find((button) => button.text() === 'Salvar')!.trigger('click')

    expect(wrapper.find('h1').text()).toBe('Ferramentas')
    expect(wrapper.text()).toContain('Cuidar do que uso todo dia.')
    expect(store.areas.find((area) => area.id === 'a-tecnologia')?.title).toBe('Ferramentas')
  })

  it('archives an area and takes the archiving back', async () => {
    const { wrapper } = await mountArea('a-saude')

    await wrapper.find('button.ghost').trigger('click')
    await wrapper.findAll('button.ghost').find((button) => button.text() === 'Arquivar')!.trigger('click')
    expect(store.areas.find((area) => area.id === 'a-saude')?.archived).toBe(true)
    expect(wrapper.find('.area-archived').exists()).toBe(true)

    await wrapper.find('.area-archived button.ghost').trigger('click')
    expect(store.areas.find((area) => area.id === 'a-saude')?.archived).toBe(false)
    expect(wrapper.find('.area-archived').exists()).toBe(false)
  })

  it('opens an empty form on /areas/nova and saves a new area', async () => {
    const { wrapper, router } = await mountArea('nova')

    expect(wrapper.find('.area-edit-title').text()).toBe('Nova área')
    const save = () => wrapper.findAll('.nt-btn').find((button) => button.text() === 'Salvar')!
    expect(save().attributes('disabled')).toBeDefined()

    await wrapper.find('.nt-field input').setValue('Leituras')
    await wrapper.find('.nt-field textarea').setValue('Guardar o que vale reler.')
    await save().trigger('click')
    await flushPromises()

    expect(store.areas.some((area) => area.id === 'a-leituras' && !area.archived)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/areas/a-leituras')

    const sidebar = mount(AppSidebar, { global: { plugins: [router] } })
    await sidebar.find('button[aria-label="Expandir Projetos"]').trigger('click')
    expect(sidebar.findAll('.app-children .app-label').map((row) => row.text())).toContain(
      'Leituras'
    )
  })

  it('links the rail to the new-area form and to each area', async () => {
    const { wrapper, router } = await mountArea('a-casa')

    expect(resolveTarget(router, wrapper.find('.rail-new').attributes('href'))).toBe('/areas/nova')
    expect(resolveTarget(router, wrapper.find('.area-link.is-active').attributes('href'))).toBe(
      '/areas/a-casa'
    )
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper, router } = await mountArea('a-that-does-not-exist')

    expect(wrapper.text()).toContain('Área não encontrada')
    expect(resolveTarget(router, wrapper.find('.missing-link').attributes('href'))).toBe('/projetos')
  })
})
