import { mount, type VueWrapper } from '@vue/test-utils'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable, routes } from '@/router'
import type { AppSources } from '@/sources'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { coreLink, fakeCoreSource, registryItem } from '@/shell/data/testing'

import { libraryGainedItem } from '../data/revision'
import type { LibraryItemList, LibraryItemRecord, LibrarySource } from '../data/source'
import { fakeLibrarySource, libraryRecord, type FakeLibrarySource } from '../data/testing'
import LibraryView from './LibraryView.vue'

/** The day the records are dated against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  setEnabledModules(['library'])
})

afterEach(() => {
  vi.useRealTimers()
  resetModuleMounting()
})

/** The cross-module menu reads this; a case that is not about it can ignore it. */
function companionSources(): Partial<AppSources> {
  return {
    projects: {
      summary: async () => ({
        counts: { projects: 1, active: 1, paused: 0, openTasks: 0, pendingDecisions: 0 },
        areas: [],
        projects: [{ id: 'project-horta', title: 'Balcony garden' }]
      })
    } as unknown as AppSources['projects']
  }
}

async function mountAt(
  path: string,
  library: Partial<AppSources['library']>,
  core?: AppSources['core'],
  attachTo?: HTMLElement
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LibraryView, {
    attachTo,
    global: {
      plugins: [
        router,
        sourcesPlugin({
          ...companionSources(),
          library: library as AppSources['library'],
          ...(core ? { core } : {})
        })
      ]
    }
  })
  await flushReads()
  return { wrapper, router }
}

function titles(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.item-title').map((node) => node.text())
}

/**
 * The counted tabs and their counts. A tab with no count is left out rather
 * than reported as zero: the review queue is one, and "0 suggestions" is a
 * different claim from "nobody counts the suggestions".
 */
function segCounts(wrapper: VueWrapper): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const button of wrapper.findAll('.nt-seg-btn')) {
    const count = button.find('.nt-seg-count')
    if (!count.exists()) continue
    counts[button.find('span').text()] = Number(count.text())
  }
  return counts
}

/** The tabs as they read, in the order they are on screen. */
function tabLabels(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.library-tabs .nt-seg-btn').map((button) => button.find('span').text())
}

/** The trigger of one of the header's two menus. */
function menuTrigger(wrapper: VueWrapper, menu: 'sort' | 'filter') {
  return wrapper.get(`.library-${menu} button.nt-menu-trigger`)
}

function addMenuTrigger(wrapper: VueWrapper) {
  return wrapper.get('.library-add button.nt-menu-trigger')
}

/**
 * Open a menu if it is closed and pick the row carrying `selector`.
 *
 * The extra flush is the route: a choice that writes `kind` navigates, and the
 * screen's own route is behind a dynamic import, so the navigation settles
 * several microtasks after the click.
 */
async function pick(wrapper: VueWrapper, menu: 'sort' | 'filter', selector: string): Promise<void> {
  if (menuTrigger(wrapper, menu).attributes('aria-expanded') !== 'true') {
    await menuTrigger(wrapper, menu).trigger('click')
  }
  await wrapper.get(`.library-${menu} ${selector}`).trigger('click')
  await flushReads(20)
}

/** Click one tab by its label, and let the navigation it starts settle. */
async function clickTab(wrapper: VueWrapper, label: string): Promise<void> {
  const found = wrapper
    .findAll('.library-tabs .nt-seg-btn')
    .find((button) => button.find('span').text() === label)
  if (!found) throw new Error(`no tab labelled ${label}`)
  await found.trigger('click')
  await flushReads(20)
}

/** Choose one order from the sort menu. */
function chooseSort(wrapper: VueWrapper, value: string): Promise<void> {
  return pick(wrapper, 'sort', `[data-sort="${value}"]`)
}

/** The rows of a menu, by the text they read, with the open menu left open. */
async function menuRows(wrapper: VueWrapper, menu: 'sort' | 'filter'): Promise<string[]> {
  await menuTrigger(wrapper, menu).trigger('click')
  return wrapper.findAll(`.library-${menu} .library-menu-row`).map((row) => row.text())
}

function lastQuery(library: FakeLibrarySource) {
  return library.calls.list.at(-1)
}

