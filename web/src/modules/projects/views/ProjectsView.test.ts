import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { store } from '@/mock/store'
import { routes } from '@/router'
import ProjectsView from './ProjectsView.vue'

async function mountProjects(path = '/projetos') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  return { wrapper: mount(ProjectsView, { global: { plugins: [router] } }), router }
}

function routeName(router: Router, href: string | undefined): string | undefined {
  return href ? String(router.resolve(href).name) : undefined
}

describe('projects view', () => {
  it('renders the title, stat row and area groups from mock data', async () => {
    const { wrapper } = await mountProjects()

    expect(wrapper.find('h1').text()).toBe('Projetos')
    expect(wrapper.find('[aria-label="Resumo dos projetos"]').exists()).toBe(true)
    expect(wrapper.attributes('data-grouping')).toBeUndefined()
    expect(wrapper.find('[data-grouping="area"]').exists()).toBe(true)
    expect(wrapper.findAll('.project-row')).toHaveLength(store.projects.length)
    const statValues = wrapper.findAll('.nt-stat-value').map((stat) => stat.text())
    expect(statValues).toEqual([
      String(store.projects.filter((project) => project.status === 'active').length),
      String(store.tasks.filter((task) => !task.completed).length),
      String(store.decisions.filter((decision) => decision.status !== 'decided').length),
      String(store.projects.filter((project) => project.status === 'paused').length)
    ])
  })

  it('groups every project by status when requested', async () => {
    const { wrapper } = await mountProjects()

    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('Por estado'))!.trigger('click')

    expect(wrapper.find('[data-grouping="status"]').exists()).toBe(true)
    expect(wrapper.findAll('.project-row')).toHaveLength(store.projects.length)
    expect(wrapper.text()).toContain('Ativos')
    expect(wrapper.text()).toContain('Planejando')
  })

  it('resolves project rows and area headings to their routes', async () => {
    const { wrapper, router } = await mountProjects()

    const projectLinks = wrapper.findAll('.project-row')
    expect(projectLinks).not.toHaveLength(0)
    expect(routeName(router, projectLinks[0].attributes('href'))).toBe('projeto')
    const areaLink = wrapper.find('.project-group-title a')
    expect(routeName(router, areaLink.attributes('href'))).toBe('area')
  })

  it('creates a project beneath its selected area', async () => {
    const { wrapper } = await mountProjects()
    const projectTitle = 'Organizar materiais de oficina'
    const before = store.projects.length

    await wrapper.findAll('button').find((button) => button.text() === 'Novo projeto')!.trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    const create = dialog.findAll('button').find((button) => button.text() === 'Criar projeto')!
    expect(create.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="Curto, como um título"]').setValue(projectTitle)
    await dialog.find('textarea[placeholder="O que torna este projeto importante"]').setValue('Reunir o que já existe antes de comprar algo novo.')
    await dialog.find('input[placeholder="A primeira coisa concreta a fazer"]').setValue('Separar caixas vazias')
    await dialog.findAll('.projects-area-option').find((button) => button.text() === 'Casa')!.trigger('click')
    expect(create.attributes('disabled')).toBeUndefined()
    await dialog.trigger('submit')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.projects).toHaveLength(before + 1)
    const casa = wrapper.findAll('.project-group').find((group) => group.text().includes('Casa'))!
    expect(casa.text()).toContain(projectTitle)
  })
})
