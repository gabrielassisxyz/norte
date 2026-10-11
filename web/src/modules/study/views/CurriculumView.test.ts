import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { createMockStore, type MockStore } from '@/mock/store'
import { overrideModuleBacking, resetModuleMounting } from '@/modules/mounting'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { CurriculumDetail, StudySource } from '../data/source'

let store: MockStore

beforeEach(() => {
  store = createMockStore()
})

afterEach(() => {
  resetModuleMounting()
})

async function mountAt(path: string, sources?: Partial<AppSources>) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    global: { plugins: [router, sourcesPlugin(sources ?? createMockSources(store))] }
  })
  await flushReads()
  return { wrapper, router }
}

function moduleHeads(wrapper: VueWrapper) {
  return wrapper.findAll('.nt-mod-head')
}

function fieldByLabel(wrapper: VueWrapper, label: string) {
  const field = wrapper.findAll('.nt-field').find((candidate) => candidate.find('.nt-field-label').text() === label)
  expect(field, `no field labelled "${label}"`).toBeDefined()
  return field!.find('input, textarea')
}

describe('curriculum screen', () => {
  it('renders every mock curriculum with its own title and modules', async () => {
    for (const curriculum of store.curricula) {
      const { wrapper } = await mountAt(`/curricula/${curriculum.slug}`)

      expect(wrapper.find('.app-content h1').text()).toBe(curriculum.title)
      expect(wrapper.text()).toContain(curriculum.goal)
      expect(moduleHeads(wrapper)).toHaveLength(curriculum.modules.length)
      for (const module of curriculum.modules) {
        expect(wrapper.text()).toContain(module.title)
      }
    }
  })

  it('shows the objective, the ruler and every module region of the open module', async () => {
    const { wrapper } = await mountAt('/curricula/compiler-fundamentals')

    expect(wrapper.find('.nt-pagetitle-objective').text()).toBe('Build a small, readable interpreter.')
    expect(wrapper.findAll('.ruler-step')).toHaveLength(4)
    expect(wrapper.text()).toContain('Track')
    expect(wrapper.text()).toContain('Materials')
    expect(wrapper.text()).toContain('Instrument: token register')
    expect(wrapper.text()).toContain('Exercises')
    expect(wrapper.text()).toContain('Evaluation')
    expect(wrapper.find('.instrument-table').text()).toContain('Class')
  })

  it('marks each material status and the O/P of required and optional materials', async () => {
    const { wrapper } = await mountAt('/curricula/backyard-garden')

    const rows = wrapper.findAll('.nt-mat')
    expect(rows.length).toBeGreaterThan(2)
    // post-garden and paper-compost have both been read; book-garden is the
    // first required one still waiting.
    expect(rows[0].classes()).toContain('is-done')
    expect(rows[1].classes()).toContain('is-current')
    expect(rows[2].classes()).toContain('is-done')
    expect(rows[0].find('.nt-mat-type').text()).toBe('O · Post')
    expect(rows[2].find('.nt-mat-type').text()).toBe('P · Paper · optional')
  })

  it('collapses and expands a module', async () => {
    const { wrapper } = await mountAt('/curricula/compiler-fundamentals')
    const heads = moduleHeads(wrapper)

    expect(heads[0].attributes('aria-expanded')).toBe('true')
    await heads[0].trigger('click')
    expect(moduleHeads(wrapper)[0].attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.nt-mod-body').exists()).toBe(false)

    await moduleHeads(wrapper)[1].trigger('click')
    expect(moduleHeads(wrapper)[1].attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('A precedence table')
  })

  it('opens a module from the ruler', async () => {
    const { wrapper } = await mountAt('/curricula/compiler-fundamentals')

    await moduleHeads(wrapper)[0].trigger('click')
    await wrapper.findAll('.ruler-step')[2].trigger('click')

    expect(moduleHeads(wrapper)[2].attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('Instrument: symbol table')
  })

  it('routes every material row and the continue button to its source', async () => {
    // The library reads the server and this module reads the mock, so a row
    // leads to the material's own address rather than to a reader that would
    // look up a mock id against the API and find nothing.
    const { wrapper } = await mountAt('/curricula/compiler-fundamentals')

    const titles = wrapper.findAll('.nt-mat-title')
    expect(titles.length).toBeGreaterThan(0)
    for (const title of titles) {
      expect(title.attributes('href')).toMatch(/^https:\/\/example\.com\//)
    }

    const continueLink = wrapper.find('.curriculum-continue')
    expect(continueLink.attributes('href')).toBe('https://example.com/post-compilation')
  })

  it('routes a material row into the app once the library reads the same place', async () => {
    overrideModuleBacking('library', 'mock')
    const { wrapper, router } = await mountAt('/curricula/compiler-fundamentals')

    const href = wrapper.findAll('.nt-mat-title')[0].attributes('href')!
    expect(href).toMatch(/^\/material\/(article|book|paper)\//)
    expect(router.resolve(href).name).toBe('material')
  })

  it('links the breadcrumb to the study home and offers a new curriculum', async () => {
    const { wrapper, router } = await mountAt('/curricula/practical-typography')

    expect(router.resolve(wrapper.find('.curriculum-crumb').attributes('href')!).name).toBe('study')
    expect(wrapper.find('.curriculum-new').attributes('href')).toBe('/curricula/new')
  })

  it('edits the title, the objective and a module title, and saves them to the page', async () => {
    const { wrapper } = await mountAt('/curricula/connected-home')

    await wrapper.find('.curriculum-actions .nt-btn').trigger('click')
    expect(wrapper.find('.editor-heading').text()).toBe('Edit curriculum')

    await fieldByLabel(wrapper, 'Title').setValue('A house on the network')
    await fieldByLabel(wrapper, 'Objective').setValue('Keep simple services up without watching them.')
    await fieldByLabel(wrapper, 'Module 1').setValue('The house network')
    await wrapper.find('.editor-actions .nt-btn-primary').trigger('click')
    await flushReads()

    expect(wrapper.find('.editor').exists()).toBe(false)
    expect(wrapper.find('.app-content h1').text()).toBe('A house on the network')
    expect(wrapper.find('.nt-pagetitle-objective').text()).toBe('Keep simple services up without watching them.')
    expect(wrapper.findAll('.nt-mod-title')[0].text()).toBe('The house network')
  })

  it('opens an empty form on new and saves a new curriculum', async () => {
    const { wrapper, router } = await mountAt('/curricula/new')

    expect(wrapper.find('.editor-heading').text()).toBe('New curriculum')
    expect((fieldByLabel(wrapper, 'Title').element as HTMLInputElement).value).toBe('')
    const save = wrapper.find('.editor-actions .nt-btn-primary')
    expect(save.attributes('disabled')).toBeDefined()

    await fieldByLabel(wrapper, 'Title').setValue('Weekend carpentry')
    await fieldByLabel(wrapper, 'Objective').setValue('Build simple furniture with hand tools.')
    await wrapper.find('.editor-actions .nt-btn-primary').trigger('click')
    await flushPromises()
    await flushReads()

    expect(store.curricula[0]).toMatchObject({ slug: 'weekend-carpentry', title: 'Weekend carpentry' })
    expect(router.currentRoute.value.fullPath).toBe('/curricula/weekend-carpentry')
    expect(wrapper.find('.app-content h1').text()).toBe('Weekend carpentry')
  })

  it('shows a not-found state for an unknown slug', async () => {
    const { wrapper, router } = await mountAt('/curricula/does-not-exist')

    expect(wrapper.find('.app-content h1').text()).toBe('Curriculum not found')
    expect(wrapper.findAll('.nt-mod-head')).toHaveLength(0)
    expect(router.resolve(wrapper.find('.curriculum-back').attributes('href')!).name).toBe('study')
  })

  it('says it is loading before the curriculum answers', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/curricula/backyard-garden')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [
          router,
          sourcesPlugin({
            study: {
              getCurriculum: () => new Promise<CurriculumDetail | null>(() => {}),
              studyHome: () => new Promise(() => {}),
              materialContext: async () => null,
              summary: async () => ({ counts: { curricula: 0, modules: 0, subjects: 0 }, curricula: [] })
            } as unknown as AppSources['study']
          })
        ]
      }
    })
    await flushReads()

    expect(wrapper.get('.app-content [role="status"]').text()).toBe('Loading the curriculum…')
    expect(wrapper.findAll('.nt-mod-head')).toHaveLength(0)
  })

  it('says why the curriculum could not be read, and reads again when asked', async () => {
    let attempts = 0
    const sources = createMockSources(store)
    const { wrapper } = await mountAt('/curricula/backyard-garden', {
      ...sources,
      study: {
        ...sources.study,
        getCurriculum: ((slug: string, signal: AbortSignal) => {
          attempts += 1
          if (attempts === 1) return Promise.reject(new Error('network unavailable'))
          return sources.study.getCurriculum(slug, signal)
        }) as StudySource['getCurriculum']
      }
    })

    expect(wrapper.get('.app-content [role="alert"]').text()).toContain(
      'The curriculum could not be loaded: network unavailable'
    )

    await wrapper.get('.app-content [role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.get('.app-content h1').text()).toBe('Backyard garden')
  })

  it('keeps the editor open with the reason when saving fails', async () => {
    const sources = createMockSources(store)
    const { wrapper } = await mountAt('/curricula/connected-home', {
      ...sources,
      study: {
        ...sources.study,
        updateCurriculum: async () => {
          throw new Error('conflict on the server')
        }
      }
    })

    await wrapper.find('.curriculum-actions .nt-btn').trigger('click')
    await fieldByLabel(wrapper, 'Title').setValue('A house on the network')
    await wrapper.find('.editor-actions .nt-btn-primary').trigger('click')
    await flushReads()

    expect(wrapper.get('.curriculum-write-error').text()).toContain('Could not save: conflict on the server')
    expect(wrapper.find('.editor').exists()).toBe(true)
    expect(store.curricula.find((candidate) => candidate.slug === 'connected-home')?.title).not.toBe('A house on the network')
  })
})