function shelf(): LibraryItemRecord[] {
  return [
    libraryRecord({
      id: 'post-um',
      kind: 'article',
      title: 'A saved text',
      author: 'Norte team',
      location: 'inbox',
      unread: true,
      saved_at: `${TODAY}T10:00:00Z`
    }),
    libraryRecord({
      id: 'book-one',
      kind: 'book',
      title: 'A saved book',
      author: 'Marina Costa',
      location: 'later',
      unread: true,
      saved_at: '2026-10-01T10:00:00Z'
    }),
    libraryRecord({
      id: 'paper-um',
      kind: 'paper',
      title: 'A saved paper',
      site: 'papers.example',
      location: 'archive',
      unread: false,
      read_at: '2026-10-02T10:00:00Z',
      saved_at: '2026-09-28T10:00:00Z'
    })
  ]
}

function manyRecords(count: number): LibraryItemRecord[] {
  return Array.from({ length: count }, (_, position) =>
    libraryRecord({
      id: `item-${String(position).padStart(3, '0')}`,
      title: `Reading ${position}`,
      saved_at: `2026-10-03T${String(23 - Math.floor(position / 60)).padStart(2, '0')}:${String(
        59 - (position % 60)
      ).padStart(2, '0')}:00Z`
    })
  )
}

describe('LibraryView over the API', () => {
  it('renders its title, the endpoint counts and the rows the server sent', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library', library)

    expect(wrapper.find('h1').text()).toBe('Library')
    // The counts are the whole library's, not the page's: one row is on screen.
    expect(segCounts(wrapper)).toEqual({
      Inbox: 1,
      'Up Next': 0,
      Later: 1,
      Archive: 1,
      Stash: 0,
      All: 3
    })
    expect(tabLabels(wrapper)).toEqual([
      'Inbox',
      'Up Next',
      'Later',
      'Archive',
      'Stash',
      'All',
      'Pending connections'
    ])
    // One segmented control on the screen: the order used to be a second one,
    // and it is a sort option now, which is what makes the header one row.
    expect(wrapper.findAll('.nt-seg')).toHaveLength(1)
    // Nothing in the address names a shelf, so the inbox is the one that opens.
    expect(wrapper.get('.library-tabs [aria-selected="true"]').text()).toContain('Inbox')
    expect(titles(wrapper)).toEqual(['A saved text'])
    expect(wrapper.find('.library-count').text()).toBe('1 item')
    expect(library.calls.counts).toBe(1)
  })

  it('asks the server for the shelf rather than filtering the page it has', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=archive', library)

    expect(lastQuery(library)).toMatchObject({ view: 'archive' })
    expect(titles(wrapper)).toEqual(['A saved paper'])
  })

  it('asks the server for unread only, and says so on the page', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    expect(lastQuery(library)?.unread).toBeNull()

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'all', unread: true })
    expect(titles(wrapper)).toEqual(['A saved text', 'A saved book'])
    expect(wrapper.get('.library-unread').text()).toContain('Showing unread only')
  })

  it('narrows to a kind from ?kind, in the spelling the contract uses', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all&kind=books', library)

    expect(wrapper.find('h1').text()).toBe('Books')
    expect(lastQuery(library)).toMatchObject({ kind: 'book' })
    expect(titles(wrapper)).toEqual(['A saved book'])
    expect(wrapper.findAll('.item-date')[0].text()).toBe('1 out')
  })

  it('sends the search term as q and the order as the contract spells it', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    await wrapper.get('#library-search').setValue('paper')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ q: 'paper' })
    expect(titles(wrapper)).toEqual(['A saved paper'])

    await wrapper.get('#library-search').setValue('')
    await chooseSort(wrapper, 'title')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ sort: 'title' })
  })

  it('sends q without sort while a search text is active, and disables the sort menu', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    // Blank text sends the default sort, the way it always did.
    expect(lastQuery(library)).toMatchObject({ sort: 'saved_desc' })
    expect(lastQuery(library)?.q).toBeUndefined()

    await wrapper.get('#library-search').setValue('paper')
    await flushReads()

    // The server refuses sort alongside q, so the screen sends q alone.
    expect(lastQuery(library)).toMatchObject({ q: 'paper' })
    expect(lastQuery(library)?.sort).toBeUndefined()
    expect('sort' in (lastQuery(library) ?? {})).toBe(false)
    // The server refuses the pair, so the control that would produce it cannot
    // be reached while the text is there -- and it stays on screen, because a
    // control that disappears leaves nothing to explain why.
    expect(menuTrigger(wrapper, 'sort').attributes('disabled')).toBeDefined()
    await menuTrigger(wrapper, 'sort').trigger('click')
    expect(wrapper.find('.library-sort [role="menu"]').exists()).toBe(false)
  })

  it('sends the chosen sort again once the search text is cleared', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    await chooseSort(wrapper, 'title')
    await flushReads()
    expect(lastQuery(library)).toMatchObject({ sort: 'title' })

    await wrapper.get('#library-search').setValue('paper')
    await flushReads()
    expect(lastQuery(library)?.sort).toBeUndefined()

    // Whitespace-only counts as blank: the chosen sort is back, and so is the toggle.
    await wrapper.get('#library-search').setValue('   ')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ sort: 'title' })
    expect(lastQuery(library)?.q).toBeUndefined()
    expect(menuTrigger(wrapper, 'sort').attributes('disabled')).toBeUndefined()
  })

  it('points every row at the reader', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/library', library)
    const href = wrapper.get('.item-title').attributes('href')!

    expect(href).toBe('/library/post-um')
    expect(router.resolve(href).name).toBe('reader')
  })

  it('renders a saved lead image with the thumbnail attributes', async () => {
    const leadImage = 'https://images.example/cover.jpg'
    const library = fakeLibrarySource([
      libraryRecord({ id: 'with-image', lead_image: leadImage, saved_at: `${TODAY}T10:00:00Z` })
    ])
    const { wrapper } = await mountAt('/library?v=all', library)

    const thumbnail = wrapper.get('.item-thumb')
    const image = thumbnail.get('img')
    expect(image.attributes()).toMatchObject({
      src: leadImage,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer'
    })
    expect(image.classes()).toContain('item-thumb-image')
    expect(thumbnail.find('.nt-icon').exists()).toBe(false)
  })

  it('uses the document icon when a thumbnail is absent or fails to load', async () => {
    const library = fakeLibrarySource([
      libraryRecord({ id: 'with-image', title: 'With image', lead_image: 'https://images.example/cover.jpg' }),
      libraryRecord({ id: 'without-image', title: 'Without image', saved_at: '2026-10-02T10:00:00Z' })
    ])
    const { wrapper } = await mountAt('/library?v=all', library)
    const rows = wrapper.findAll('article.item')
    const withImage = rows.find((row) => row.find('.item-title').text() === 'With image')
    const withoutImage = rows.find((row) => row.find('.item-title').text() === 'Without image')
    if (!withImage || !withoutImage) throw new Error('thumbnail test rows were not rendered')

    expect(withoutImage.find('img').exists()).toBe(false)
    expect(withoutImage.find('.nt-icon').exists()).toBe(true)

    await withImage.get('img').trigger('error')
    expect(withImage.find('img').exists()).toBe(false)
    expect(withImage.find('.nt-icon').exists()).toBe(true)
  })
})

