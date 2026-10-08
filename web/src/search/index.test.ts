import { mount } from '@vue/test-utils'
import { defineComponent, h, type ComputedRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { resetModuleMounting } from '@/modules/mounting'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { filterSearchIndex, groupSearchResults, useSearchIndex, type SearchEntry } from './index'

/** The day the mock data is built against; which day it is changes nothing here. */
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

  mount(host, { global: { plugins: [sourcesPlugin(createMockSources(store))] } })
  await flushReads()
  if (!captured) throw new Error('The host component never ran its setup')
  return (captured as ComputedRef<SearchEntry[]>).value
}

describe('search index', () => {
  it('builds routes and records with targets that resolve in the application', async () => {
    const index = await readIndex()

    expect(index.find((entry) => entry.title === 'Biblioteca')?.to).toEqual({ name: 'biblioteca' })
    expect(index.find((entry) => entry.title === 'Mapas de símbolos em compiladores pequenos')?.to).toEqual({
      name: 'material',
      params: { kind: 'post', id: 'post-compilation' }
    })
    expect(index.find((entry) => entry.title === 'Horta da varanda')?.to).toEqual({
      name: 'projeto',
      params: { id: 'project-horta' }
    })
    expect(index.find((entry) => entry.title === 'Definir destinos de cópia')?.to).toEqual({
      name: 'tarefa',
      params: { id: 'task-backup' }
    })
  })

  it('offers nothing but the shell and the module screens before the reads answer', async () => {
    let captured: ComputedRef<SearchEntry[]> | null = null
    const host = defineComponent({
      setup() {
        captured = useSearchIndex()
        return () => h('div')
      }
    })

    mount(host, { global: { plugins: [sourcesPlugin(createMockSources(store))] } })

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
      to: { name: 'biblioteca' }
    }))

    const results = filterSearchIndex(index, 'leitura')

    expect(results).toHaveLength(9)
    expect(results[0].title).toBe('Leitura 1')
    expect(results.every((result) => result.group === 'Biblioteca')).toBe(true)
  })

  it('matches Portuguese accents across the title, subtitle, kind and keywords', async () => {
    const index = await readIndex()

    expect(filterSearchIndex(index, 'decisao').some((entry) => entry.kind === 'decisão')).toBe(true)
    expect(filterSearchIndex(index, 'flashcards').some((entry) => entry.title === 'Revisão')).toBe(true)
    expect(filterSearchIndex(index, 'arquivo').some((entry) => entry.title === 'Biblioteca')).toBe(true)
  })

  it('keeps matching results in their product groups', async () => {
    const grouped = groupSearchResults(filterSearchIndex(await readIndex(), 'horta'))

    expect(grouped.map((group) => group.label)).toEqual(['Estudo', 'Projetos', 'Biblioteca'])
    expect(
      grouped.flatMap((group) => group.items).every((entry) => ['Biblioteca', 'Estudo', 'Projetos'].includes(entry.group))
    ).toBe(true)
  })
})
