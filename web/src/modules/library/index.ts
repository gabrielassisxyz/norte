import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarLink, SidebarRow } from '../types'
import { useLibraryCounts, useLibraryItems } from './data/composables'
import type { LibraryKind, LibraryShelf } from './data/source'
import LibraryReadingBlock from './home/LibraryReadingBlock.vue'
import LibrarySaveAction from './home/LibrarySaveAction.vue'
import LibrarySavesBlock from './home/LibrarySavesBlock.vue'
import { manifest } from './manifest'

export { manifest }

const KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Posts',
  livro: 'Livros',
  paper: 'Papers',
  video: 'Vídeos',
  podcast: 'Podcasts',
  newsletter: 'Newsletters',
  curso: 'Cursos'
}

const KIND_ORDER: LibraryKind[] = ['post', 'livro', 'paper', 'video', 'podcast', 'newsletter', 'curso']

/**
 * The library's lines in the sidebar, counted by `/api/library/counts`.
 *
 * Before the first answer every count is zero, which is the sidebar's loading
 * state: a row that printed a stale count would be worse than a row that
 * prints none. The counts come from the endpoint and never from the rows a
 * screen happens to be holding — those are one page of one filter.
 */
export function useSidebar(): ModuleSidebar {
  const { data: counts } = useLibraryCounts()

  function viewCount(view: LibraryShelf): number {
    return counts.value?.views[view] ?? 0
  }

  function kindCount(kind: LibraryKind): number {
    return counts.value?.kinds[kind] ?? 0
  }

  function libraryRows(): SidebarRow[] {
    const rows: SidebarRow[] = [
      { id: 'tudo', label: 'Tudo', to: { name: 'biblioteca', query: { v: 'tudo' } }, count: viewCount('tudo') },
      { id: 'inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: viewCount('inbox') },
      { id: 'depois', label: 'Depois', to: { name: 'biblioteca', query: { v: 'depois' } }, count: viewCount('depois') },
      { id: 'arquivo', label: 'Arquivo', to: { name: 'biblioteca', query: { v: 'arquivo' } }, count: viewCount('arquivo') },
      { head: true, label: 'Tipos' }
    ]
    for (const kind of KIND_ORDER) {
      rows.push({
        id: `tipo-${kind}`,
        label: KIND_LABELS[kind],
        to: { name: 'biblioteca', query: { v: 'tudo', tipo: kind } },
        count: kindCount(kind)
      })
    }
    return rows
  }

  function shortcutEntries(): SidebarLink[] {
    return [
      { id: 'atalho-inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: viewCount('inbox') },
      // The prototype links Artigos at the library root; the app filters
      // articles through tipo=artigos (kind post).
      {
        id: 'atalho-artigos',
        label: 'Artigos',
        to: { name: 'biblioteca', query: { tipo: 'artigos' } },
        count: kindCount('post')
      },
      // The prototype links Shortlist at the library root (v=tudo); the library
      // has no shortlist yet, so it shares the full-library count.
      {
        id: 'atalho-shortlist',
        label: 'Shortlist',
        to: { name: 'biblioteca', query: { v: 'tudo' } },
        count: viewCount('tudo')
      }
    ]
  }

  return {
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
}

export const routes = [
  {
    path: '/biblioteca',
    name: 'biblioteca',
    component: () => import('./views/LibraryView.vue'),
    meta: { title: 'Biblioteca' }
  },
  {
    path: '/biblioteca/:id',
    name: 'leitor',
    component: () => import('./views/ReaderView.vue'),
    meta: { title: 'Leitor', layout: 'bare' as const }
  },
  {
    path: '/material/:kind/:id',
    name: 'material',
    component: () => import('./views/MaterialView.vue'),
    meta: { title: 'Material', layout: 'bare' as const }
  }
]

export const homeBlocks = [
  { id: 'library-save', order: 10, region: 'actions' as const, component: LibrarySaveAction },
  { id: 'library-reading', order: 20, region: 'main' as const, component: LibraryReadingBlock },
  { id: 'library-saves', order: 30, region: 'main' as const, component: LibrarySavesBlock }
]

const SCREEN_ENTRY: SearchEntry = {
  group: 'Biblioteca',
  title: 'Biblioteca',
  subtitle: 'Inbox, depois e arquivo',
  kind: 'tela',
  keywords: 'artigos materiais leituras',
  to: { name: 'biblioteca' }
}

/**
 * The library's screen, plus the items the palette can offer without a search
 * of its own: the first page of the whole shelf, newest first.
 */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  const { data: page } = useLibraryItems({ view: 'tudo' })
  return computed(() => [
    SCREEN_ENTRY,
    ...(page.value?.items ?? []).map<SearchEntry>((item) => ({
      group: 'Biblioteca',
      title: item.title,
      subtitle: item.author ?? item.site ?? '',
      kind: item.kind,
      keywords: `${item.status} ${item.why ?? ''}`,
      to: { name: 'leitor', params: { id: item.id } }
    }))
  ])
}

const libraryModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default libraryModule