describe('LibraryView growing its list', () => {
  it('shows 50, then 100, then 120, with no row twice and no button left', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const { wrapper } = await mountAt('/library?v=all', library)

    expect(wrapper.findAll('article.item')).toHaveLength(50)
    expect(wrapper.get('.library-more').text()).toBe('Load more')

    await wrapper.get('.library-more').trigger('click')
    await flushReads()
    expect(wrapper.findAll('article.item')).toHaveLength(100)

    await wrapper.get('.library-more').trigger('click')
    await flushReads()
    expect(wrapper.findAll('article.item')).toHaveLength(120)
    expect(new Set(titles(wrapper)).size).toBe(120)
    expect(wrapper.find('.library-more').exists()).toBe(false)
    expect(wrapper.find('.library-count').text()).toBe('120 items')
  })

  it('keeps the rows and says why next to the button when a further page fails', async () => {
    const records = manyRecords(120)
    const base = fakeLibrarySource(records)
    const library = fakeLibrarySource(records, {
      listItems: async (query, signal) => {
        if (query.cursor) throw new Error('network dropped')
        return base.listItems(query, signal)
      }
    })
    const { wrapper } = await mountAt('/library?v=all', library)

    await wrapper.get('.library-more').trigger('click')
    await flushReads()

    expect(wrapper.findAll('article.item')).toHaveLength(50)
    expect(wrapper.find('.library-error').exists()).toBe(false)
    expect(wrapper.get('.library-more-error').text()).toContain('network dropped')
    expect(wrapper.find('.library-more').exists()).toBe(true)
  })

  it('keeps the whole-library counts while the page grows', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const { wrapper } = await mountAt('/library?v=all', library)

    expect(segCounts(wrapper)).toMatchObject({ All: 120, Inbox: 120 })
    await wrapper.get('.library-more').trigger('click')
    await flushReads()

    // 100 rows are on screen and the shelf still holds 120.
    expect(wrapper.findAll('article.item')).toHaveLength(100)
    expect(segCounts(wrapper)).toMatchObject({ All: 120 })
  })

  it('starts over from the first page when a filter changes', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const { wrapper } = await mountAt('/library?v=all', library)
    await wrapper.get('.library-more').trigger('click')
    await flushReads()

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()

    expect(wrapper.findAll('article.item')).toHaveLength(50)
    expect(lastQuery(library)?.cursor).toBeUndefined()
  })
})

