import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { ProjectDetail } from '../data/source'
import ProjectView from './ProjectView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

async function mountProject(
  id: string,
  sources: Partial<AppSources>,
  props: Record<string, unknown> = {}
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/projects/${id}`)
  await router.isReady()
  const wrapper = mount(ProjectView, {
    props: { id, ...props },
    global: { plugins: [router, sourcesPlugin(sources)] }
  })
  await flushReads()
  return { wrapper, router }
}

function resolveName(router: Router, href: string | undefined): string | undefined {
  if (!href) return undefined
  const resolved = router.resolve(href)
  return typeof resolved.name === 'string' ? resolved.name : undefined
}

/** The project detail the mock source would answer with, for one id. */
async function detailOf(id: string): Promise<ProjectDetail> {
  const detail = await createMockSources(store).projects.getProject(id, new AbortController().signal)
  if (!detail) throw new Error(`The mock store holds no project ${id}`)
  return detail
}

function projectsWith(
  detail: ProjectDetail | null,
  overrides: Partial<AppSources['projects']> = {}
): Partial<AppSources> {
  return {
    projects: {
      getProject: async () => detail,
      ...overrides
    } as unknown as AppSources['projects']
  }
}

/** Fills the New task dialog with a complete task and submits it. */
async function createTask(wrapper: VueWrapper, title: string): Promise<void> {
  await wrapper.findAll('.project-actions button').find((button) => button.text() === 'New task')!.trigger('click')
  const dialog = wrapper.find('[role="dialog"]')
  await dialog.find('input[placeholder="Starts with a verb"]').setValue(title)
  await dialog
    .find('textarea[placeholder="What this task solves and why now"]')
    .setValue('The signal drops when it rains.')
  await dialog.find('input[placeholder="An observable test"]').setValue('The signal stays stable on a rainy afternoon.')
  await dialog.findAll('.dlg-pick-btn').find((button) => button.text() === 'P1')!.trigger('click')
  await dialog.findAll('.dlg-pick-btn').find((button) => button.text() === 'Today')!.trigger('click')
  await dialog.findAll('button').find((button) => button.text() === 'Create task')!.trigger('click')
  await flushReads()
}

describe('project view over the mock source', () => {
  it('renders the project title and every main region', async () => {
    const { wrapper } = await mountProject('project-horta', createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Balcony garden')
    for (const heading of ['Why', 'Current state', 'Open', 'Decisions', 'Priorities', 'Bugs', 'Tasks']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.find('nav.crumb').text()).toContain('Home')
    // This project's own feature renders with its own status label.
    expect(wrapper.find('.feature-row').text()).toContain('Partial')
  })

  it('filters tasks as labelled', async () => {
    const { wrapper } = await mountProject('project-horta', createMockSources(store))
    const visibleTitles = () => wrapper.findAll('.task-title').map((row) => row.text())

    // Balcony garden has one P2 and one P3 task, both open.
    expect(visibleTitles()).toHaveLength(2)
    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('P1'))!.trigger('click')
    expect(visibleTitles()).toHaveLength(0)
    expect(wrapper.text()).toContain('No tasks here.')
    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('All'))!.trigger('click')
    expect(visibleTitles()).toHaveLength(2)
  })

  it('reveals completed tasks only under All', async () => {
    const { wrapper } = await mountProject('project-despensa', createMockSources(store))

    expect(wrapper.findAll('.task-title')).toHaveLength(0)
    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('All'))!.trigger('click')
    const titles = wrapper.findAll('.task-title').map((row) => row.text())
    expect(titles).toHaveLength(1)
    expect(titles[0]).toContain('Review the restock list')
  })

  it('collapses and expands individual tasks', async () => {
    const { wrapper } = await mountProject('project-horta', createMockSources(store))
    const first = wrapper.findAll('.task')[0]

    expect(first.attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('.task-body')).toHaveLength(0)
    await first.trigger('click')
    expect(first.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.task-body')).toHaveLength(1)
    expect(wrapper.find('.task-body').text()).toContain('steps')
    await first.trigger('click')
    expect(wrapper.findAll('.task-body')).toHaveLength(0)
  })

  it('expands every task when tasksExpanded is set', async () => {
    const { wrapper } = await mountProject('project-horta', createMockSources(store), { tasksExpanded: true })

    expect(wrapper.findAll('.task-body')).toHaveLength(2)
  })

  it('routes task rows, decisions and the area to their screens', async () => {
    const { wrapper, router } = await mountProject('project-servidor-caseiro', createMockSources(store))

    for (const link of wrapper.findAll('.task-open')) {
      expect(resolveName(router, link.attributes('href'))).toBe('task')
    }
    expect(wrapper.findAll('.task-open')).not.toHaveLength(0)
    for (const link of wrapper.findAll('.decision-title')) {
      expect(resolveName(router, link.attributes('href'))).toBe('decision')
    }
    expect(wrapper.findAll('.decision-title')).not.toHaveLength(0)
    const area = wrapper.find('nav.crumb').findAll('a')[1]
    expect(area.text()).toBe('Technology')
    expect(router.resolve(area.attributes('href')!).params.id).toBe('a-tecnologia')
    expect(resolveName(router, area.attributes('href'))).toBe('area')
  })

  it('registers a session only after the required fields are filled', async () => {
    const { wrapper } = await mountProject('project-servidor-caseiro', createMockSources(store))
    const before = store.sessions.filter((session) => session.projectId === 'project-servidor-caseiro').length

    await wrapper
      .findAll('.project-actions button')
      .find((button) => button.text() === 'Log session')!
      .trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    const save = dialog.findAll('button').find((button) => button.text() === 'Log')!
    expect(save.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="One line"]').setValue('Checked the cabinet cables')
    expect(save.attributes('disabled')).toBeDefined()
    await dialog.find('input[placeholder="The first thing of the next session"]').setValue('Swap the spare cable')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    await flushReads()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.sessions.filter((session) => session.projectId === 'project-servidor-caseiro')).toHaveLength(
      before + 1
    )
    expect(store.sessions[0].summary).toContain('Swap the spare cable')
    expect(wrapper.find('.project-now').text()).toContain('Checked the cabinet cables')
    expect(wrapper.find('.project-next').text()).toContain('Swap the spare cable')
  })

  it('creates a task only after the required fields are filled', async () => {
    const { wrapper } = await mountProject('project-servidor-caseiro', createMockSources(store))
    const title = 'Calibrate the attic antenna'
    const before = store.tasks.filter((task) => task.projectId === 'project-servidor-caseiro').length

    await wrapper.findAll('.project-actions button').find((button) => button.text() === 'New task')!.trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    const save = dialog.findAll('button').find((button) => button.text() === 'Create task')!
    expect(save.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="Starts with a verb"]').setValue(title)
    await dialog
      .find('textarea[placeholder="What this task solves and why now"]')
      .setValue('The signal drops when it rains.')
    await dialog.find('input[placeholder="An observable test"]').setValue('The signal stays stable on a rainy afternoon.')
    expect(save.attributes('disabled')).toBeUndefined()
    await dialog.findAll('.dlg-pick-btn').find((button) => button.text() === 'P1')!.trigger('click')
    await dialog.findAll('.dlg-pick-btn').find((button) => button.text() === 'Today')!.trigger('click')
    await save.trigger('click')
    await flushReads()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    const created = store.tasks.find((task) => task.title === title)
    expect(created).toMatchObject({ projectId: 'project-servidor-caseiro', priority: 'P1', bucket: 'today' })
    expect(store.tasks.filter((task) => task.projectId === 'project-servidor-caseiro')).toHaveLength(before + 1)
    expect(wrapper.findAll('.task-title').map((row) => row.text()).some((row) => row.includes(title))).toBe(true)
  })
})

describe('project view while it waits, is missing, or fails', () => {
  it('says it is loading before the project answers', async () => {
    const { wrapper } = await mountProject(
      'project-horta',
      projectsWith(null, { getProject: () => new Promise(() => {}) })
    )

    expect(wrapper.get('[role="status"]').text()).toBe('Loading the project…')
    expect(wrapper.find('.task').exists()).toBe(false)
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper, router } = await mountProject('project-that-does-not-exist', createMockSources(store))

    expect(wrapper.text()).toContain('Project not found')
    expect(resolveName(router, wrapper.find('.missing-link').attributes('href'))).toBe('projects')
  })

  it('says why the project could not be read, and reads again when asked', async () => {
    const detail = await detailOf('project-horta')
    let attempts = 0
    const { wrapper } = await mountProject(
      'project-horta',
      projectsWith(detail, {
        getProject: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('network offline')
          return detail
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('The project could not be loaded: network offline')

    await wrapper.findAll('button').find((button) => button.text() === 'Try again')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Balcony garden')
  })
})

describe('project view writing to its source', () => {
  it('keeps the task list and the filled dialog when the create fails', async () => {
    const detail = await detailOf('project-servidor-caseiro')
    const { wrapper } = await mountProject(
      'project-servidor-caseiro',
      projectsWith(detail, {
        addTask: async () => {
          throw new Error('project completed')
        }
      })
    )
    const before = wrapper.findAll('.task').length

    await createTask(wrapper, 'Calibrate the attic antenna')

    expect(wrapper.get('.project-write-error').text()).toContain('Could not save: project completed')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.findAll('.task')).toHaveLength(before)
  })

  it('shows the task the source answered with, not the one it was sent', async () => {
    const detail = await detailOf('project-servidor-caseiro')
    const answered = { ...detail.tasks[0], id: 'task-antena', title: 'Antenna, as the source named it' }
    const { wrapper } = await mountProject(
      'project-servidor-caseiro',
      projectsWith(detail, { addTask: async () => answered })
    )

    await createTask(wrapper, 'The title I typed')

    const titles = wrapper.findAll('.task-title').map((row) => row.text())
    expect(titles.some((title) => title.includes('Antenna, as the source named it'))).toBe(true)
    expect(titles.some((title) => title.includes('The title I typed'))).toBe(false)
  })
})
