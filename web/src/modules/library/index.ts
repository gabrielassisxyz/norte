import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarLink, SidebarRow } from '../types'
import { useLibraryCounts } from './data/composables'
import type { LibraryKind, LibraryLocationName } from './data/source'
import LibraryReadingBlock from './home/LibraryReadingBlock.vue'
import LibrarySaveAction from './home/LibrarySaveAction.vue'
import LibrarySavesBlock from './home/LibrarySavesBlock.vue'
import { manifest } from './manifest'

export { manifest }

const KIND_LABELS: Record<LibraryKind, string> = {
  article: 'Posts',
  book: 'Books',
  paper: 'Papers',
  video: 'Videos',
  podcast: 'Podcasts',
  newsletter: 'Newsletters',
  course: 'Courses'
}

const KIND_ORDER: LibraryKind[] = ['article', 'book', 'paper', 'video', 'podcast', 'newsletter', 'course']

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

  function viewCount(view: LibraryLocationName): number {
    return counts.value?.views[view] ?? 0
  }

  function kindCount(kind: LibraryKind): number {
    return counts.value?.kinds[kind] ?? 0
  }

  function libraryRows(): SidebarRow[] {
    // The reading order of a saved link -- arrived, chosen, put off, done,
    // kept -- with the view over all five last. The library's own tabs list
    // the same six in the same order, because the two lists disagreeing is
    // what made the same place move depending on where it was read.
    const rows: SidebarRow[] = [
      { id: 'inbox', label: 'Inbox', to: { name: 'library', query: { v: 'inbox' } }, count: viewCount('inbox') },
      { id: 'up_next', label: 'Up Next', to: { name: 'library', query: { v: 'up_next' } }, count: viewCount('up_next') },
      { id: 'later', label: 'Later', to: { name: 'library', query: { v: 'later' } }, count: viewCount('later') },
      { id: 'archive', label: 'Archive', to: { name: 'library', query: { v: 'archive' } }, count: viewCount('archive') },
      { id: 'stash', label: 'Stash', to: { name: 'library', query: { v: 'stash' } }, count: viewCount('stash') },
      { id: 'all', label: 'All', to: { name: 'library', query: { v: 'all' } }, count: viewCount('all') },
      { head: true, label: 'Kinds' }
    ]
    for (const kind of KIND_ORDER) {
      rows.push({
        id: `kind-${kind}`,
        label: KIND_LABELS[kind],
        to: { name: 'library', query: { v: 'all', kind } },
        count: kindCount(kind)
      })
    }
    return rows
  }

  function shortcutEntries(): SidebarLink[] {
    return [
      { id: 'shortcut-inbox', label: 'Inbox', to: { name: 'library', query: { v: 'inbox' } }, count: viewCount('inbox') },
      // The prototype links Articles at the library root; the label names a
      // kind, so it opens the whole library filtered to articles.
      {
        id: 'shortcut-articles',
        label: 'Articles',
        to: { name: 'library', query: { v: 'all', kind: 'article' } },
        count: kindCount('article')
      }
      // The prototype's third shortcut was Shortlist, pointing at the whole
      // library and borrowing its count. Up Next is the location it was
      // standing in for, and it is a sidebar row of its own, so the shortcut
      // is gone rather than relabelled.
    ]
  }

  return {
    sections: [
      {
        id: 'library',
        label: 'Library',
        to: { name: 'library', query: { v: 'all' } },
        order: 10,
        activeRouteNames: ['library'],
        rows: libraryRows
      }
    ],
    shortcuts: [{ label: 'Library', order: 10, entries: shortcutEntries }]
  }
}

export const routes = [
  {
    path: '/library',
    name: 'library',
    component: () => import('./views/LibraryView.vue'),
    meta: { title: 'Library' }
  },
  {
    path: '/library/:id',
    name: 'reader',
    component: () => import('./views/ReaderView.vue'),
    meta: { title: 'Reader', layout: 'bare' as const }
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
  group: 'Library',
  title: 'Library',
  subtitle: 'Inbox, Up Next, Later, Archive and Stash',
  kind: 'tela',
  keywords: 'articles materials reading',
  to: { name: 'library' }
}

/**
 * The library's screen, and only its screen.
 *
 * The items used to be here too -- the first page of the whole shelf, offered
 * to the palette as a stand-in for a search the server could not answer yet.
 * GET /api/core/search answers it now, over every saved item rather than the
 * fifty most recent, so keeping them here would offer the same thing twice
 * and offer a stale copy of it, on a read the shell paid for whether anyone
 * opened the palette or not.
 */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  return computed(() => [SCREEN_ENTRY])
}

const libraryModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default libraryModule