describe('LibraryView while it waits, finds nothing, or fails', () => {
  it('says it is loading before the first answer arrives', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/library')
    const library = fakeLibrarySource([], { listItems: () => new Promise<LibraryItemList>(() => {}) })
    const wrapper = mount(LibraryView, {
      global: { plugins: [router, sourcesPlugin({ ...companionSources(), library })] }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Loading the library…')
    expect(wrapper.findAll('article.item')).toHaveLength(0)
    expect(wrapper.find('.library-count').exists()).toBe(false)
  })

  it('says the list is empty once it has answered with nothing', async () => {
    const { wrapper } = await mountAt('/library', fakeLibrarySource([]))

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.library-empty').text()).toContain('The inbox is empty')
    expect(segCounts(wrapper)).toEqual({
      Inbox: 0,
      'Up Next': 0,
      Later: 0,
      Archive: 0,
      Stash: 0,
      All: 0
    })
  })

  it.each([
    ['up_next', 'Nothing chosen to read next.'],
    ['stash', 'Nothing stashed yet.']
  ])('names the %s empty state in its own words rather than falling back', async (view, text) => {
    const { wrapper } = await mountAt(`/library?v=${view}`, fakeLibrarySource([]))

    expect(wrapper.get('.library-empty').text()).toBe(text)
  })

  it('says why it could not load, and reads again when asked', async () => {
    let attempts = 0
    const library = fakeLibrarySource([], {
      listItems: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network unavailable')
        return { items: [], next_cursor: null }
      }
    })
    const { wrapper } = await mountAt('/library', library)

    expect(wrapper.get('.library-error').text()).toContain('The library could not be loaded: network unavailable')
    expect(wrapper.findAll('article.item')).toHaveLength(0)

    await wrapper.get('.library-error button').trigger('click')
    await flushReads()

    expect(wrapper.find('.library-error').exists()).toBe(false)
    expect(wrapper.find('.library-empty').exists()).toBe(true)
  })

  it('reports nothing found for a search that matches no row', async () => {
    const { wrapper } = await mountAt('/library?v=all', fakeLibrarySource(shelf()))

    await wrapper.get('#library-search').setValue('xylophone')
    await flushReads()

    expect(wrapper.get('.library-empty').text()).toBe('Nothing found for “xylophone”.')
  })
})

describe('LibraryView writing to the API', () => {
  it('shows the row the server answered with, not the one it asked for', async () => {
    const stored = libraryRecord({ id: 'post-um', title: 'The title that was there', location: 'inbox' })
    // The server archives it *and* renames it: only a page that renders the
    // response can show the new title.
    const library = fakeLibrarySource([stored], {
      patchItem: async () => ({ ...stored, location: 'archive', title: 'The title the server sent back' })
    })
    const { wrapper } = await mountAt('/library?v=all', library)

    await wrapper.get('button[aria-label="Archive"]').trigger('click')
    await flushReads()

    expect(titles(wrapper)).toEqual(['The title the server sent back'])
    expect(wrapper.find('button[aria-label="Unarchive"]').exists()).toBe(true)
  })

  it('asks the counts endpoint again after a write instead of recounting the page', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    expect(library.calls.counts).toBe(1)
    await wrapper.get('button[aria-label="Archive"]').trigger('click')
    await flushReads()

    expect(library.calls.counts).toBe(2)
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 0, Archive: 2 })
  })

  it('leaves the row untouched and says so when the write fails', async () => {
    const stored = libraryRecord({ id: 'post-um', title: 'The title that was there', location: 'inbox' })
    const library = fakeLibrarySource([stored], {
      patchItem: async () => {
        throw new Error('server conflict')
      }
    })
    const { wrapper } = await mountAt('/library?v=all', library)

    await wrapper.get('button[aria-label="Archive"]').trigger('click')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save: server conflict')
    expect(titles(wrapper)).toEqual([stored.title])
    // The row still offers to archive, because nothing was archived.
    expect(wrapper.find('button[aria-label="Archive"]').exists()).toBe(true)
  })

  it('marks an item read without moving it out of the shelf it is on', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library', library)

    await wrapper.get('button[aria-label="Mark as read"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'post-um', patch: { unread: false } }])
    expect(titles(wrapper)).toEqual(['A saved text'])
    expect(wrapper.findAll('article.item')[0].find('.item-dot').exists()).toBe(false)
    expect(wrapper.findAll('article.item')[0].find('button[aria-label="Mark as unread"]').exists()).toBe(true)
  })

  it('shows an item saved elsewhere without a reload', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library', library)

    expect(titles(wrapper)).toEqual(['A saved text'])

    // What the save dialog does: post the link, then say the library gained one.
    await library.saveLink({ url: 'https://example.org/reading-list' })
    libraryGainedItem()
    await flushReads()

    expect(titles(wrapper)).toContain('https://example.org/reading-list')
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 2, All: 4 })
  })
})

