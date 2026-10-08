import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { ProjectRow, ProjectsOverviewPage } from '../data/source'
import ProjectsView from './ProjectsView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

async function mountProjects(
  sources: Partial<AppSources>,
  path = '/projetos'
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ProjectsView, { global: { plugins: [router, sourcesPlugin(sources)] } })
  await flushReads()
  return { wrapper, router }
}

function routeName(router: Router, href: string | undefined): string | undefined {
  return href ? String(router.resolve(href).name) : undefined
}

/** An overview page holding exactly these rows, under one area. */
function overviewOf(items: ProjectRow[]): ProjectsOverviewPage {
  return {
    items,
    next_cursor: null,
    counts: {
      projects: items.length,
      active: items.filter((project) => project.status === 'active').length,
      paused: items.filter((project) => project.status === 'paused').length,
      openTasks: 0,
      pendingDecisions: 0
    },
    areas: [{ id: 'a-casa', title: 'Casa', intention: 'Manter o espaço funcional.', archived: false }]
  }
}

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-horta',
    areaId: 'a-casa',
    title: 'Horta da varanda',
    purpose: 'Ter temperos frescos à mão.',
    status: 'active',
    priority: 'P2',
    features: [],
    bugs: [],
    areaTitle: 'Casa',
    nextStep: 'Separar sementes',
    openTasks: 1,
    pendingDecisions: 0,
    ...overrides
  }
}

/** A projects source answering with that page, and whatever the test overrides. */
function projectsWith(page: ProjectsOverviewPage, overrides: Partial<AppSources['projects']> = {}): Partial<AppSources> {
  return {
    projects: {
      overview: async () => page,
      summary: async () => ({ counts: page.counts, areas: [], projects: [] }),
      addProject: async () => page.items[0],
      ...overrides
    } as unknown as AppSources['projects']
  }
}

/** Fills the new-project dialog with a complete, valid project under Casa. */
async function fillDialog(wrapper: VueWrapper, title: string): Promise<VueWrapper> {
  await wrapper.findAll('button').find((button) => button.text() === 'Novo projeto')!.trigger('click')
  const dialog = wrapper.find('[role="dialog"]')
  await dialog.find('input[placeholder="Curto, como um título"]').setValue(title)
  await dialog
    .find('textarea[placeholder="O que torna este projeto importante"]')
    .setValue('Reunir o que já existe antes de comprar algo novo.')
  await dialog.find('input[placeholder="A primeira coisa concreta a fazer"]').setValue('Separar caixas vazias')
  await dialog.findAll('.projects-area-option').find((button) => button.text() === 'Casa')!.trigger('click')
  return wrapper.find('[role="dialog"]') as unknown as VueWrapper
}

describe('projects view over the mock source', () => {
  it('renders the title, stat row and area groups once the overview answers', async () => {
    const { wrapper } = await mountProjects(createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Projetos')
    expect(wrapper.find('[aria-label="Resumo dos projetos"]').exists()).toBe(true)
    expect(wrapper.find('[data-grouping="area"]').exists()).toBe(true)
    expect(wrapper.findAll('.project-row')).toHaveLength(store.projects.length)
    expect(wrapper.findAll('.nt-stat-value').map((stat) => stat.text())).toEqual([
      String(store.projects.filter((project) => project.status === 'active').length),
      String(store.tasks.filter((task) => !task.completed).length),
      String(store.decisions.filter((decision) => decision.status !== 'decided').length),
      String(store.projects.filter((project) => project.status === 'paused').length)
    ])
  })

  it('groups every project by status when requested', async () => {
    const { wrapper } = await mountProjects(createMockSources(store))

    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('Por estado'))!.trigger('click')

    expect(wrapper.find('[data-grouping="status"]').exists()).toBe(true)
    expect(wrapper.findAll('.project-row')).toHaveLength(store.projects.length)
    expect(wrapper.text()).toContain('Ativos')
    expect(wrapper.text()).toContain('Planejando')
  })

  it('resolves project rows and area headings to their routes', async () => {
    const { wrapper, router } = await mountProjects(createMockSources(store))

    const projectLinks = wrapper.findAll('.project-row')
    expect(projectLinks).not.toHaveLength(0)
    expect(routeName(router, projectLinks[0].attributes('href'))).toBe('projeto')
    expect(routeName(router, wrapper.find('.project-group-title a').attributes('href'))).toBe('area')
  })

  it('creates a project beneath its selected area', async () => {
    const { wrapper } = await mountProjects(createMockSources(store))
    const projectTitle = 'Organizar materiais de oficina'
    const before = store.projects.length

    const dialog = await fillDialog(wrapper, projectTitle)
    expect(dialog.findAll('button').find((button) => button.text() === 'Criar projeto')!.attributes('disabled')).toBeUndefined()
    await dialog.trigger('submit')
    await flushReads()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.projects).toHaveLength(before + 1)
    const casa = wrapper.findAll('.project-group').find((group) => group.text().includes('Casa'))!
    expect(casa.text()).toContain(projectTitle)
  })
})

describe('projects view while it waits, finds nothing, or fails', () => {
  it('says it is loading before the overview answers', async () => {
    const { wrapper } = await mountProjects(projectsWith(overviewOf([]), { overview: () => new Promise(() => {}) }))

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando os projetos…')
    expect(wrapper.findAll('.project-row')).toHaveLength(0)
  })

  it('says there is no project yet once the overview answers with none', async () => {
    const { wrapper } = await mountProjects(projectsWith(overviewOf([])))

    expect(wrapper.find('.projects-state').text()).toContain('Nenhum projeto ainda')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('says why the overview could not be read, and reads again when asked', async () => {
    let attempts = 0
    const page = overviewOf([projectRow()])
    const { wrapper } = await mountProjects(
      projectsWith(page, {
        overview: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede fora do ar')
          return page
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar os projetos: rede fora do ar')

    await wrapper.findAll('button').find((button) => button.text() === 'Tentar de novo')!.trigger('click')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('.project-row')).toHaveLength(1)
  })
})

describe('projects view writing to its source', () => {
  it('keeps the list and the filled dialog when the create fails', async () => {
    const { wrapper } = await mountProjects(
      projectsWith(overviewOf([projectRow()]), {
        addProject: async () => {
          throw new Error('área removida')
        }
      })
    )

    const dialog = await fillDialog(wrapper, 'Organizar materiais de oficina')
    await dialog.trigger('submit')
    await flushReads()

    expect(wrapper.get('.projects-write-error').text()).toContain('Não foi possível salvar: área removida')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="Curto, como um título"]').attributes('value')).toBe(
      'Organizar materiais de oficina'
    )
    expect(wrapper.findAll('.project-row')).toHaveLength(1)
  })

  it('shows the row the source answered with, not the one it was sent', async () => {
    const answered = projectRow({ id: 'project-oficina', title: 'Oficina, como a fonte a nomeou', nextStep: 'Passo da fonte' })
    const { wrapper } = await mountProjects(
      projectsWith(overviewOf([projectRow()]), { addProject: async () => answered })
    )

    const dialog = await fillDialog(wrapper, 'O título que eu digitei')
    await dialog.trigger('submit')
    await flushReads()

    const rows = wrapper.findAll('.project-row-title').map((row) => row.text())
    expect(rows).toContain('Oficina, como a fonte a nomeou')
    expect(rows).not.toContain('O título que eu digitei')
  })
})
