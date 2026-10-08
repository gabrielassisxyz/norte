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
        projects: [{ id: 'project-horta', title: 'Horta da varanda' }]
      })
    } as unknown as AppSources['projects']
  }
}

async function mountAt(
  path: string,
  library: Partial<AppSources['library']>,
  core?: AppSources['core']
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LibraryView, {
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
 * than reported as zero: the review queue is one, and "0 sugestões" is a
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

function lastQuery(library: FakeLibrarySource) {
  return library.calls.list.at(-1)
}

function shelf(): LibraryItemRecord[] {
  return [
    libraryRecord({
      id: 'post-um',
      kind: 'post',
      title: 'Um texto guardado',
      author: 'Equipe Norte',
      status: 'inbox',
      unread: true,
      saved_at: `${TODAY}T10:00:00Z`
    }),
    libraryRecord({
      id: 'livro-um',
      kind: 'livro',
      title: 'Um livro guardado',
      author: 'Marina Costa',
      status: 'depois',
      unread: true,
      saved_at: '2026-10-01T10:00:00Z'
    }),
    libraryRecord({
      id: 'paper-um',
      kind: 'paper',
      title: 'Um paper guardado',
      site: 'papers.example',
      status: 'arquivo',
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
      title: `Leitura ${position}`,
      saved_at: `2026-10-03T${String(23 - Math.floor(position / 60)).padStart(2, '0')}:${String(
        59 - (position % 60)
      ).padStart(2, '0')}:00Z`
    })
  )
}

describe('LibraryView over the API', () => {
  it('renders its title, the endpoint counts and the rows the server sent', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca', library)

    expect(wrapper.find('h1').text()).toBe('Biblioteca')
    // The counts are the whole library's, not the page's: one row is on screen.
    expect(segCounts(wrapper)).toEqual({ Inbox: 1, Depois: 1, Arquivo: 1, Tudo: 3 })
    expect(titles(wrapper)).toEqual(['Um texto guardado'])
    expect(wrapper.find('.library-count').text()).toBe('1 item')
    expect(library.calls.counts).toBe(1)
  })

  it('asks the server for the shelf rather than filtering the page it has', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=arquivo', library)

    expect(lastQuery(library)).toMatchObject({ view: 'arquivo' })
    expect(titles(wrapper)).toEqual(['Um paper guardado'])
  })

  it('asks the server for unread only, and says so on the page', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    expect(lastQuery(library)?.unread).toBeNull()

    await wrapper.find('button[aria-label="Só não lidos"]').trigger('click')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'tudo', unread: true })
    expect(titles(wrapper)).toEqual(['Um texto guardado', 'Um livro guardado'])
    expect(wrapper.get('.library-unread').text()).toContain('Mostrando só não lidos')
  })

  it('narrows to a kind from ?tipo, in the spelling the contract uses', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=tudo&tipo=livros', library)

    expect(wrapper.find('h1').text()).toBe('Livros')
    expect(lastQuery(library)).toMatchObject({ tipo: 'livro' })
    expect(titles(wrapper)).toEqual(['Um livro guardado'])
    expect(wrapper.findAll('.item-date')[0].text()).toBe('1 out')
  })

  it('sends the search term as q and the order as the contract spells it', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    await wrapper.get('#library-search').setValue('paper')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ q: 'paper' })
    expect(titles(wrapper)).toEqual(['Um paper guardado'])

    await wrapper.get('#library-search').setValue('')
    await wrapper.findAll('.ghost')[0].trigger('click')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ sort: 'title' })
  })

  it('points every row at the reader', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/biblioteca', library)
    const href = wrapper.get('.item-title').attributes('href')!

    expect(href).toBe('/biblioteca/post-um')
    expect(router.resolve(href).name).toBe('leitor')
  })
})