describe('LibraryView adding links', () => {
  it('puts the URL action immediately before the title', async () => {
    const { wrapper } = await mountAt('/library', fakeLibrarySource(shelf()))

    expect(wrapper.find('.library-title-row > .library-add + h1').exists()).toBe(true)
    expect(addMenuTrigger(wrapper).attributes('aria-label')).toBe('Add')

    await addMenuTrigger(wrapper).trigger('click')

    const entries = wrapper.findAll('.library-add [role="menuitem"]')
    expect(entries).toHaveLength(1)
    expect(entries[0].text()).toContain('URL')
    expect(entries[0].get('kbd').text()).toBe('A')
  })

  it('opens the save dialog with the URL field focused from the menu', async () => {
    // Attached, because focus only moves inside a document.
    const host = document.body.appendChild(document.createElement('div'))
    const { wrapper } = await mountAt('/library', fakeLibrarySource(shelf()), undefined, host)

    await addMenuTrigger(wrapper).trigger('click')
    await wrapper.get('.library-add [role="menuitem"]').trigger('click')
    await flushReads()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('#save-url').element)
    wrapper.unmount()
    host.remove()
  })

  it('opens from A or a, but not from an input or a modifier', async () => {
    const { wrapper } = await mountAt('/library', fakeLibrarySource(shelf()))
    const search = wrapper.get('#library-search')

    await search.trigger('keydown', { key: 'a' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await search.trigger('keydown', { key: 'A' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', altKey: true }))
    await flushReads()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    for (const key of ['a', 'A']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key }))
      await flushReads()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
      await wrapper.get('.save-dialog button').trigger('click')
      await flushReads()
    }
  })

  it('reloads the list and counts after saving from the library', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library', library)

    await addMenuTrigger(wrapper).trigger('click')
    await wrapper.get('.library-add [role="menuitem"]').trigger('click')
    await wrapper.get('#save-url').setValue('https://example.org/from-library')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(library.calls.save).toEqual([{ url: 'https://example.org/from-library' }])
    expect(titles(wrapper)[0]).toBe('https://example.org/from-library')
    expect(library.calls.counts).toBe(2)
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 2, All: 4 })
  })
})

