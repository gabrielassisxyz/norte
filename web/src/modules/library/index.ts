import { computed, type ComputedRef } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import type { LibraryKind } from '@/mock/types'
import type { SearchEntry } from '@/search'
import { useStudySummary } from '@/modules/study/data/composables'

import { crossModuleActionAllowed } from '../mounting'
import type { ModuleSidebar, NorteModule, SidebarLink, SidebarRow } from '../types'
import { useLibraryItems, useLibrarySummary } from './data/composables'
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

const KIND_ORDER: LibraryKind[] = ['post', 'livro', 'paper', 'video', 'podcast', 'curso']

/**
 * The library's lines in the sidebar, counted by the source.
 *
 * Before the first answer every count is zero and the curriculum lists are
 * absent, which is the sidebar's loading state: a row that printed a stale
 * count would be worse than a row that prints none.
 */
export function useSidebar(): ModuleSidebar {
  const { data: summary } = useLibrarySummary()

  // A curriculum list is a join into the study module, so it is read under the
  // same rule as any other cross-module reference.
  const canListCurricula = computed(() => crossModuleActionAllowed('library', 'study'))
  const { data: studySummary } = useStudySummary(canListCurricula)

  function statusCount(status: 'inbox' | 'depois' | 'arquivo' | 'tudo'): number {
    return summary.value?.counts[status] ?? 0
  }

  function kindCount(kind: LibraryKind): number {
    return summary.value?.kinds[kind] ?? 0
  }

  function libraryRows(): SidebarRow[] {
    const rows: SidebarRow[] = [
      { id: 'tudo', label: 'Tudo', to: { name: 'biblioteca', query: { v: 'tudo' } }, count: statusCount('tudo') },
      { id: 'inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: statusCount('inbox') },
      { id: 'depois', label: 'Depois', to: { name: 'biblioteca', query: { v: 'depois' } }, count: statusCount('depois') },
      { id: 'arquivo', label: 'Arquivo', to: { name: 'biblioteca', query: { v: 'arquivo' } }, count: statusCount('arquivo') },
      { head: true, label: 'Tipos' }
    ]
    for (const kind of KIND_ORDER) {
      rows.push({
        id: `tipo-${kind}`,
        label: KIND_LABELS[kind],
        to: { name: 'biblioteca', query: { tipo: kind } },
        count: kindCount(kind)
      })
    }

    if (!canListCurricula.value) return rows

    // The count is the library's; the title belongs to the study module, so a
    // list appears only once both answers are in.
    const titles = new Map((studySummary.value?.curricula ?? []).map((curriculum) => [curriculum.slug, curriculum.title]))
    const lists = (summary.value?.lists ?? []).filter((list) => list.count > 0 && titles.has(list.slug))
    if (lists.length === 0) return rows

    rows.push({ head: true, label: 'Listas' })
    for (const list of lists) {
      rows.push({
        id: `lista-${list.slug}`,
        label: titles.get(list.slug) as string,
        to: { name: 'biblioteca', query: { v: 'tudo' } },
        count: list.count,
        trackActive: false
      })
    }
    return rows
  }

  function shortcutEntries(): SidebarLink[] {
    return [
      { id: 'atalho-inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: statusCount('inbox') },
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
        count: statusCount('tudo')
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

/** The library's screen, plus every item it holds, as the palette offers them. */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  const { data: page } = useLibraryItems()
  return computed(() => [
    SCREEN_ENTRY,
    ...(page.value?.items ?? []).map<SearchEntry>((item) => ({
      group: 'Biblioteca',
      title: item.title,
      subtitle: item.author,
      kind: item.kind,
      keywords: `${item.status} ${item.curriculumSlug ?? ''}`,
      to: materialTarget(item.kind, item.id)
    }))
  ])
}

const libraryModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default libraryModule
