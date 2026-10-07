import { describe, expect, it } from 'vitest'

import { buildMockData } from '@/mock/data'

const mockData = buildMockData('2026-10-03')

import { createSearchIndex, filterSearchIndex, groupSearchResults, type SearchEntry } from './index'

describe('search index', () => {
  it('builds routes and mock items with targets that resolve in the application', () => {
    const index = createSearchIndex(mockData)

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

  it('ranks title matches before metadata matches and caps the result set at nine', () => {
    const index: SearchEntry[] = Array.from({ length: 12 }, (_, index) => ({
      group: 'Biblioteca',
      title: index === 11 ? 'Outro título' : `Leitura ${index + 1}`,
      subtitle: index === 11 ? 'leitura no subtítulo' : 'Material',
      kind: 'artigo',
      keywords: 'aprendizado',
      to: { name: 'biblioteca' }
    }))

    const results = filterSearchIndex(index, 'leitura')

    expect(results).toHaveLength(9)
    expect(results[0].title).toBe('Leitura 1')
    expect(results.every((result) => result.group === 'Biblioteca')).toBe(true)
  })

  it('matches Portuguese accents across the title, subtitle, kind and keywords', () => {
    const index = createSearchIndex(mockData)

    expect(filterSearchIndex(index, 'decisao').some((entry) => entry.kind === 'decisão')).toBe(true)
    expect(filterSearchIndex(index, 'flashcards').some((entry) => entry.title === 'Revisão')).toBe(true)
    expect(filterSearchIndex(index, 'arquivo').some((entry) => entry.title === 'Biblioteca')).toBe(true)
  })

  it('keeps matching results in their product groups', () => {
    const grouped = groupSearchResults(filterSearchIndex(createSearchIndex(mockData), 'horta'))

    expect(grouped.map((group) => group.label)).toEqual(['Estudo', 'Projetos', 'Biblioteca'])
    expect(grouped.flatMap((group) => group.items).every((entry) => ['Biblioteca', 'Estudo', 'Projetos'].includes(entry.group))).toBe(true)
  })
})