describe('LibraryView superseding a read it no longer needs', () => {
  it('aborts the search in flight when a second search starts', async () => {
    const signals: AbortSignal[] = []
    const library = fakeLibrarySource([], {
      listItems: (_query: unknown, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<LibraryItemList>(() => {})
      }
    } as Partial<LibrarySource>)
    const { wrapper } = await mountAt('/library?v=all', library)

    await wrapper.get('#library-search').setValue('comp')
    await wrapper.get('#library-search').setValue('compila')

    expect(signals).toHaveLength(3)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(true)
    expect(signals[2].aborted).toBe(false)
  })

  it('aborts the read in flight when the route leaves the screen', async () => {
    const signals: AbortSignal[] = []
    const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
    const library = fakeLibrarySource([], {
      listItems: (_query: unknown, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<LibraryItemList>(() => {})
      }
    } as Partial<LibrarySource>)

    await router.push('/library')
    await router.isReady()
    mount(RouterView, {
      global: {
        plugins: [router, sourcesPlugin({ ...companionSources(), library })]
      }
    })
    await flushReads()

    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)

    await router.push('/')
    await flushReads()

    expect(signals[0].aborted).toBe(true)
  })

  it('offers the review queue as a tab, and reads no shelf while it is on screen', async () => {
    const library = fakeLibrarySource(shelf())
    const core = fakeCoreSource({
      links: [
        coreLink({
          id: 'link-suggested',
          status: 'suggested',
          source: 'llm',
          confidence: 0.8,
          src: registryItem({ id: 'item-consensus', title: 'Consensus notes' }),
          dst: registryItem({ id: 'subject-sd', module: 'core', type: 'subject', title: 'Distributed systems' })
        })
      ]
    })
    const { wrapper } = await mountAt('/library?v=pending-connections', library, core)

    // The tab is selected, the shelf was never asked for, and the queue is on
    // screen instead of the item list.
    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Pending connections')
    expect(library.calls.list).toHaveLength(0)
    expect(wrapper.find('.library-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('Consensus notes')
    // The queue carries no count, because the only number this screen could
    // print is the size of the first page.
    expect(segCounts(wrapper)).toEqual({
      Inbox: 1,
      'Up Next': 0,
      Later: 1,
      Archive: 1,
      Stash: 0,
      All: 3
    })
  })

  it('reads the shelf when the person leaves the review queue', async () => {
    const library = fakeLibrarySource(shelf())
    const core = fakeCoreSource({})
    const { wrapper, router } = await mountAt('/library?v=pending-connections', library, core)

    expect(library.calls.list).toHaveLength(0)

    await router.push('/library?v=all')
    await flushReads()

    expect(lastQuery(library)?.view).toBe('all')
    expect(titles(wrapper)).toHaveLength(3)
  })
})

describe('LibraryView ranked by the focus', () => {
  /** Items the fake ranks: the score it means is stated on `why`. */
  function focusShelf(): LibraryItemRecord[] {
    return [
      libraryRecord({
        id: 'off-focus',
        title: 'Saved with no subject',
        location: 'inbox',
        unread: true,
        saved_at: `${TODAY}T11:00:00Z`
      }),
      libraryRecord({
        id: 'in-focus',
        title: 'Linked to the current focus',
        location: 'archive',
        unread: true,
        reason: 'focus:1',
        saved_at: '2026-09-20T10:00:00Z'
      })
    ]
  }

  it('reads the date order first and asks for view=suggestions only once it is chosen', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/library', library)

    expect(library.calls.list).toHaveLength(1)
    expect(library.calls.list[0].view).toBe('inbox')
    expect(library.calls.list.some((query) => query.view === 'suggestions')).toBe(false)

    await chooseSort(wrapper, 'suggestions')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'suggestions' })
    // The ranked view carries its own order: the three parameters the server
    // refuses alongside it must not be sent.
    expect(lastQuery(library)?.sort).toBeUndefined()
    expect(lastQuery(library)?.q).toBeUndefined()
    expect(lastQuery(library)?.unread).toBeNull()
    // Ranked above the newer item, and from another shelf than the one open.
    expect(titles(wrapper)).toEqual(['Linked to the current focus', 'Saved with no subject'])

    await chooseSort(wrapper, 'saved_desc')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'inbox' })
  })

  it('offers five orders, marks the one in force, and names it on the button', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/library', library)

    expect(menuTrigger(wrapper, 'sort').attributes('aria-label')).toBe('Sort: Newest')
    expect(await menuRows(wrapper, 'sort')).toEqual([
      'Newest',
      'Oldest',
      'Title',
      'Recently opened',
      'Suggestions'
    ])
    expect(wrapper.get('.library-sort [aria-checked="true"]').text()).toBe('Newest')

    await chooseSort(wrapper, 'saved_asc')
    await flushReads()

    expect(menuTrigger(wrapper, 'sort').attributes('aria-label')).toBe('Sort: Oldest')
    expect((await menuRows(wrapper, 'sort')).length).toBe(5)
    expect(wrapper.get('.library-sort [aria-checked="true"]').text()).toBe('Oldest')
  })

  it('sends each order the way the contract spells it', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    for (const value of ['saved_asc', 'title', 'last_opened_desc', 'saved_desc']) {
      await chooseSort(wrapper, value)
      await flushReads()
      expect(lastQuery(library), value).toMatchObject({ view: 'all', sort: value })
    }
  })

  it('disables the search box and selects no shelf while the ranking is on', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/library', library)

    expect(wrapper.get('#library-search').attributes('disabled')).toBeUndefined()
    await chooseSort(wrapper, 'suggestions')
    await flushReads()

    // The box stays on screen and refuses text: the ranked list is read over
    // every shelf and the server refuses a text query alongside it.
    expect(wrapper.get('#library-search').attributes('disabled')).toBeDefined()
    // The tabs are still there -- they are the way back -- and none is marked,
    // because the rows on screen come from no single shelf.
    expect(tabLabels(wrapper)).toHaveLength(7)
    expect(wrapper.find('.library-tabs [aria-selected="true"]').exists()).toBe(false)
  })

  it('puts the order back to the default when a shelf tab is picked', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/library?v=inbox', library)

    await chooseSort(wrapper, 'suggestions')
    await flushReads()
    expect(lastQuery(library)).toMatchObject({ view: 'suggestions' })

    // The shelf that was already addressed, so the route does not change and
    // the reset cannot be coming from the navigation.
    await clickTab(wrapper, 'Inbox')

    expect(lastQuery(library)).toMatchObject({ view: 'inbox', sort: 'saved_desc' })
    expect(menuTrigger(wrapper, 'sort').attributes('aria-label')).toBe('Sort: Newest')
    expect(wrapper.get('.library-tabs [aria-selected="true"]').text()).toContain('Inbox')
  })

  it('cannot be chosen while a search is running, because the pair is refused', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    await wrapper.get('#library-search').setValue('focus')
    await flushReads()

    // The whole menu is out of reach while the text is there, the ranking with
    // it: the ranked list takes no text query, so the two are never both on.
    expect(menuTrigger(wrapper, 'sort').attributes('disabled')).toBeDefined()
    await menuTrigger(wrapper, 'sort').trigger('click')
    expect(wrapper.find('.library-sort [role="menu"]').exists()).toBe(false)
    expect(lastQuery(library)).toMatchObject({ q: 'focus' })
  })

  it('draws away from the focus and opens the item the server picked', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper, router } = await mountAt('/library', library)
    // The navigation itself is asserted on the call rather than on the route
    // that follows: the reader's component is loaded lazily, so the route
    // settles on the module loader's schedule and not on this test's.
    const pushed = vi.spyOn(router, 'push')

    await wrapper.get('.library-surprise').trigger('click')
    await flushReads()

    expect(library.calls.draw).toEqual([{ away_from_focus: true }])
    expect(pushed).toHaveBeenCalledWith({ name: 'reader', params: { id: 'off-focus' } })
  })

  it('says there is nothing to read when the draw comes back empty', async () => {
    const library = fakeLibrarySource(focusShelf(), {
      drawItems: async () => []
    } as Partial<LibrarySource>)
    const { wrapper, router } = await mountAt('/library', library)
    const pushed = vi.spyOn(router, 'push')

    await wrapper.get('.library-surprise').trigger('click')
    await flushReads()

    expect(wrapper.find('.library-nothing').text()).toBe('Nothing to read')
    expect(pushed).not.toHaveBeenCalled()
  })
})

