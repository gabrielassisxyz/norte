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

describe('the library sidebar shelf rows', () => {
  it('list the shelves in the order the Biblioteca tabs list them', async () => {
    const sidebar = await holdSidebar([])

    const rows = sidebar.sections[0]?.rows?.() ?? []
    const labels = rows.filter((row) => 'id' in row).map((row) => ('label' in row ? row.label : ''))

    expect(labels.slice(0, 4)).toEqual(['Inbox', 'Depois', 'Tudo', 'Arquivo'])
    // The Tipos group follows, unchanged.
    expect(rows[4]).toMatchObject({ head: true, label: 'Tipos' })
  })
})

describe('the library sidebar kind links', () => {
  it('name the whole library, because the counts beside them count every shelf', async () => {
    const sidebar = await holdSidebar([])

    const rows = sidebar.sections[0]?.rows?.() ?? []
    const kindRows = rows.filter((row) => 'id' in row && row.id.startsWith('tipo-'))
    expect(kindRows.length).toBeGreaterThan(0)
    for (const row of kindRows) {
      expect('to' in row && row.to).toMatchObject({ query: { v: 'tudo' } })
    }

  })

  it('opens Artigos on the whole library, where its count comes from', async () => {
    const sidebar = await holdSidebar([
      libraryRecord({ id: 'a', kind: 'post', status: 'inbox' }),
      libraryRecord({ id: 'b', kind: 'post', status: 'arquivo' }),
      libraryRecord({ id: 'c', kind: 'livro', status: 'inbox' })
    ])

    const entries = sidebar.shortcuts[0]?.entries() ?? []
    const artigos = entries.find((entry) => entry.id === 'atalho-artigos')
    expect(artigos).toBeDefined()
    // The label names a kind, so the link reads the whole library filtered to
    // posts — the same set the count counts.
    expect(artigos!.to).toMatchObject({ query: { v: 'tudo', tipo: 'post' } })
    expect(artigos!.count).toBe(2)
  })
})
