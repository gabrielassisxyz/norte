import { mount } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { flushReads, sourcesPlugin } from '@/sources/testing'

import { useLibraryCounts, useLibraryItem, useLibraryItems, type LibraryItemsResource } from './composables'
import { libraryItemChanged } from './revision'
import type { LibraryItemRecord, LibraryListQuery } from './source'
import { fakeLibrarySource, libraryRecord, type FakeLibrarySource } from './testing'

/**
 * A composable held by a mounted component, which is the only way the
 * application ever holds one: the source is injected above it.
 */
async function hold<T>(library: FakeLibrarySource, use: () => T): Promise<T> {
  let captured: T | null = null
  const host = defineComponent({
    setup() {
      captured = use()
      return () => h('div')
    }
  })
  mount(host, { global: { plugins: [sourcesPlugin({ library })] } })
  await flushReads()
  if (captured === null) throw new Error('the host component never ran its setup')
  return captured
}

function manyRecords(count: number): LibraryItemRecord[] {
  return Array.from({ length: count }, (_, position) =>
    libraryRecord({
      id: `item-${String(position).padStart(3, '0')}`,
      title: `Leitura ${position}`,
      // Descending saved_at, so the fake's default order is the ids in order.
      saved_at: `2026-10-03T${String(23 - Math.floor(position / 60)).padStart(2, '0')}:${String(
        59 - (position % 60)
      ).padStart(2, '0')}:00Z`
    })
  )
}

describe('useLibraryItems over a paginated list', () => {
  it('grows the list page by page and repeats no row', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const items = await hold(library, () => useLibraryItems({ view: 'tudo' }))

    expect(items.data.value?.items).toHaveLength(50)
    expect(items.hasMore.value).toBe(true)

    await items.loadMore()
    expect(items.data.value?.items).toHaveLength(100)

    await items.loadMore()
    const loaded = items.data.value?.items ?? []
    expect(loaded).toHaveLength(120)
    expect(new Set(loaded.map((item) => item.id)).size).toBe(120)
    expect(items.hasMore.value).toBe(false)

    // Nothing left to ask for: the button is gone and a stray call is a no-op.
    const asked = library.calls.list.length
    await items.loadMore()
    expect(library.calls.list).toHaveLength(asked)
  })

  it('repeats no row when a page overlaps the one before it', async () => {
    // A row saved between two asks shifts the window, so the server can answer
    // the second page with a row the first page already carried.
    const records = manyRecords(60)
    const library = fakeLibrarySource(records, {
      listItems: async (query) => {
        const from = query.cursor ? Number(query.cursor) : 0
        const page = records.slice(from === 0 ? 0 : from - 5, (from === 0 ? 0 : from - 5) + 50)
        return { items: page, next_cursor: from === 0 ? '50' : null }
      }
    })
    const items = await hold(library, () => useLibraryItems({ view: 'tudo' }))

    await items.loadMore()
    const loaded = items.data.value?.items ?? []

    expect(loaded).toHaveLength(60)
    expect(new Set(loaded.map((item) => item.id)).size).toBe(60)
  })

  it('asks for the first page again, not for a cursor, when the query changes', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const query: Ref<LibraryListQuery> = ref({ view: 'tudo' })
    const items = await hold(library, () => useLibraryItems(query))

    await items.loadMore()
    expect(items.data.value?.items).toHaveLength(100)

    query.value = { view: 'inbox' }
    await flushReads()

    expect(items.data.value?.items).toHaveLength(50)
    expect(library.calls.list.at(-1)).toMatchObject({ view: 'inbox' })
    expect(library.calls.list.at(-1)?.cursor).toBeUndefined()
  })

  it('keeps the loaded pages when a write replaces one row', async () => {
    const library = fakeLibrarySource(manyRecords(120))
    const items = await hold(library, () => useLibraryItems({ view: 'tudo' }))
    await items.loadMore()

    const updated = await library.patchItem('item-000', { status: 'arquivo' })
    items.applyItem(updated)

    expect(items.data.value?.items).toHaveLength(100)
    expect(items.data.value?.items[0]).toMatchObject({ id: 'item-000', status: 'arquivo' })
  })
})

