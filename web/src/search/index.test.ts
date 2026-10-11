import { mount } from '@vue/test-utils'
import { defineComponent, h, type ComputedRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { filterSearchIndex, groupSearchResults, useSearchIndex, type SearchEntry } from './index'

/** The day the mock data is built against; which day it is changes nothing here. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
  // The library is `api`-backed, so it contributes to the index only while the
  // server says the module is there.
  setEnabledModules(['library'])
})

afterEach(() => {
  vi.useRealTimers()
  resetModuleMounting()
})

/**
 * The index as a mounted component sees it.
 *
 * `useSearchIndex` is a composable over every mounted module's own read, so the
 * only way to hold its value is to be a component with the sources provided —
 * which is also the only way the application ever holds it.
 */
async function readIndex(): Promise<SearchEntry[]> {
  let captured: ComputedRef<SearchEntry[]> | null = null
  const host = defineComponent({
    setup() {
      captured = useSearchIndex()
      return () => h('div')
    }
  })

  mount(host, { global: { plugins: [sourcesPlugin(appSourcesWithLibrary({ store }))] } })
  await flushReads()
  if (!captured) throw new Error('The host component never ran its setup')
  return (captured as ComputedRef<SearchEntry[]>).value
}

describe('search index', () => {
  it('builds routes and records with targets that resolve in the application', async () => {
    const index = await readIndex()

    expect(index.find((entry) => entry.title === 'Library')?.to).toEqual({ name: 'library' })
    expect(index.find((entry) => entry.title === 'Balcony garden')?.to).toEqual({
      name: 'project',
      params: { id: 'project-horta' }
    })
    expect(index.find((entry) => entry.title === 'Decide backup destinations')?.to).toEqual({
      name: 'task',
      params: { id: 'task-backup' }
    })
  })

  it('offers no saved item of its own, because the server searches those', async () => {
    const index = await readIndex()

    // An `api`-backed module contributes its screens here and nothing else:
    // its rows are found through GET /api/core/search, over everything saved
    // rather than over the first page the shell happened to have read.
    const fromLibrary = index.filter((entry) => entry.group === 'Biblioteca')
    expect(fromLibrary.map((entry) => entry.title)).toEqual(['Library'])
    expect(index.find((entry) => entry.title === 'Um texto guardado')).toBeUndefined()
  })

  it('offers nothing but the shell and the module screens before the reads answer', async () => {
    let captured: ComputedRef<SearchEntry[]> | null = null
    const host = defineComponent({
      setup() {
        captured = useSearchIndex()
        return () => h('div')
      }
    })

    mount(host, { global: { plugins: [sourcesPlugin(appSourcesWithLibrary({ store }))] } })

    // No flush: every module's read is still in flight.
    const index = (captured as unknown as ComputedRef<SearchEntry[]>).value
    expect(index.every((entry) => entry.kind === 'tela')).toBe(true)
    expect(index.map((entry) => entry.title)).toContain('Início')
  })

  it('ranks title matches before metadata matches and caps the result set at nine', () => {
    const index: SearchEntry[] = Array.from({ length: 12 }, (_, position) => ({
      group: 'Biblioteca',
      title: position === 11 ? 'Outro título' : `Leitura ${position + 1}`,
      subtitle: position === 11 ? 'leitura no subtítulo' : 'Material',
      kind: 'artigo',
      keywords: 'aprendizado',
      to: { name: 'library' }
    }))

    const results = filterSearchIndex(index, 'leitura')

    expect(results).toHaveLength(9)
    expect(results[0].title).toBe('Leitura 1')
    expect(results.every((result) => result.group === 'Biblioteca')).toBe(true)
  })

  it('matches accents across the title, subtitle, kind and keywords', async () => {
    const index = await readIndex()

    expect(filterSearchIndex(index, 'decision').some((entry) => entry.kind === 'decision')).toBe(true)
    expect(filterSearchIndex(index, 'flashcards').some((entry) => entry.title === 'Revisão')).toBe(true)
    expect(filterSearchIndex(index, 'archive').some((entry) => entry.title === 'Library')).toBe(true)
    expect(filterSearchIndex(index, 'materials').some((entry) => entry.title === 'Library')).toBe(true)
  })

  it('keeps matching results in their product groups', async () => {
    const grouped = groupSearchResults(filterSearchIndex(await readIndex(), 'garden'))

    expect(grouped.map((group) => group.label)).toEqual(['Projects'])
    expect(
      grouped.flatMap((group) => group.items).every((entry) => ['Biblioteca', 'Estudo', 'Projects'].includes(entry.group))
    ).toBe(true)
  })
})