describe('LibraryView growing its list', () => {
  it('shows 50, then 100, then 120, with no row twice and no button left', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    expect(wrapper.findAll('article.item')).toHaveLength(50)
    expect(wrapper.get('.library-more').text()).toBe('Carregar mais')

    await wrapper.get('.library-more').trigger('click')
    await flushReads()
    expect(wrapper.findAll('article.item')).toHaveLength(100)

    await wrapper.get('.library-more').trigger('click')
    await flushReads()
    expect(wrapper.findAll('article.item')).toHaveLength(120)
    expect(new Set(titles(wrapper)).size).toBe(120)
    expect(wrapper.find('.library-more').exists()).toBe(false)
    expect(wrapper.find('.library-count').text()).toBe('120 itens')
  })

  it('keeps the rows and says why next to the button when a further page fails', async () => {
    const records = manyRecords(120)
    const base = fakeLibrarySource(records)
    const library = fakeLibrarySource(records, {
      listItems: async (query, signal) => {
        if (query.cursor) throw new Error('rede caiu')
        return base.listItems(query, signal)
      }
    })
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    await wrapper.get('.library-more').trigger('click')
    await flushReads()

    expect(wrapper.findAll('article.item')).toHaveLength(50)
    expect(wrapper.find('.library-error').exists()).toBe(false)
    expect(wrapper.get('.library-more-error').text()).toContain('rede caiu')
    expect(wrapper.find('.library-more').exists()).toBe(true)
  })

  it('keeps the whole-library counts while the page grows', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    expect(segCounts(wrapper)).toMatchObject({ Tudo: 120, Inbox: 120 })
    await wrapper.get('.library-more').trigger('click')
    await flushReads()

    // 100 rows are on screen and the shelf still holds 120.
    expect(wrapper.findAll('article.item')).toHaveLength(100)
    expect(segCounts(wrapper)).toMatchObject({ Tudo: 120 })
  })

  it('starts over from the first page when a filter changes', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)
    await wrapper.get('.library-more').trigger('click')
    await flushReads()

    await wrapper.find('button[aria-label="Só não lidos"]').trigger('click')
    await flushReads()

    expect(wrapper.findAll('article.item')).toHaveLength(50)
    expect(lastQuery(library)?.cursor).toBeUndefined()
  })
})

describe('LibraryView while it waits, finds nothing, or fails', () => {
  it('says it is loading before the first answer arrives', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/biblioteca')
    const library = fakeLibrarySource([], { listItems: () => new Promise<LibraryItemList>(() => {}) })
    const wrapper = mount(LibraryView, {
      global: { plugins: [router, sourcesPlugin({ ...companionSources(), library })] }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando a biblioteca…')
    expect(wrapper.findAll('article.item')).toHaveLength(0)
    expect(wrapper.find('.library-count').exists()).toBe(false)
  })

  it('says the list is empty once it has answered with nothing', async () => {
    const { wrapper } = await mountAt('/biblioteca', fakeLibrarySource([]))

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.library-empty').text()).toContain('Inbox vazia')
    expect(segCounts(wrapper)).toEqual({ Inbox: 0, Depois: 0, Arquivo: 0, Tudo: 0 })
  })

  it('says why it could not load, and reads again when asked', async () => {
    let attempts = 0
    const library = fakeLibrarySource([], {
      listItems: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('rede indisponível')
        return { items: [], next_cursor: null }
      }
    })
    const { wrapper } = await mountAt('/biblioteca', library)

    expect(wrapper.get('.library-error').text()).toContain('Não foi possível carregar a biblioteca: rede indisponível')
    expect(wrapper.findAll('article.item')).toHaveLength(0)

    await wrapper.get('.library-error button').trigger('click')
    await flushReads()

    expect(wrapper.find('.library-error').exists()).toBe(false)
    expect(wrapper.find('.library-empty').exists()).toBe(true)
  })

  it('reports nothing found for a search that matches no row', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo', fakeLibrarySource(shelf()))

    await wrapper.get('#library-search').setValue('xilofone')
    await flushReads()

    expect(wrapper.get('.library-empty').text()).toBe('Nada encontrado para “xilofone”.')
  })
})

