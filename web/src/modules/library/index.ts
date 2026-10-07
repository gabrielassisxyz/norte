import type { MockData } from '@/mock/types'
import { store } from '@/mock/store'
import type { SearchEntry } from '@/search'
import type { RouteLocationRaw } from 'vue-router'

import { crossModuleActionAllowed } from '../mounting'
import type { NorteModule, SidebarLink, SidebarRow } from '../types'
import LibraryReadingBlock from './home/LibraryReadingBlock.vue'
import LibrarySaveAction from './home/LibrarySaveAction.vue'
import LibrarySavesBlock from './home/LibrarySavesBlock.vue'
import { manifest } from './manifest'

export { manifest }

const KIND_LABELS: Record<string, string> = {
  post: 'Posts',
  livro: 'Livros',
  paper: 'Papers',
  video: 'Vídeos',
  podcast: 'Podcasts',
  curso: 'Cursos'
}

const KIND_ORDER = ['post', 'livro', 'paper', 'video', 'podcast', 'curso']

function countByStatus(status: string): number {
  return store.libraryItems.filter((item) => item.status === status).length
}

function libraryRows(): SidebarRow[] {
  const rows: SidebarRow[] = [
    { id: 'tudo', label: 'Tudo', to: { name: 'biblioteca', query: { v: 'tudo' } }, count: store.libraryItems.length },
    { id: 'inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: countByStatus('inbox') },
    { id: 'depois', label: 'Depois', to: { name: 'biblioteca', query: { v: 'depois' } }, count: countByStatus('depois') },
    { id: 'arquivo', label: 'Arquivo', to: { name: 'biblioteca', query: { v: 'arquivo' } }, count: countByStatus('arquivo') },
    { head: true, label: 'Tipos' }
  ]
  for (const kind of KIND_ORDER) {
    rows.push({
      id: `tipo-${kind}`,
      label: KIND_LABELS[kind],
      to: { name: 'biblioteca', query: { tipo: kind } },
      count: store.libraryItems.filter((item) => item.kind === kind).length
    })
  }

  // A curriculum list is a join into the study module, so it is offered under
  // the same rule as any other cross-module reference.
  if (!crossModuleActionAllowed('library', 'study')) return rows

  rows.push({ head: true, label: 'Listas' })
  for (const curriculum of store.curricula) {
    const count = store.libraryItems.filter((item) => item.curriculumSlug === curriculum.slug).length
    if (count === 0) continue
    rows.push({
      id: `lista-${curriculum.slug}`,
      label: curriculum.title,
      to: { name: 'biblioteca', query: { v: 'tudo' } },
      count,
      trackActive: false
    })
  }
  return rows
}

function shortcutEntries(): SidebarLink[] {
  return [
    { id: 'atalho-inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: countByStatus('inbox') },
    // The prototype links Artigos at the library root; the app filters
    // articles through tipo=artigos (kind post).
    {
      id: 'atalho-artigos',
      label: 'Artigos',
      to: { name: 'biblioteca', query: { tipo: 'artigos' } },
      count: store.libraryItems.filter((item) => item.kind === 'post').length
    },
    // The prototype links Shortlist at the library root (v=tudo); the mock
    // store has no shortlist yet, so it shares the full-library count.
    {
      id: 'atalho-shortlist',
      label: 'Shortlist',
      to: { name: 'biblioteca', query: { v: 'tudo' } },
      count: store.libraryItems.length
    }
  ]
}

function materialTarget(kind: string, id: string): RouteLocationRaw {
  if (kind === 'post' || kind === 'livro' || kind === 'paper') {
    return { name: 'material', params: { kind, id } }
  }
  return { name: 'biblioteca', query: { tipo: kind } }
}

export const routes = [
  {
    path: '/biblioteca',
    name: 'biblioteca',
    component: () => import('./views/LibraryView.vue'),
    meta: { title: 'Biblioteca' }
  },
  {
    path: '/material/:kind/:id',
    name: 'material',
    component: () => import('./views/MaterialView.vue'),
    meta: { title: 'Material', layout: 'bare' as const }
  }
]

export const sidebar = {
  sections: [
    {
      id: 'biblioteca',
      label: 'Biblioteca',
      to: { name: 'biblioteca', query: { v: 'tudo' } },
      order: 10,
      activeRouteNames: ['biblioteca'],
      rows: libraryRows
    }
  ],
  shortcuts: [{ label: 'Biblioteca', order: 10, entries: shortcutEntries }]
}

export const homeBlocks = [
  { id: 'library-save', order: 10, region: 'actions' as const, component: LibrarySaveAction },
  { id: 'library-reading', order: 20, region: 'main' as const, component: LibraryReadingBlock },
  { id: 'library-saves', order: 30, region: 'main' as const, component: LibrarySavesBlock }
]

export function searchEntries(data: MockData): SearchEntry[] {
  return [
    {
      group: 'Biblioteca',
      title: 'Biblioteca',
      subtitle: 'Inbox, depois e arquivo',
      kind: 'tela',
      keywords: 'artigos materiais leituras',
      to: { name: 'biblioteca' }
    },
    ...data.libraryItems.map<SearchEntry>((item) => ({
      group: 'Biblioteca',
      title: item.title,
      subtitle: item.author,
      kind: item.kind,
      keywords: `${item.status} ${item.curriculumSlug ?? ''}`,
      to: materialTarget(item.kind, item.id)
    }))
  ]
}

const libraryModule: NorteModule = { manifest, routes, sidebar, homeBlocks, searchEntries }

export default libraryModule
