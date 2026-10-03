import type { RouteLocationRaw } from 'vue-router'

import type { MockData } from '@/mock/types'

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

function materialTarget(kind: string, id: string): RouteLocationRaw {
  if (kind === 'post' || kind === 'livro' || kind === 'paper') {
    return { name: 'material', params: { kind, id } }
  }
  return { name: 'biblioteca', query: { tipo: kind } }
}

export function createSearchIndex(data: MockData): SearchEntry[] {
  const routes: SearchEntry[] = [
    {
      group: 'Estudo',
      title: 'Início',
      subtitle: 'Hoje, leituras e estudo',
      kind: 'tela',
      keywords: 'home começo',
      to: { name: 'inicio' }
    },
    {
      group: 'Biblioteca',
      title: 'Biblioteca',
      subtitle: 'Inbox, depois e arquivo',
      kind: 'tela',
      keywords: 'artigos materiais leituras',
      to: { name: 'biblioteca' }
    },
    {
      group: 'Estudo',
      title: 'Notas',
      subtitle: 'Highlights, anotações e perguntas',
      kind: 'tela',
      keywords: 'highlights anotacoes perguntas',
      to: { name: 'notas' }
    },
    {
      group: 'Estudo',
      title: 'Revisão',
      subtitle: 'Cartões para revisar',
      kind: 'tela',
      keywords: 'flashcards cartões anki',
      to: { name: 'revisao' }
    },
    {
      group: 'Estudo',
      title: 'Estudo',
      subtitle: 'Currículos e assuntos',
      kind: 'tela',
      keywords: 'curriculos assuntos aprender',
      to: { name: 'estudo' }
    },
    {
      group: 'Projetos',
      title: 'Projetos',
      subtitle: 'Áreas, decisões e tarefas',
      kind: 'tela',
      keywords: 'areas decisoes tarefas',
      to: { name: 'projetos' }
    }
  ]

  const library = data.libraryItems.map<SearchEntry>((item) => ({
    group: 'Biblioteca',
    title: item.title,
    subtitle: item.author,
    kind: item.kind,
    keywords: `${item.status} ${item.curriculumSlug ?? ''}`,
    to: materialTarget(item.kind, item.id)
  }))

  const study = data.curricula.map<SearchEntry>((curriculum) => ({
    group: 'Estudo',
    title: curriculum.title,
    subtitle: curriculum.goal,
    kind: 'currículo',
    keywords: curriculum.modules.map((module) => module.title).join(' '),
    to: { name: 'curriculo', params: { slug: curriculum.slug } }
  }))

  const projects: SearchEntry[] = [
    ...data.areas.map((area) => ({
      group: 'Projetos' as const,
      title: area.title,
      subtitle: area.intention,
      kind: 'área',
      keywords: area.archived ? 'arquivada' : 'ativa',
      to: { name: 'area', params: { id: area.id } }
    })),
    ...data.projects.map((project) => ({
      group: 'Projetos' as const,
      title: project.title,
      subtitle: project.purpose,
      kind: 'projeto',
      keywords: `${project.status} ${project.priority}`,
      to: { name: 'projeto', params: { id: project.id } }
    })),
    ...data.decisions.map((decision) => ({
      group: 'Projetos' as const,
      title: decision.title,
      subtitle: decision.context,
      kind: 'decisão',
      keywords: decision.status,
      to: { name: 'decisao', params: { id: decision.id } }
    })),
    ...data.tasks.map((task) => ({
      group: 'Projetos' as const,
      title: task.title,
      subtitle: task.description,
      kind: 'tarefa',
      keywords: `${task.bucket} ${task.priority}`,
      to: { name: 'tarefa', params: { id: task.id } }
    }))
  ]

  return [...routes, ...library, ...study, ...projects]
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
