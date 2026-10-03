import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { routes } from '@/router'
import { store } from '@/mock/store'
import LibraryView from './LibraryView.vue'

interface StatusSnapshot {
  id: string
  status: string
  unread: boolean
}

let snapshot: StatusSnapshot[] = []

beforeEach(() => {
  snapshot = store.libraryItems.map((item) => ({ id: item.id, status: item.status, unread: item.unread }))
})

afterEach(() => {
  for (const saved of snapshot) {
    const item = store.libraryItems.find((candidate) => candidate.id === saved.id)
    if (item) {
      item.status = saved.status as typeof item.status
      item.unread = saved.unread
    }
  }
})

async function mountAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LibraryView, { global: { plugins: [router] } })
  await nextTick()
  return { wrapper, router }
}

async function settleFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(check()).toBe(true)
}

function titles(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.item-title').map((node) => node.text())
}

function segCounts(wrapper: VueWrapper): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const button of wrapper.findAll('.nt-seg-btn')) {
    const label = button.find('span').text()
    counts[label] = Number(button.find('.nt-seg-count').text())
  }
  return counts
}

describe('LibraryView', () => {
  it('renders its title and main regions', async () => {
    const { wrapper } = await mountAt('/biblioteca')

    expect(wrapper.find('h1').text()).toBe('Biblioteca')
    expect(wrapper.find('.nt-seg').exists()).toBe(true)
    expect(segCounts(wrapper)).toEqual({ Inbox: 6, Depois: 4, Arquivo: 4, Tudo: 18 })
    expect(wrapper.findAll('article.item')).toHaveLength(6)
    expect(wrapper.find('.library-count').text()).toBe('6 itens')
  })

  it('switches the segment and syncs ?v=', async () => {
    const { wrapper, router } = await mountAt('/biblioteca')

    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('Depois'))!.trigger('click')
    await settleFor(() => router.currentRoute.value.query.v === 'depois')

    expect(router.currentRoute.value.fullPath).toBe('/biblioteca?v=depois')
    expect(titles(wrapper)).toHaveLength(4)
    expect(wrapper.find('.library-count').text()).toBe('4 itens')
  })

  it('falls back to the inbox for an unknown view', async () => {
    const { wrapper, router } = await mountAt('/biblioteca?v=bogus')

    expect(wrapper.find('h1').text()).toBe('Biblioteca')
    expect(wrapper.findAll('article.item')).toHaveLength(6)
    expect(router.currentRoute.value.query.v).toBe('bogus')
  })

  it('shows exactly the archived books for ?v=arquivo&tipo=Livro', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=arquivo&tipo=Livro')

    expect(wrapper.find('h1').text()).toBe('Livros')
    expect(titles(wrapper)).toEqual(['Letras em Movimento'])
    expect(wrapper.find('.library-count').text()).toBe('1 item')
  })

  it('accepts both the sidebar kinds and the prototype type labels', async () => {
    const cases: Array<[string, string, number]> = [
      ['/biblioteca?tipo=livro', 'Livros', 1],
      ['/biblioteca?tipo=Artigo', 'Artigos', 1],
      ['/biblioteca?tipo=PDF', 'PDFs', 1],
      ['/biblioteca?tipo=V%C3%ADdeo', 'Vídeos', 1],
      ['/biblioteca?tipo=Podcast', 'Podcasts', 1],
      ['/biblioteca?tipo=curso', 'Cursos', 1]
    ]
    for (const [path, heading, inboxCount] of cases) {
      const { wrapper } = await mountAt(path)
      expect(wrapper.find('h1').text()).toBe(heading)
      expect(wrapper.findAll('article.item')).toHaveLength(inboxCount)
    }
  })

  it('renders the empty state when no mock items match', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo&tipo=Newsletter')

    expect(wrapper.find('h1').text()).toBe('Newsletters')
    expect(wrapper.findAll('article.item')).toHaveLength(0)
    expect(wrapper.find('.library-empty').text()).toBe('Nenhum item deste tipo.')
    expect(wrapper.find('.library-count').text()).toBe('0 itens')
  })

  it('moves an item to Depois through the later action and updates the counts', async () => {
    const { wrapper } = await mountAt('/biblioteca')
    const first = titles(wrapper)[0]

    await wrapper.findAll('article.item')[0].find('button[aria-label="Depois"]').trigger('click')
    await settleFor(() => !titles(wrapper).includes(first))

    expect(segCounts(wrapper)).toMatchObject({ Inbox: 5, Depois: 5 })
    expect(wrapper.find('.library-count').text()).toBe('5 itens')
    expect(store.libraryItems.find((item) => item.title === first)?.status).toBe('depois')
  })

  it('moves an item to Arquivo through the archive action', async () => {
    const { wrapper, router } = await mountAt('/biblioteca')
    const first = titles(wrapper)[0]

    await wrapper.findAll('article.item')[0].find('button[aria-label="Arquivar"]').trigger('click')
    await settleFor(() => !titles(wrapper).includes(first))

    expect(segCounts(wrapper)).toMatchObject({ Inbox: 5, Arquivo: 5 })

    await router.push({ query: { v: 'arquivo' } })
    await settleFor(() => titles(wrapper).includes(first))
    expect(titles(wrapper)).toContain(first)
  })

  it('marks an item read so it leaves the view and stays in Tudo', async () => {
    const { wrapper, router } = await mountAt('/biblioteca')
    const first = titles(wrapper)[0]

    await wrapper.findAll('article.item')[0].find('button[aria-label="Marcar como lido"]').trigger('click')
    await settleFor(() => !titles(wrapper).includes(first))

    const stored = store.libraryItems.find((item) => item.title === first)
    expect(stored).toMatchObject({ status: 'read', unread: false })

    await router.push({ query: { v: 'tudo' } })
    await settleFor(() => titles(wrapper).includes(first))
    expect(titles(wrapper)).toContain(first)
  })

  it('filters to unread items with Só não lidos', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo')

    await wrapper.find('button[aria-label="Só não lidos"]').trigger('click')
    await settleFor(() => wrapper.find('.library-unread').exists())

    expect(wrapper.findAll('article.item')).toHaveLength(10)
    expect(wrapper.find('.library-count').text()).toBe('10 itens')
    for (const row of wrapper.findAll('article.item')) {
      expect(row.find('.item-dot').exists()).toBe(true)
    }

    await wrapper.find('.ghost-clear').trigger('click')
    await settleFor(() => wrapper.findAll('article.item').length === 18)
  })

  it('toggles the sort between Data salva and Título', async () => {
    const { wrapper } = await mountAt('/biblioteca?v=tudo')
    const byDate = titles(wrapper)

    await wrapper.findAll('.ghost').find((button) => button.text().includes('Data salva'))!.trigger('click')
    await settleFor(() => titles(wrapper)[0] !== byDate[0])

    const expected = [...store.libraryItems].map((item) => item.title).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    expect(titles(wrapper)).toEqual(expected)
    expect(wrapper.findAll('.ghost').find((button) => button.text() === 'Título')!.exists()).toBe(true)
  })

  it('links every item to its material route', async () => {
    const { wrapper, router } = await mountAt('/biblioteca?v=tudo')

    for (const link of wrapper.findAll('.item-title')) {
      const resolved = router.resolve(link.attributes('href')!)
      expect(resolved.name).toBe('material')
      const item = store.libraryItems.find((candidate) => candidate.id === resolved.params.id)
      expect(item).toBeDefined()
      expect(resolved.params.kind).toBe(item!.kind)
      expect(link.text()).toBe(item!.title)
    }
  })

  it('navigates to the material screen when an item is clicked', async () => {
    const { wrapper, router } = await mountAt('/biblioteca')
    const first = store.libraryItems.find((item) => titles(wrapper)[0] === item.title)!

    await wrapper.findAll('.item-title')[0].trigger('click')
    await settleFor(() => router.currentRoute.value.name === 'material')

    expect(router.currentRoute.value.fullPath).toBe(`/material/${first.kind}/${first.id}`)
  })
})
