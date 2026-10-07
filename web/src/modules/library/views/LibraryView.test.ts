import { mount, type VueWrapper } from '@vue/test-utils'
import { RouterView, createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import type { LibraryItem } from '@/mock/types'
import { resetModuleMounting } from '@/modules/mounting'
import { createRouteTable, routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { LibraryList, LibrarySource } from '../data/source'
import LibraryView from './LibraryView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

afterEach(() => {
  vi.useRealTimers()
  resetModuleMounting()
})

/** The cross-module menus read these; a test that is not about them can ignore both. */
function companionSources(): Partial<AppSources> {
  return {
    study: {
      summary: async () => ({
        counts: { curricula: 1, modules: 1, subjects: 1 },
        curricula: [{ slug: 'horta-caseira', title: 'Horta caseira' }]
      })
    } as unknown as AppSources['study'],
    projects: {
      summary: async () => ({
        counts: { projects: 1, active: 1, paused: 0, openTasks: 0, pendingDecisions: 0 },
        areas: [],
        projects: [{ id: 'project-horta', title: 'Horta da varanda' }]
      })
    } as unknown as AppSources['projects']
  }
}

async function mountAt(path: string, sources: Partial<AppSources>): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LibraryView, {
    global: { plugins: [router, sourcesPlugin({ ...companionSources(), ...sources })] }
  })
  await flushReads()
  return { wrapper, router }
}

function titles(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.item-title').map((node) => node.text())
}

function segCounts(wrapper: VueWrapper): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const button of wrapper.findAll('.nt-seg-btn')) {
    counts[button.find('span').text()] = Number(button.find('.nt-seg-count').text())
  }
  return counts
}

function pageOf(items: LibraryItem[]): LibraryList {
  return {
    items,
    next_cursor: null,
    counts: {
      inbox: items.filter((item) => item.status === 'inbox').length,
      depois: items.filter((item) => item.status === 'depois').length,
      arquivo: items.filter((item) => item.status === 'arquivo').length,
      tudo: items.length,
      unread: items.filter((item) => item.unread).length
    }
  }
}

/** A library source answering with exactly these rows, and whatever the test overrides. */
function libraryWith(items: LibraryItem[], overrides: Partial<LibrarySource> = {}): Partial<AppSources> {
  const page = pageOf(items)
  return {
    library: {
      listItems: async () => page,
      getItem: async () => items[0] ?? null,
      summary: async () => ({ counts: page.counts, kinds: {}, lists: [] }),
      saveLink: async () => items[0],
      setStatus: async () => items[0],
      setUnread: async () => items[0],
      setCurriculum: async () => items[0],
      ...overrides
    } as unknown as AppSources['library']
  }
}

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'post-one',
    kind: 'post',
    title: 'Um texto guardado',
    author: 'Equipe Norte',
    url: 'https://example.com/one',
    status: 'inbox',
    unread: true,
    savedAt: TODAY,
    ...overrides
  }
}

describe('LibraryView over the mock source', () => {
  it('renders its title, counts and rows once the list answers', async () => {
    const { wrapper } = await mountAt('/biblioteca', createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Biblioteca')
    expect(segCounts(wrapper)).toEqual({ Inbox: 6, Depois: 4, Arquivo: 8, Tudo: 18 })
    expect(wrapper.findAll('article.item')).toHaveLength(6)
    expect(wrapper.find('.library-count').text()).toBe('6 itens')
  })

  it('shows only unread items over Tudo, which is every item nobody has read', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo', createMockSources(store))
    const read = store.libraryItems.filter((candidate) => !candidate.unread).length

    expect(read).toBe(8)
    await wrapper.find('button[aria-label="Só não lidos"]').trigger('click')

    expect(wrapper.findAll('article.item')).toHaveLength(18 - read)
    expect(wrapper.find('.library-count').text()).toBe(`${18 - read} itens`)
  })

  it('narrows to a kind from ?tipo and dates each row by the calendar', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo&tipo=livros', createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Livros')
    expect(wrapper.findAll('article.item')).toHaveLength(3)
    // "Pequenas Linguagens, Grandes Ideias" was saved today, and sorts first.
    expect(wrapper.findAll('.item-date')[0].text()).toBe('3 out')
  })

  it('searches by title through the source', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo', createMockSources(store))

    await wrapper.get('#library-search').setValue('compostagem')
    await flushReads()

    expect(titles(wrapper)).toEqual(['Compostagem Doméstica em Pequena Escala'])
  })
})