describe('useLibraryItems after a write moves a row', () => {
  it('drops a row archived from the inbox, and keeps it on the whole shelf', async () => {
    const records = [libraryRecord({ id: 'a', status: 'inbox' }), libraryRecord({ id: 'b', status: 'inbox' })]
    const inbox = await hold(fakeLibrarySource(records), () => useLibraryItems({ view: 'inbox' }))
    inbox.applyItem({ ...records[0], status: 'arquivo' })
    expect(inbox.data.value?.items.map((item) => item.id)).toEqual(['b'])

    const everything = await hold(fakeLibrarySource(records), () => useLibraryItems({ view: 'tudo' }))
    everything.applyItem({ ...records[0], status: 'arquivo' })
    expect(everything.data.value?.items.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('drops a row marked read while only unread rows are asked for', async () => {
    const records = [libraryRecord({ id: 'a', unread: true }), libraryRecord({ id: 'b', unread: true })]
    const items = await hold(fakeLibrarySource(records), () => useLibraryItems({ view: 'tudo', unread: true }))

    items.applyItem({ ...records[0], unread: false })

    expect(items.data.value?.items.map((item) => item.id)).toEqual(['b'])
  })
})

describe('useLibraryItems when the next page fails', () => {
  it('keeps the loaded rows and reports the failure apart from the list error', async () => {
    const records = manyRecords(120)
    const base = fakeLibrarySource(records)
    const library = fakeLibrarySource(records, {
      listItems: async (query, signal) => {
        if (query.cursor) throw new Error('rede caiu')
        return base.listItems(query, signal)
      }
    })
    const items = await hold(library, () => useLibraryItems({ view: 'tudo' }))

    await items.loadMore()

    expect(items.data.value?.items).toHaveLength(50)
    expect(items.error.value).toBeNull()
    expect(items.loadMoreError.value).toContain('rede caiu')
    expect(items.hasMore.value).toBe(true)
  })
})

describe('useLibraryCounts', () => {
  it('answers with the counts endpoint, over the whole library and not one page', async () => {
    const library = fakeLibrarySource([
      libraryRecord({ id: 'a', status: 'inbox', unread: true }),
      libraryRecord({ id: 'b', status: 'depois', unread: true }),
      libraryRecord({ id: 'c', status: 'arquivo', unread: false, kind: 'livro' })
    ])
    const counts = await hold(library, () => useLibraryCounts())

    expect(counts.data.value?.views).toEqual({ inbox: 1, depois: 1, arquivo: 1, tudo: 3 })
    expect(counts.data.value?.unread).toBe(2)
    expect(counts.data.value?.kinds.livro).toBe(1)
  })

  it('asks the endpoint again after a write instead of adjusting a total by hand', async () => {
    const library = fakeLibrarySource([libraryRecord({ id: 'a', status: 'inbox' })])
    const counts = await hold(library, () => useLibraryCounts())

    expect(library.calls.counts).toBe(1)
    expect(counts.data.value?.views.inbox).toBe(1)

    await library.patchItem('a', { status: 'arquivo' })
    libraryItemChanged()
    await flushReads()

    expect(library.calls.counts).toBe(2)
    expect(counts.data.value?.views).toEqual({ inbox: 0, depois: 0, arquivo: 1, tudo: 1 })
  })
})

describe('useLibraryItem across a change of id', () => {
  it('drops the record it is holding before reading the next one', async () => {
    const library = fakeLibrarySource([
      libraryRecord({ id: 'first', title: 'O primeiro' }),
      libraryRecord({ id: 'second', title: 'O segundo' })
    ])
    const id = ref('first')
    const item = await hold(library, () => useLibraryItem(id))

    expect(item.data.value?.title).toBe('O primeiro')

    id.value = 'second'
    // No flush: the read for the new id is still in flight. A screen rendering
    // `data` right now must not be showing the article the reader just left.
    await Promise.resolve()
    expect(item.data.value).toBeNull()
    expect(item.loading.value).toBe(true)

    await flushReads()
    expect(item.data.value?.title).toBe('O segundo')
  })

  it('answers with null for an id the server does not know', async () => {
    const library = fakeLibrarySource([libraryRecord({ id: 'first' })])
    const item = await hold(library, () => useLibraryItem('missing'))

    expect(item.data.value).toBeNull()
    expect(item.loading.value).toBe(false)
    expect(item.error.value).toBeNull()
  })
})

/** The resource's own surface, named so a rename cannot pass unnoticed. */
describe('the list resource', () => {
  it('exposes exactly what a screen needs to paginate', async () => {
    const library = fakeLibrarySource(manyRecords(3))
    const items: LibraryItemsResource = await hold(library, () => useLibraryItems())

    for (const key of ['data', 'loading', 'error', 'refresh', 'loadingMore', 'loadMoreError', 'hasMore', 'loadMore', 'applyItem']) {
      expect(items, `the list resource has no ${key}`).toHaveProperty(key)
    }
  })
})