describe('LibraryView with the review queue and the focus ranking together', () => {
  function tabLabelled(wrapper: VueWrapper, label: string) {
    return wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes(label))
  }

  it('keeps the order control and the draw on the shelves, off the review queue', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/library', library, fakeCoreSource({}))

    expect(wrapper.find('.library-sort').exists()).toBe(true)
    expect(wrapper.find('.library-filter').exists()).toBe(true)
    expect(wrapper.find('.library-surprise').exists()).toBe(true)

    await router.push('/library?v=pending-connections')
    await flushReads()

    expect(wrapper.find('.library-sort').exists()).toBe(false)
    expect(wrapper.find('.library-filter').exists()).toBe(false)
    expect(wrapper.find('.library-surprise').exists()).toBe(false)
    expect(wrapper.find('#library-search').exists()).toBe(false)
  })

  it('keeps the ranking waiting while the queue is on screen, and ranks again on the way back', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/library', library, fakeCoreSource({}))

    await chooseSort(wrapper, 'suggestions')
    await flushReads()
    expect(lastQuery(library)).toMatchObject({ view: 'suggestions' })

    // Reached from the sidebar rather than from the tabs, which is the one way
    // in that does not go through the reset a tab performs.
    await router.push('/library?v=pending-connections')
    await flushReads()

    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Pending connections')
    expect(wrapper.text()).not.toContain('First what is linked to the current focus')

    await router.push('/library?v=inbox')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'suggestions' })
  })

  it('puts the order back when the queue is reached through its own tab', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library', library, fakeCoreSource({}))

    await chooseSort(wrapper, 'suggestions')
    await flushReads()

    await clickTab(wrapper, 'Pending connections')
    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Pending connections')

    await clickTab(wrapper, 'Inbox')

    expect(lastQuery(library)).toMatchObject({ view: 'inbox', sort: 'saved_desc' })
  })

  it('drops the unread notice on the review queue', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/library', library, fakeCoreSource({}))

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()
    expect(wrapper.text()).toContain('Showing unread only')

    await router.push('/library?v=pending-connections')
    await flushReads()

    expect(wrapper.text()).not.toContain('Showing unread only')
  })
})

