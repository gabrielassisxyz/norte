import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { AreaDetail } from '../data/source'
import AreaView from './AreaView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

async function mountArea(id: string, sources: Partial<AppSources>): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/areas/${id}`)
  await router.isReady()
  const wrapper = mount(AreaView, { props: { id }, global: { plugins: [router, sourcesPlugin(sources)] } })
  await flushReads()
  return { wrapper, router }
}

function resolveTarget(router: Router, href: string | undefined): string {
  return href ? router.resolve(href).path : ''
}

function clickSegment(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('.nt-seg-btn').find((candidate) => candidate.text().includes(label))
  if (!button) throw new Error(`No segment labelled "${label}"`)
  return button.trigger('click')
}

/** The area detail the mock source would answer with, for one id. */
async function detailOf(id: string): Promise<AreaDetail> {
  const detail = await createMockSources(store).projects.getArea(id, new AbortController().signal)
  if (!detail) throw new Error(`The mock store holds no area ${id}`)
  return detail
}

/** A projects source answering with that detail, and whatever the test overrides. */
function projectsWith(detail: AreaDetail | null, overrides: Partial<AppSources['projects']> = {}): Partial<AppSources> {
  return {
    projects: {
      getArea: async () => detail,
      summary: async () => ({
        counts: { projects: 0, active: 0, paused: 0, openTasks: 0, pendingDecisions: 0 },
        areas: [],
        projects: []
      }),
      ...overrides
    } as unknown as AppSources['projects']
  }
}

describe('area view over the mock source', () => {
  it('renders the area title and every main region', async () => {
    const { wrapper } = await mountArea('a-casa', createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Home')
    for (const heading of ['Projects', 'Area tasks', 'Pending decisions', 'Recent sessions']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.text()).toContain('Keep the living space functional and welcoming.')
  })

  it('lists only the projects, tasks, decisions and sessions of its own area', async () => {
    const { wrapper } = await mountArea('a-casa', createMockSources(store))

    expect(wrapper.findAll('.row-title').map((row) => row.text())).toEqual([
      'Balcony garden',
      'Pantry inventory'
    ])
    // The completed task of the Pantry project stays out of the open list.
    expect(wrapper.findAll('.task-title').map((row) => row.text())).toEqual([
      'Sort leaf seeds',
      'Reuse spare pots'
    ])
    expect(wrapper.findAll('.decision-title').map((row) => row.text())).toEqual(['Decide the pot layout'])
    expect(wrapper.findAll('.session-row')).toHaveLength(1)
    expect(wrapper.find('.session-row').text()).toContain('Measured the available area.')
  })

  it('gives another area its own lists', async () => {
    const { wrapper } = await mountArea('a-aprendizagem', createMockSources(store))

    expect(wrapper.findAll('.row-title').map((row) => row.text())).toEqual([
      'Expression interpreter',
      'Study notebook'
    ])
  })

  it('narrows the project list to the active ones', async () => {
    const { wrapper } = await mountArea('a-casa', createMockSources(store))

    await clickSegment(wrapper, 'Active')
    expect(wrapper.findAll('.row-title').map((row) => row.text())).toEqual(['Balcony garden'])
    await clickSegment(wrapper, 'All')
    expect(wrapper.findAll('.row-title')).toHaveLength(2)
  })

  it('routes every project, task and decision row to its own screen', async () => {
    const { wrapper, router } = await mountArea('a-casa', createMockSources(store))

    expect(resolveTarget(router, wrapper.find('.row-proj').attributes('href'))).toBe('/projects/project-horta')
    expect(resolveTarget(router, wrapper.find('.task-row').attributes('href'))).toBe('/tasks/task-sementes')
    expect(resolveTarget(router, wrapper.find('.decision-row').attributes('href'))).toBe(
      '/decisions/decision-garden-layout'
    )
    expect(resolveTarget(router, wrapper.find('.session-project').attributes('href'))).toBe('/projects/project-horta')
  })

  it('links the rail to the new-area form and to each area', async () => {
    const { wrapper, router } = await mountArea('a-casa', createMockSources(store))

    expect(resolveTarget(router, wrapper.find('.rail-new').attributes('href'))).toBe('/areas/new')
    expect(resolveTarget(router, wrapper.find('.area-link.is-active').attributes('href'))).toBe('/areas/a-casa')
  })

  it('edits the name and the intent in place', async () => {
    const { wrapper } = await mountArea('a-tecnologia', createMockSources(store))

    await wrapper.find('button.ghost').trigger('click')
    expect(wrapper.find('.area-edit-title').text()).toBe('Edit area')
    await wrapper.find('.nt-field input').setValue('Tools')
    await wrapper.find('.nt-field textarea').setValue('Look after what I use every day.')
    await wrapper.findAll('.nt-btn').find((button) => button.text() === 'Save')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Tools')
    expect(wrapper.text()).toContain('Look after what I use every day.')
    expect(store.areas.find((area) => area.id === 'a-tecnologia')?.title).toBe('Tools')
  })

  it('archives an area and takes the archiving back', async () => {
    const { wrapper } = await mountArea('a-saude', createMockSources(store))

    await wrapper.find('button.ghost').trigger('click')
    await wrapper.findAll('button.ghost').find((button) => button.text() === 'Archive')!.trigger('click')
    await flushReads()
    expect(store.areas.find((area) => area.id === 'a-saude')?.archived).toBe(true)
    expect(wrapper.find('.area-archived').exists()).toBe(true)

    await wrapper.find('.area-archived button.ghost').trigger('click')
    await flushReads()
    expect(store.areas.find((area) => area.id === 'a-saude')?.archived).toBe(false)
    expect(wrapper.find('.area-archived').exists()).toBe(false)
  })

  it('opens an empty form on /areas/new and saves a new area', async () => {
    const { wrapper, router } = await mountArea('new', createMockSources(store))

    expect(wrapper.find('.area-edit-title').text()).toBe('New area')
    const save = () => wrapper.findAll('.nt-btn').find((button) => button.text() === 'Save')!
    expect(save().attributes('disabled')).toBeDefined()

    await wrapper.find('.nt-field input').setValue('Reading')
    await wrapper.find('.nt-field textarea').setValue('Keep what is worth rereading.')
    await save().trigger('click')
    await flushReads()
    await flushPromises()

    expect(store.areas.some((area) => area.id === 'a-reading' && !area.archived)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/areas/a-reading')
  })
})

describe('area view while it waits, is missing, or fails', () => {
  it('says it is loading before the area answers', async () => {
    const { wrapper } = await mountArea('a-casa', projectsWith(null, { getArea: () => new Promise(() => {}) }))

    expect(wrapper.get('[role="status"]').text()).toBe('Loading the area…')
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper, router } = await mountArea('a-that-does-not-exist', createMockSources(store))

    expect(wrapper.text()).toContain('Area not found')
    expect(resolveTarget(router, wrapper.find('.missing-link').attributes('href'))).toBe('/projects')
  })

  it('says why the area could not be read, and reads again when asked', async () => {
    const detail = await detailOf('a-casa')
    let attempts = 0
    const { wrapper } = await mountArea(
      'a-casa',
      projectsWith(detail, {
        getArea: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('network offline')
          return detail
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('The area could not be loaded: network offline')

    await wrapper.findAll('button').find((button) => button.text() === 'Try again')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Home')
  })
})

describe('area view writing to its source', () => {
  it('keeps the area as it was, and the form open, when the save fails', async () => {
    const detail = await detailOf('a-tecnologia')
    const { wrapper } = await mountArea(
      'a-tecnologia',
      projectsWith(detail, {
        updateArea: async () => {
          throw new Error('area archived by another client')
        }
      })
    )

    await wrapper.find('button.ghost').trigger('click')
    await wrapper.find('.nt-field input').setValue('Tools')
    await wrapper.find('.nt-field textarea').setValue('Look after what I use every day.')
    await wrapper.findAll('.nt-btn').find((button) => button.text() === 'Save')!.trigger('click')
    await flushReads()

    expect(wrapper.get('.area-write-error').text()).toContain(
      'Could not save: area archived by another client'
    )
    // The editor hides the page title, so the breadcrumb is where the area the
    // screen still holds is readable.
    expect(wrapper.find('.crumb-current').text()).toBe('Technology')
    expect(wrapper.find('.area-edit-title').exists()).toBe(true)
  })

  it('shows the area the source answered with, not the one it was sent', async () => {
    const detail = await detailOf('a-tecnologia')
    const { wrapper } = await mountArea(
      'a-tecnologia',
      projectsWith(detail, {
        updateArea: async () => ({ ...detail.area, title: 'Tools, renamed by the source' })
      })
    )

    await wrapper.find('button.ghost').trigger('click')
    await wrapper.find('.nt-field input').setValue('Tools')
    await wrapper.find('.nt-field textarea').setValue('Look after what I use every day.')
    await wrapper.findAll('.nt-btn').find((button) => button.text() === 'Save')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Tools, renamed by the source')
  })
})

describe('area view superseding a read it no longer needs', () => {
  it('aborts the read in flight when the route moves to another area', async () => {
    const detail = await detailOf('a-casa')
    const aborted: boolean[] = []
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/areas/a-casa')
    await router.isReady()

    const id = { value: 'a-casa' }
    const wrapper = mount(AreaView, {
      props: { id: id.value },
      global: {
        plugins: [
          router,
          sourcesPlugin(
            projectsWith(detail, {
              getArea: (_id: string, signal: AbortSignal) =>
                new Promise((resolve) => {
                  signal.addEventListener('abort', () => aborted.push(true))
                  setTimeout(() => resolve(detail), 0)
                })
            })
          )
        ]
      }
    })

    await wrapper.setProps({ id: 'a-aprendizagem' })
    await flushReads()

    expect(aborted).toEqual([true])
  })
})
