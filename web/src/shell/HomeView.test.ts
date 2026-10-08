import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatShortDate, setClockTimeZone, shiftIsoDate, todayIsoDate } from '@/lib/clock'
import { createMockStore, type MockStore } from '@/mock/store'
import { fakeLibrarySource } from '@/modules/library/data/testing'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import router from '@/router'
import type { AppSources } from '@/sources'
import { appSourcesWithLibrary, flushReads, shellLibraryRecords, sourcesPlugin } from '@/sources/testing'

import HomeView from './HomeView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

async function mountWith(sources: Partial<AppSources>, path = '/'): Promise<VueWrapper> {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(HomeView, { global: { plugins: [router, sourcesPlugin(sources)] } })
  await flushReads()
  return wrapper
}

let library: ReturnType<typeof fakeLibrarySource>

function mountHome(path = '/'): Promise<VueWrapper> {
  return mountWith(appSourcesWithLibrary({ store, library }), path)
}

describe('HomeView', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
    setClockTimeZone('UTC')
    store = createMockStore()
    library = fakeLibrarySource(shellLibraryRecords())
    // The library reads the API, so its bands are on the home only while the
    // server says the module is there.
    setEnabledModules(['library'])
    await router.push('/')
  })

  afterEach(() => {
    resetModuleMounting()
    vi.useRealTimers()
  })

  it('renders its title and the main home regions', async () => {
    const wrapper = await mountHome()

    expect(wrapper.get('h1').text()).toBe('Sábado, 3 de outubro')
    expect(wrapper.get('#home-search').attributes('placeholder')).toBe('Buscar artigos, notas, cursos…')
    expect(wrapper.get('#continue-study').text()).toBe('Continuar estudando')
    expect(wrapper.get('#continue-reading').text()).toBe('Continuar lendo')
    expect(wrapper.get('#recent-saves').text()).toBe('Salvos recentemente')
    expect(wrapper.findAll('.home-study-row')).toHaveLength(2)
    expect(wrapper.findAll('.home-study-continue')).toHaveLength(2)
    expect(wrapper.findAll('.home-study-percent')).toHaveLength(2)
    expect(wrapper.findAll('.nt-carousel-item')).toHaveLength(6)
    expect(wrapper.findAll('.home-reading-progress')).toHaveLength(6)
    expect(wrapper.findAll('.home-reading-domain')).toHaveLength(6)
  })

  it('uses the promised routes for review, curricula, and reading items', async () => {
    const wrapper = await mountHome()

    expect(wrapper.get('.home-review').attributes('href')).toBe('/revisao')
    expect(wrapper.get('.home-study-row').attributes('href')).toBe('/curriculos/fundamentos-de-compiladores')
    // The reading list arrives in the order the server sorts it: most recently
    // opened first, which is what "continuar lendo" means.
    expect(wrapper.get('.home-reading-card').attributes('href')).toBe('/biblioteca/lib-post')
  })

  it('formats saved dates as today, yesterday, and a Portuguese calendar date', async () => {
    const wrapper = await mountHome()
    const dates = wrapper.findAll('.home-save-date').map((date) => date.text())

    expect(dates).toContain('hoje')
    expect(dates).toContain('ontem')
    // The oldest of the five recent saves sits four days back.
    expect(dates).toContain(formatShortDate(shiftIsoDate(todayIsoDate(), -4)))
  })

  it('opens the save dialog from the URL, rejects an empty URL, and posts the link', async () => {
    const wrapper = await mountHome('/?save=1')

    expect(wrapper.get('[role="dialog"]').text()).toContain('Salvar link')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Informe uma URL para salvar.')

    await wrapper.get('.nt-input').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    // The dialog sends the address and nothing else: the title, the kind and
    // the date are read from the page by the server.
    expect(library.calls.save).toEqual([{ url: 'https://example.org/reading-list' }])
    expect(library.records[0]).toMatchObject({ status: 'inbox', url: 'https://example.org/reading-list' })
    // The new item is on screen without a reload, in the inbox band.
    expect(wrapper.findAll('.home-save-title').map((node) => node.text())).toContain(
      'https://example.org/reading-list'
    )
  })

  it('opens the save dialog from its button', async () => {
    const wrapper = await mountHome()

    await wrapper.get('button.nt-btn-secondary').trigger('click')

    expect(wrapper.get('[role="dialog"]').text()).toContain('Salvar link')
  })

  it('titles the day from the clock, so the home follows the calendar', async () => {
    expect((await mountHome()).get('h1').text()).toBe('Sábado, 3 de outubro')

    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    expect((await mountHome()).get('h1').text()).toBe('Domingo, 4 de outubro')
  })
})

/**
 * The home has no read of its own: every band on it is a module's. So its
 * loading, empty and error states are the states of those bands, and they are
 * driven here by the sources the bands were given.
 */
describe('HomeView while its bands wait, find nothing, or fail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
    setClockTimeZone('UTC')
    setEnabledModules(['library'])
  })

  afterEach(() => {
    resetModuleMounting()
    vi.useRealTimers()
  })

  const emptyLibrary = { items: [], next_cursor: null }

  const emptyStudy = {
    items: [],
    next_cursor: null,
    counts: { curricula: 0, modules: 0, subjects: 0 },
    subjects: [],
    studyDays: [],
    focus: 'Sem foco desta semana.'
  }

  function homeSources(overrides: {
    library?: Partial<AppSources['library']>
    study?: Partial<AppSources['study']>
  }): Partial<AppSources> {
    return {
      library: { listItems: async () => emptyLibrary, ...overrides.library } as unknown as AppSources['library'],
      study: { studyHome: async () => emptyStudy, ...overrides.study } as unknown as AppSources['study'],
      review: { summary: async () => ({ cards: 0, due: 0, decks: 0 }) } as unknown as AppSources['review']
    }
  }

  it('says each band is loading before its own read answers', async () => {
    const wrapper = await mountWith(
      homeSources({
        library: { listItems: () => new Promise(() => {}) },
        study: { studyHome: () => new Promise(() => {}) }
      })
    )
    const waiting = wrapper.findAll('[role="status"]').map((node) => node.text())

    expect(waiting).toContain('Carregando as leituras…')
    expect(waiting).toContain('Carregando os salvos…')
    expect(waiting).toContain('Carregando os currículos…')
  })

  it('says each band is empty once its read answers with nothing', async () => {
    const wrapper = await mountWith(homeSources({}))

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('#continue-reading').text()).toBe('Continuar lendo')
    expect(wrapper.findAll('.home-reading-card')).toHaveLength(0)
    expect(wrapper.findAll('.home-study-row')).toHaveLength(0)
    expect(wrapper.findAll('.home-save-title')).toHaveLength(0)
  })

  it('says why each band could not be read', async () => {
    const wrapper = await mountWith(
      homeSources({
        library: {
          listItems: async () => {
            throw new Error('rede fora do ar')
          }
        },
        study: {
          studyHome: async () => {
            throw new Error('servidor sem resposta')
          }
        }
      })
    )
    const failures = wrapper.findAll('[role="alert"]').map((node) => node.text())

    expect(failures).toContain('Não foi possível carregar as leituras: rede fora do ar')
    expect(failures).toContain('Não foi possível carregar os salvos: rede fora do ar')
    expect(failures).toContain('Não foi possível carregar os currículos: servidor sem resposta')
  })
})
