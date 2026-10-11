import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import { flushReads, sourcesPlugin } from '@/sources/testing'

import { useSidebar } from './index'
import type { LibraryItemRecord } from './data/source'
import { fakeLibrarySource, libraryRecord } from './data/testing'

async function holdSidebar(records: LibraryItemRecord[]) {
  let captured: unknown = null
  const host = defineComponent({
    setup() {
      captured = useSidebar()
      return () => h('div')
    }
  })
  mount(host, { global: { plugins: [sourcesPlugin({ library: fakeLibrarySource(records) })] } })
  await flushReads()
  if (captured === null) throw new Error('the host component never ran its setup')
  return captured as ReturnType<typeof useSidebar>
}

describe('the library sidebar location rows', () => {
  it('list the locations in the order the library tabs list them', async () => {
    const sidebar = await holdSidebar([])

    const rows = sidebar.sections[0]?.rows?.() ?? []
    const idRows = rows.filter((row) => 'id' in row)
    const labels = idRows.map((row) => ('label' in row ? row.label : ''))

    expect(labels.slice(0, 6)).toEqual(['Inbox', 'Próximos', 'Depois', 'Arquivo', 'Reserva', 'Tudo'])
    expect(idRows.slice(0, 6).map((row) => ('id' in row ? row.id : ''))).toEqual([
      'inbox',
      'up_next',
      'later',
      'archive',
      'stash',
      'all'
    ])
    // The Tipos group follows, unchanged.
    expect(rows[6]).toMatchObject({ head: true, label: 'Tipos' })
  })
})

describe('the library sidebar kind links', () => {
  it('name the whole library, because the counts beside them count every shelf', async () => {
    const sidebar = await holdSidebar([])

    const rows = sidebar.sections[0]?.rows?.() ?? []
    const kindRows = rows.filter((row) => 'id' in row && row.id.startsWith('kind-'))
    expect(kindRows.length).toBeGreaterThan(0)
    for (const row of kindRows) {
      expect('to' in row && row.to).toMatchObject({ query: { v: 'all' } })
    }

  })

  it('opens Artigos on the whole library, where its count comes from', async () => {
    const sidebar = await holdSidebar([
      libraryRecord({ id: 'a', kind: 'article', location: 'inbox' }),
      libraryRecord({ id: 'b', kind: 'article', location: 'archive' }),
      libraryRecord({ id: 'c', kind: 'book', location: 'inbox' })
    ])

    const entries = sidebar.shortcuts[0]?.entries() ?? []
    const artigos = entries.find((entry) => entry.id === 'atalho-artigos')
    expect(artigos).toBeDefined()
    // The label names a kind, so the link reads the whole library filtered to
    // posts — the same set the count counts.
    expect(artigos!.to).toMatchObject({ query: { v: 'all', kind: 'article' } })
    expect(artigos!.count).toBe(2)
  })
})
