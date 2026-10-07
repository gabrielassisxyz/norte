import type { RouteLocationRaw } from 'vue-router'

import type { NorteModule } from '@/modules/types'
import type { MockData } from '@/mock/types'
import { mountedModules } from '@/shell/composition'

export type SearchGroup = 'Biblioteca' | 'Estudo' | 'Projetos'

export interface SearchEntry {
  group: SearchGroup
  title: string
  subtitle: string
  kind: string
  keywords: string
  to: RouteLocationRaw
}

export interface SearchResult extends SearchEntry {
  score: number
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function matches(value: string, query: string): boolean {
  return normalize(value).includes(query)
}

function score(entry: SearchEntry, query: string): number | null {
  const title = normalize(entry.title)
  if (title.startsWith(query)) return 0
  if (title.includes(query)) return 1
  if (matches(entry.subtitle, query)) return 2
  if (matches(entry.kind, query)) return 3
  if (matches(entry.keywords, query)) return 4
  return null
}

/**
 * The home screen belongs to the shell, so the shell contributes its own entry;
 * every other entry comes from a module, which is what makes a switched-off
 * module unsearchable rather than searchable and broken.
 */
const SHELL_ENTRY: SearchEntry = {
  group: 'Estudo',
  title: 'Início',
  subtitle: 'Hoje, leituras e estudo',
  kind: 'tela',
  keywords: 'home começo',
  to: { name: 'inicio' }
}

export function createSearchIndex(data: MockData, modules: NorteModule[] = mountedModules()): SearchEntry[] {
  return [SHELL_ENTRY, ...modules.flatMap((module) => module.searchEntries(data))]
}

export function filterSearchIndex(index: SearchEntry[], query: string, limit = 9): SearchResult[] {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []

  return index
    .map((entry, position) => ({ entry, position, score: score(entry, normalizedQuery) }))
    .filter((candidate): candidate is { entry: SearchEntry; position: number; score: number } => candidate.score !== null)
    .sort((left, right) => left.score - right.score || left.position - right.position)
    .slice(0, limit)
    .map(({ entry, score: rank }) => ({ ...entry, score: rank }))
}

export function groupSearchResults(results: SearchResult[]): Array<{ label: SearchGroup; items: SearchResult[] }> {
  const groups: Array<{ label: SearchGroup; items: SearchResult[] }> = []
  for (const result of results) {
    const group = groups.find((candidate) => candidate.label === result.group)
    if (group) group.items.push(result)
    else groups.push({ label: result.group, items: [result] })
  }
  return groups
}
