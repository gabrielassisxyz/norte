import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import { flushReads, sourcesPlugin } from '@/sources/testing'

import { useSidebar } from './index'
import { fakeLibrarySource } from './data/testing'

describe('the library sidebar kind links', () => {
  it('name the whole library, because the counts beside them count every shelf', async () => {
    let sidebar: ReturnType<typeof useSidebar> | null = null
    const host = defineComponent({
      setup() {
        sidebar = useSidebar()
        return () => h('div')
      }
    })
    mount(host, { global: { plugins: [sourcesPlugin({ library: fakeLibrarySource([]) })] } })
    await flushReads()

    const rows = sidebar!.sections[0].rows()
    const kindRows = rows.filter((row) => 'id' in row && row.id.startsWith('tipo-'))
    expect(kindRows.length).toBeGreaterThan(0)
    for (const row of kindRows) {
      expect('to' in row && row.to).toMatchObject({ query: { v: 'tudo' } })
    }

  })
})