describe('LibraryView filtering from the header', () => {
  it('offers the unread toggle and one entry per kind, named as the sidebar names them', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    expect(await menuRows(wrapper, 'filter')).toEqual([
      'Unread only',
      'Every kind',
      'Posts',
      'Books',
      'Papers',
      'Videos',
      'Podcasts',
      'Newsletters',
      'Courses'
    ])
  })

  it('narrows to the chosen kind, in the spelling the contract uses', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/library?v=all', library)

    await pick(wrapper, 'filter', '[data-kind="book"]')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'all', kind: 'book' })
    expect(titles(wrapper)).toEqual(['A saved book'])
    // The kind is an address, so the sidebar's link and this menu agree on it.
    expect(router.currentRoute.value.query.kind).toBe('book')

    await pick(wrapper, 'filter', '[data-kind=""]')
    await flushReads()

    expect(lastQuery(library)?.kind).toBeNull()
    expect(router.currentRoute.value.query.kind).toBeUndefined()
    expect(titles(wrapper)).toHaveLength(3)
  })

  it('marks the kind in force and shows the icon as set whenever any filter is', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    expect(menuTrigger(wrapper, 'filter').classes()).not.toContain('is-active')
    await menuTrigger(wrapper, 'filter').trigger('click')
    expect(wrapper.get('.library-filter [role="menuitemradio"][aria-checked="true"]').text()).toBe(
      'Every kind'
    )
    await menuTrigger(wrapper, 'filter').trigger('click')

    await pick(wrapper, 'filter', '[data-kind="paper"]')
    await flushReads()

    expect(menuTrigger(wrapper, 'filter').classes()).toContain('is-active')
    await menuTrigger(wrapper, 'filter').trigger('click')
    expect(wrapper.get('.library-filter [role="menuitemradio"][aria-checked="true"]').text()).toBe('Papers')
  })

  it('shows the icon as set for the unread toggle alone, and reports it on the checkbox', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ unread: true })
    expect(menuTrigger(wrapper, 'filter').classes()).toContain('is-active')
    await menuTrigger(wrapper, 'filter').trigger('click')
    expect(wrapper.get('.library-filter [role="menuitemcheckbox"]').attributes('aria-checked')).toBe('true')
    await menuTrigger(wrapper, 'filter').trigger('click')

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()

    expect(lastQuery(library)?.unread).toBeNull()
    expect(menuTrigger(wrapper, 'filter').classes()).not.toContain('is-active')
  })

  it('keeps the kind and the unread filter on the ranked list, which the contract allows', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/library?v=all', library)

    await pick(wrapper, 'filter', '[data-kind="article"]')
    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await chooseSort(wrapper, 'suggestions')
    await flushReads()

    // The sort and the text query are what the view refuses, and neither is
    // sent; unread is an ordinary filter over it and is.
    expect(lastQuery(library)).toMatchObject({ view: 'suggestions', kind: 'article', unread: true })
    expect(lastQuery(library)?.sort).toBeUndefined()
    expect(lastQuery(library)?.q).toBeUndefined()
  })

  it('makes the unread toggle do something under Suggestions, both ways', async () => {
    const library = fakeLibrarySource([
      libraryRecord({ id: 'off-focus', location: 'inbox', unread: true }),
      libraryRecord({ id: 'in-focus', location: 'archive', unread: true, reason: 'focus:1' })
    ])
    const { wrapper } = await mountAt('/library', library)

    await chooseSort(wrapper, 'suggestions')
    await flushReads()

    // Suggestions used to be unread-only whatever the toggle said, which is
    // why the comment it carried claimed the flag changed nothing here.
    expect(lastQuery(library)).toMatchObject({ view: 'suggestions' })
    expect(lastQuery(library)?.unread).toBeNull()
    expect(wrapper.find('.library-unread').text()).not.toContain('Showing unread only')

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'suggestions', unread: true })
    expect(wrapper.get('.library-unread').text()).toContain('Showing unread only')

    await pick(wrapper, 'filter', '[data-filter="unread"]')
    await flushReads()

    // Off is "no unread filter", not "read only": the view's default answer is
    // every location, unread first and read after, which is what it exists to
    // rank. unread=false is a filter of its own and the server takes it, but
    // it is not what clearing the toggle asks for.
    expect(lastQuery(library)).toMatchObject({ view: 'suggestions' })
    expect(lastQuery(library)?.unread).toBeNull()
    expect(
      wrapper.findAll('.library-unread').some((banner) => banner.text().includes('Showing unread only'))
    ).toBe(false)
  })
})
