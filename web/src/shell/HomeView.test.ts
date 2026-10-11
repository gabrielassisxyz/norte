import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatShortDate, setClockTimeZone, shiftIsoDate, todayIsoDate } from '@/lib/clock'
import { createMockStore, type MockStore } from '@/mock/store'
import { fakeLibrarySource, libraryRecord } from '@/modules/library/data/testing'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import router from '@/router'
import type { AppSources } from '@/sources'
import { appSourcesWithLibrary, flushReads, shellLibraryRecords, sourcesPlugin } from '@/sources/testing'

import { fakeCoreSource, subjectRecord } from './data/testing'
import HomeView from './HomeView.vue'
import { clearPaletteRequest, paletteRequest } from './paletteRequest'

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
let core: ReturnType<typeof fakeCoreSource>

function mountHome(path = '/'): Promise<VueWrapper> {
  return mountWith(appSourcesWithLibrary({ store, library, core }), path)
}

describe('HomeView', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
    setClockTimeZone('UTC')
    store = createMockStore()
    library = fakeLibrarySource(shellLibraryRecords())
    // One subject in focus, which is what the save dialog's picker offers
    // before anything is typed into it.
    core = fakeCoreSource({ subjects: [subjectRecord({ id: 'subject-k8s', name: 'Kubernetes', focus: true })] })
    // The library reads the API, so its bands are on the home only while the
    // server says the module is there.
    setEnabledModules(['library'])
    await router.push('/')
  })

  afterEach(() => {
    resetModuleMounting()
    clearPaletteRequest()
    vi.useRealTimers()
  })

  it('reads both library bands from the API, each with the order its band promises', async () => {
    await mountHome()

    // "Recently saved" is the inbox newest-saved first; "continue
    // reading" is the whole shelf ordered by when it was last opened, which is
    // also the only order the server filters the never-opened out of.
    expect(library.calls.list).toEqual(
      expect.arrayContaining([
        { view: 'inbox', sort: 'saved_desc', limit: 5 },
        { view: 'all', sort: 'last_opened_desc', limit: 6 }
      ])
    )
  })

  it('lists the recent saves newest first and leaves the never-opened out of continue reading', async () => {
    // Its own fixtures, because the shared ones have all been opened and the
    // claim under test is about an item that has not.
    library = fakeLibrarySource([
      libraryRecord({
        id: 'lib-new',
        title: 'Saved just now',
        location: 'inbox',
        saved_at: `${TODAY}T11:00:00Z`
      }),
      libraryRecord({
        id: 'lib-old',
        title: 'Saved yesterday',
        location: 'inbox',
        saved_at: `${shiftIsoDate(TODAY, -1)}T11:00:00Z`,
        last_opened_at: `${TODAY}T09:00:00Z`
      }),
      libraryRecord({
        id: 'lib-archived',
        title: 'Read and archived',
        location: 'archive',
        saved_at: `${shiftIsoDate(TODAY, -4)}T11:00:00Z`,
        last_opened_at: `${TODAY}T10:00:00Z`
      })
    ])
    const wrapper = await mountHome()

    // Newest saved first, and the inbox only: an archived item is not a
    // recent save however recently it was read.
    expect(wrapper.findAll('.home-save-title').map((node) => node.text())).toEqual([
      'Saved just now',
      'Saved yesterday'
    ])
    // Last opened first, and never an item that was never opened -- which is
    // the one claim this band makes about itself.
    expect(wrapper.findAll('.home-reading-title').map((node) => node.text())).toEqual([
      'Read and archived',
      'Saved yesterday'
    ])
  })

  it('hands the first keystroke in its search box to the command palette', async () => {
    const wrapper = await mountHome()
    const search = wrapper.get('#home-search')

    await search.setValue('memória')

    expect(paletteRequest().value?.query).toBe('memória')
    // The box empties itself: the palette owns the query now, and a copy left
    // here would still be showing the last search the next time Início opens.
    expect((search.element as HTMLInputElement).value).toBe('')
  })

  it('asks again for the same text, because submitting it twice is two asks', async () => {
    const wrapper = await mountHome()
    const search = wrapper.get('#home-search')

    await search.setValue('memória')
    const first = paletteRequest().value?.count
    await search.setValue('memória')

    expect(paletteRequest().value?.count).not.toBe(first)
  })

  it('renders its title and the main home regions', async () => {
    const wrapper = await mountHome()

    expect(wrapper.get('h1').text()).toBe('Sábado, 3 de outubro')
    expect(wrapper.get('#home-search').attributes('placeholder')).toBe('Buscar artigos, notas, cursos…')
    expect(wrapper.get('#continue-study').text()).toBe('Continue studying')
    expect(wrapper.get('#continue-reading').text()).toBe('Continue reading')
    expect(wrapper.get('#recent-saves').text()).toBe('Recently saved')
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
    expect(wrapper.get('.home-study-row').attributes('href')).toBe('/curricula/compiler-fundamentals')
    // The reading list arrives in the order the server sorts it: most recently
    // opened first, which is what "continue reading" means.
    expect(wrapper.get('.home-reading-card').attributes('href')).toBe('/library/lib-post')
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

    expect(wrapper.get('[role="dialog"]').text()).toContain('Save a link')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Enter a URL to save.')

    await wrapper.get('.nt-input').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    // The dialog sends the address and nothing else: the title, the kind and
    // the date are read from the page by the server.
    expect(library.calls.save).toEqual([{ url: 'https://example.org/reading-list' }])
    expect(library.records[0]).toMatchObject({ location: 'inbox', url: 'https://example.org/reading-list' })
    // The new item is on screen without a reload, in the inbox band.
    expect(wrapper.findAll('.home-save-title').map((node) => node.text())).toContain(
      'https://example.org/reading-list'
    )
    expect(wrapper.get('.save-done').text()).toContain('Saved to the inbox')
    expect(wrapper.get('.save-done').text()).not.toContain('Already saved')
  })

  it('names the current shelf when the link was already saved', async () => {
    library = fakeLibrarySource([
      ...shellLibraryRecords(),
      libraryRecord({
        id: 'lib-archived',
        title: 'Kept in the archive',
        url: 'https://example.org/duplicate',
        canonical_url: 'https://example.org/duplicate',
        location: 'archive',
        unread: true
      })
    ])
    const wrapper = await mountHome('/?save=1')

    await wrapper.get('.nt-input').setValue('https://example.org/duplicate')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    const done = wrapper.get('.save-done').text()
    // The whole phrase, because what this asserts is that the dialog names
    // the location the existing item is in rather than claiming the inbox.
    expect(done).toContain('Already saved in the Archive')
    expect(done).toContain('Kept in the archive')
    // No second copy: the save folded into the archived item.
    expect(library.records.filter((record) => record.canonical_url === 'https://example.org/duplicate')).toHaveLength(1)
  })

  it('prints the site once on rows with no author', async () => {
    const wrapper = await mountHome()

    const saves = wrapper.findAll('.home-save')
    const paperSave = saves.find((node) => node.text().includes('Um paper guardado'))
    expect(paperSave).toBeDefined()
    const saveMeta = paperSave!.get('.home-save-meta').text()
    expect(saveMeta.match(/papers\.example/g) ?? []).toHaveLength(1)

    const cards = wrapper.findAll('.home-reading-card')
    const paperCard = cards.find((node) => node.text().includes('Um paper guardado'))
    expect(paperCard).toBeDefined()
    expect(paperCard!.text().match(/papers\.example/g) ?? []).toHaveLength(1)
  })

  it('shows what is left to read, and no duration when the length is unknown', async () => {
    const wrapper = await mountHome()

    const cards = wrapper.findAll('.home-reading-card')
    // 8 minutes at 42% read leaves ceil(8 × 0.58) = 5 minutes, not the whole 8.
    const started = cards.find((node) => node.text().includes('Um texto guardado'))
    expect(started).toBeDefined()
    expect(started!.get('.home-reading-meta').text()).toContain('5 min left')
    expect(started!.get('.home-reading-meta').text()).not.toContain('8 min left')

    // No minutes stored means no invented duration.
    const unknown = cards.find((node) => node.text().includes('Um vídeo guardado'))
    expect(unknown).toBeDefined()
    expect(unknown!.text()).not.toContain('min left')
  })

  it('saves a link about the subject chosen in the dialog, in one call', async () => {
    const wrapper = await mountHome('/?save=1')

    await wrapper.get('.nt-input').setValue('https://example.org/pods')
    // The picker offers the focus before anything is typed, which is the one
    // subject seeded here.
    await wrapper.get('[role="option"]').trigger('click')
    expect(wrapper.get('.save-chosen').text()).toContain('Kubernetes')

    await wrapper.get('form').trigger('submit')
    await flushReads()

    // The links travel with the save rather than as a second call, so the item
    // and its links land in one transaction.
    expect(library.calls.save).toEqual([
      { url: 'https://example.org/pods', link_to: ['subject-k8s'] }
    ])
  })

  it('drops a chosen subject again before the save', async () => {
    const wrapper = await mountHome('/?save=1')

    await wrapper.get('.nt-input').setValue('https://example.org/pods')
    await wrapper.get('[role="option"]').trigger('click')
    await wrapper.get('.save-chip').trigger('click')
    expect(wrapper.find('.save-chosen').exists()).toBe(false)

    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(library.calls.save).toEqual([{ url: 'https://example.org/pods' }])
  })

  it('opens the save dialog from its button', async () => {
    const wrapper = await mountHome()

    await wrapper.get('button.nt-btn-secondary').trigger('click')

    expect(wrapper.get('[role="dialog"]').text()).toContain('Save a link')
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

    expect(waiting).toContain('Loading the readings…')
    expect(waiting).toContain('Loading the saved items…')
    expect(waiting).toContain('Loading the curricula…')
  })

  it('says each band is empty once its read answers with nothing', async () => {
    const wrapper = await mountWith(homeSources({}))

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('#continue-reading').text()).toBe('Continue reading')
    expect(wrapper.findAll('.home-reading-card')).toHaveLength(0)
    expect(wrapper.findAll('.home-study-row')).toHaveLength(0)
    expect(wrapper.findAll('.home-save-title')).toHaveLength(0)
  })

  it('says why each band could not be read', async () => {
    const wrapper = await mountWith(
      homeSources({
        library: {
          listItems: async () => {
            throw new Error('network down')
          }
        },
        study: {
          studyHome: async () => {
            throw new Error('server gave no answer')
          }
        }
      })
    )
    const failures = wrapper.findAll('[role="alert"]').map((node) => node.text())

    expect(failures).toContain('The readings could not be loaded: network down')
    expect(failures).toContain('The saved items could not be loaded: network down')
    expect(failures).toContain('The curricula could not be loaded: server gave no answer')
  })
})