describe('LibraryView while it waits, finds nothing, or fails', () => {
  it('says it is loading before the first answer arrives', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/biblioteca')
    const wrapper = mount(LibraryView, {
      global: {
        plugins: [
          router,
          sourcesPlugin({
            ...companionSources(),
            ...libraryWith([], { listItems: () => new Promise<LibraryList>(() => {}) })
          })
        ]
      }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando a biblioteca…')
    expect(wrapper.findAll('article.item')).toHaveLength(0)
    expect(wrapper.find('.library-count').exists()).toBe(false)
  })

  it('says the list is empty once it has answered with nothing', async () => {
    const { wrapper } = await mountAt('/biblioteca', libraryWith([]))

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.library-empty').text()).toContain('Inbox vazia')
    expect(segCounts(wrapper)).toEqual({ Inbox: 0, Depois: 0, Arquivo: 0, Tudo: 0 })
  })

  it('says why it could not load, and reads again when asked', async () => {
    let attempts = 0
    const { wrapper } = await mountAt(
      '/biblioteca',
      libraryWith([item()], {
        listItems: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede indisponível')
          return pageOf([])
        }
      })
    )

    expect(wrapper.get('.library-error').text()).toContain('Não foi possível carregar a biblioteca: rede indisponível')
    expect(wrapper.findAll('article.item')).toHaveLength(0)

    await wrapper.get('.library-error button').trigger('click')
    await flushReads()

    expect(wrapper.find('.library-error').exists()).toBe(false)
    expect(wrapper.find('.library-empty').exists()).toBe(true)
  })

  it('reports nothing found for a search that matches no row', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo', libraryWith([]))

    await wrapper.get('#library-search').setValue('xilofone')
    await flushReads()

    expect(wrapper.get('.library-empty').text()).toBe('Nada encontrado para “xilofone”.')
  })
})

describe('LibraryView writing to its source', () => {
  it('shows the row the source answered with, not the one it asked for', async () => {
    const stored = item({ status: 'inbox' })
    // The source archives it *and* renames it: only a page that renders the
    // response can show the new title.
    const answered: LibraryItem = { ...stored, status: 'arquivo', title: 'O título que o servidor devolveu' }
    const { wrapper } = await mountAt(
      '/biblioteca?v=tudo',
      libraryWith([stored], { setStatus: async () => answered })
    )

    await wrapper.get('button[aria-label="Arquivar"]').trigger('click')
    await flushReads()

    expect(titles(wrapper)).toEqual(['O título que o servidor devolveu'])
    expect(wrapper.find('button[aria-label="Desarquivar"]').exists()).toBe(true)
    expect(segCounts(wrapper)).toMatchObject({ Arquivo: 1, Inbox: 0 })
  })

  it('leaves the row untouched and says so when the write fails', async () => {
    const stored = item({ status: 'inbox' })
    const { wrapper } = await mountAt(
      '/biblioteca?v=tudo',
      libraryWith([stored], {
        setStatus: async () => {
          throw new Error('conflito no servidor')
        }
      })
    )

    await wrapper.get('button[aria-label="Arquivar"]').trigger('click')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível salvar: conflito no servidor')
    expect(titles(wrapper)).toEqual([stored.title])
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 1, Arquivo: 0 })
    // The row still offers to archive, because nothing was archived.
    expect(wrapper.find('button[aria-label="Arquivar"]').exists()).toBe(true)
  })

  it('marks an item read without moving it out of the list it is in', async () => {
    const { wrapper } = await mountAt('/biblioteca', createMockSources(store))
    const first = titles(wrapper)[0]

    await wrapper.findAll('article.item')[0].get('button[aria-label="Marcar como lido"]').trigger('click')
    await flushReads()

    expect(titles(wrapper)).toContain(first)
    expect(segCounts(wrapper)).toMatchObject({ Inbox: 6, Tudo: 18 })
    expect(wrapper.findAll('article.item')[0].find('.item-dot').exists()).toBe(false)
    expect(wrapper.findAll('article.item')[0].find('button[aria-label="Marcar como não lido"]').exists()).toBe(true)
  })
})

describe('LibraryView superseding a read it no longer needs', () => {
  it('aborts the search in flight when a second search starts', async () => {
    const signals: AbortSignal[] = []
    const { wrapper } = await mountAt(
      '/biblioteca?v=tudo',
      libraryWith([], {
        listItems: (_query, signal) => {
          signals.push(signal)
          return new Promise<LibraryList>(() => {})
        }
      })
    )

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
    const sources = {
      ...companionSources(),
      ...libraryWith([], {
        listItems: (_query, signal) => {
          signals.push(signal)
          return new Promise<LibraryList>(() => {})
        }
      })
    }

    await router.push('/biblioteca')
    await router.isReady()
    mount(RouterView, { global: { plugins: [router, sourcesPlugin(sources)] } })
    await flushReads()

    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)

    await router.push('/')
    await flushReads()

    expect(signals[0].aborted).toBe(true)
  })
})