describe('LibraryView writing to the API', () => {
  it('shows the row the server answered with, not the one it asked for', async () => {
    const stored = libraryRecord({ id: 'post-um', title: 'O título que estava lá', status: 'inbox' })
    // The server archives it *and* renames it: only a page that renders the
    // response can show the new title.
    const library = fakeLibrarySource([stored], {
      patchItem: async () => ({ ...stored, status: 'arquivo', title: 'O título que o servidor devolveu' })
    })
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    await wrapper.get('button[aria-label="Arquivar"]').trigger('click')
    await flushReads()

    expect(titles(wrapper)).toEqual(['O título que o servidor devolveu'])
    expect(wrapper.find('button[aria-label="Desarquivar"]').exists()).toBe(true)
  })

  it('asks the counts endpoint again after a write instead of recounting the page', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    expect(library.calls.counts).toBe(1)
    await wrapper.get('button[aria-label="Arquivar"]').trigger('click')
    await flushReads()

    expect(library.calls.counts).toBe(2)
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 0, Arquivo: 2 })
  })

  it('leaves the row untouched and says so when the write fails', async () => {
    const stored = libraryRecord({ id: 'post-um', title: 'O título que estava lá', status: 'inbox' })
    const library = fakeLibrarySource([stored], {
      patchItem: async () => {
        throw new Error('conflito no servidor')
      }
    })
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    await wrapper.get('button[aria-label="Arquivar"]').trigger('click')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível salvar: conflito no servidor')
    expect(titles(wrapper)).toEqual([stored.title])
    // The row still offers to archive, because nothing was archived.
    expect(wrapper.find('button[aria-label="Arquivar"]').exists()).toBe(true)
  })

  it('marks an item read without moving it out of the shelf it is on', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca', library)

    await wrapper.get('button[aria-label="Marcar como lido"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'post-um', patch: { unread: false } }])
    expect(titles(wrapper)).toEqual(['Um texto guardado'])
    expect(wrapper.findAll('article.item')[0].find('.item-dot').exists()).toBe(false)
    expect(wrapper.findAll('article.item')[0].find('button[aria-label="Marcar como não lido"]').exists()).toBe(true)
  })

  it('shows an item saved elsewhere without a reload', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca', library)

    expect(titles(wrapper)).toEqual(['Um texto guardado'])

    // What the save dialog does: post the link, then say the library gained one.
    await library.saveLink({ url: 'https://example.org/reading-list' })
    libraryGainedItem()
    await flushReads()

    expect(titles(wrapper)).toContain('https://example.org/reading-list')
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 2, Tudo: 4 })
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
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

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

    await router.push('/biblioteca')
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
          id: 'link-sugerido',
          status: 'suggested',
          source: 'llm',
          confidence: 0.8,
          src: registryItem({ id: 'item-consenso', title: 'Notas sobre consenso' }),
          dst: registryItem({ id: 'subject-sd', module: 'core', type: 'subject', title: 'Sistemas distribuídos' })
        })
      ]
    })
    const { wrapper } = await mountAt('/biblioteca?v=sugestoes', library, core)

    // The tab is selected, the shelf was never asked for, and the queue is on
    // screen instead of the item list.
    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Sugestões')
    expect(library.calls.list).toHaveLength(0)
    expect(wrapper.find('.library-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('Notas sobre consenso')
    // The queue carries no count, because the only number this screen could
    // print is the size of the first page.
    expect(segCounts(wrapper)).toEqual({ Inbox: 1, Depois: 1, Arquivo: 1, Tudo: 3 })
  })

  it('reads the shelf when the person leaves the review queue', async () => {
    const library = fakeLibrarySource(shelf())
    const core = fakeCoreSource({})
    const { wrapper, router } = await mountAt('/biblioteca?v=sugestoes', library, core)

    expect(library.calls.list).toHaveLength(0)

    await router.push('/biblioteca?v=tudo')
    await flushReads()

    expect(lastQuery(library)?.view).toBe('tudo')
    expect(titles(wrapper)).toHaveLength(3)
  })
})
