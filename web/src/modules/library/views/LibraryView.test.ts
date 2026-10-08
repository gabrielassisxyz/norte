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
    // The screen carries a second segmented control, for the order, whose
    // options are not counted; only the shelves answer this question.
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
    await wrapper.get('.library-sort').trigger('click')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ sort: 'title' })
  })

  it('sends q without sort while a search text is active, and hides the sort toggle', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    // Blank text sends the default sort, the way it always did.
    expect(lastQuery(library)).toMatchObject({ sort: 'saved_desc' })
    expect(lastQuery(library)?.q).toBeUndefined()

    await wrapper.get('#library-search').setValue('paper')
    await flushReads()

    // The server refuses sort alongside q, so the screen sends q alone.
    expect(lastQuery(library)).toMatchObject({ q: 'paper' })
    expect(lastQuery(library)?.sort).toBeUndefined()
    expect('sort' in (lastQuery(library) ?? {})).toBe(false)
    // While the text is active the toggle has nothing to do, so it is gone.
    expect(wrapper.find('.library-sort').exists()).toBe(false)
  })

  it('sends the chosen sort again once the search text is cleared', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper } = await mountAt('/biblioteca?v=tudo', library)

    await wrapper.get('.library-sort').trigger('click')
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
    expect(wrapper.find('.library-sort').exists()).toBe(true)
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

describe('LibraryView ranked by the focus', () => {
  /** The order button carrying a label, which is not the shelf control. */
  function orderingButton(wrapper: VueWrapper, label: string) {
    const found = wrapper
      .findAll('.library-ordering .nt-seg-btn')
      .find((button) => button.text().includes(label))
    if (!found) throw new Error(`no order option labelled ${label}`)
    return found
  }

  /** Items the fake ranks: the score it means is stated on `why`. */
  function focusShelf(): LibraryItemRecord[] {
    return [
      libraryRecord({
        id: 'sem-foco',
        title: 'Guardado sem assunto',
        status: 'inbox',
        unread: true,
        saved_at: `${TODAY}T11:00:00Z`
      }),
      libraryRecord({
        id: 'no-foco',
        title: 'Ligado ao foco de agora',
        status: 'arquivo',
        unread: true,
        why: 'focus:1',
        saved_at: '2026-09-20T10:00:00Z'
      })
    ]
  }

  it('reads the date order first and asks for view=now only once it is chosen', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/biblioteca', library)

    expect(library.calls.list).toHaveLength(1)
    expect(library.calls.list[0].view).toBe('inbox')
    expect(library.calls.list.some((query) => query.view === 'now')).toBe(false)

    await orderingButton(wrapper, 'O que ler agora').trigger('click')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'now' })
    // The ranked view carries its own order: the three parameters the server
    // refuses alongside it must not be sent.
    expect(lastQuery(library)?.sort).toBeUndefined()
    expect(lastQuery(library)?.q).toBeUndefined()
    expect(lastQuery(library)?.unread).toBeNull()
    // Ranked above the newer item, and from another shelf than the one open.
    expect(titles(wrapper)).toEqual(['Ligado ao foco de agora', 'Guardado sem assunto'])

    await orderingButton(wrapper, 'Por data').trigger('click')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'inbox' })
  })

  it('hides the search, the sort and the unread filter while the ranking is on', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper } = await mountAt('/biblioteca', library)

    expect(wrapper.find('#library-search').exists()).toBe(true)
    await orderingButton(wrapper, 'O que ler agora').trigger('click')
    await flushReads()

    expect(wrapper.find('#library-search').exists()).toBe(false)
    expect(wrapper.find('.library-sort').exists()).toBe(false)
  })

  it('draws away from the focus and opens the item the server picked', async () => {
    const library = fakeLibrarySource(focusShelf())
    const { wrapper, router } = await mountAt('/biblioteca', library)
    // The navigation itself is asserted on the call rather than on the route
    // that follows: the reader's component is loaded lazily, so the route
    // settles on the module loader's schedule and not on this test's.
    const pushed = vi.spyOn(router, 'push')

    await wrapper.get('.library-surprise').trigger('click')
    await flushReads()

    expect(library.calls.draw).toEqual([{ away_from_focus: true }])
    expect(pushed).toHaveBeenCalledWith({ name: 'leitor', params: { id: 'sem-foco' } })
  })

  it('says there is nothing to read when the draw comes back empty', async () => {
    const library = fakeLibrarySource(focusShelf(), {
      drawItems: async () => []
    } as Partial<LibrarySource>)
    const { wrapper, router } = await mountAt('/biblioteca', library)
    const pushed = vi.spyOn(router, 'push')

    await wrapper.get('.library-surprise').trigger('click')
    await flushReads()

    expect(wrapper.find('.library-nothing').text()).toBe('Nada para ler')
    expect(pushed).not.toHaveBeenCalled()
  })
})

describe('LibraryView with the review queue and the focus ranking together', () => {
  function tabLabelled(wrapper: VueWrapper, label: string) {
    return wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes(label))
  }

  it('keeps the order control and the draw on the shelves, off the review queue', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/biblioteca', library, fakeCoreSource({}))

    expect(wrapper.find('.library-ordering').exists()).toBe(true)
    expect(wrapper.find('.library-surprise').exists()).toBe(true)

    await router.push('/biblioteca?v=sugestoes')
    await flushReads()

    expect(wrapper.find('.library-ordering').exists()).toBe(false)
    expect(wrapper.find('.library-surprise').exists()).toBe(false)
    expect(wrapper.find('#library-search').exists()).toBe(false)
  })

  it('shows the tabs on the review queue though the ranking was on, and ranks again on the way back', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/biblioteca', library, fakeCoreSource({}))

    await tabLabelled(wrapper, 'O que ler agora')!.trigger('click')
    await flushReads()
    expect(lastQuery(library)).toMatchObject({ view: 'now' })
    expect(tabLabelled(wrapper, 'Sugestões')).toBeUndefined()

    // Reached from outside the hidden control, as the sidebar would.
    await router.push('/biblioteca?v=sugestoes')
    await flushReads()

    // The order control is not on this screen, so the tabs are the only way off it.
    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Sugestões')
    expect(wrapper.text()).not.toContain('primeiro o que está ligado ao foco')

    await router.push('/biblioteca?v=inbox')
    await flushReads()

    expect(lastQuery(library)).toMatchObject({ view: 'now' })
  })

  it('drops the unread notice on the review queue', async () => {
    const library = fakeLibrarySource(shelf())
    const { wrapper, router } = await mountAt('/biblioteca', library, fakeCoreSource({}))

    await wrapper.get('[aria-label="Só não lidos"]').trigger('click')
    await flushReads()
    expect(wrapper.text()).toContain('Mostrando só não lidos')

    await router.push('/biblioteca?v=sugestoes')
    await flushReads()

    expect(wrapper.text()).not.toContain('Mostrando só não lidos')
  })
})
