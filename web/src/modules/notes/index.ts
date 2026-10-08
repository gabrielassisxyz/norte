import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarRow } from '../types'
import { useNotesSummary } from './data/composables'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/notas',
    name: 'notas',
    component: () => import('./views/NotesView.vue'),
    meta: { title: 'Notas' }
  }
]

/** The notes lines in the sidebar, counted by the source rather than guessed. */
export function useSidebar(): ModuleSidebar {
  const { data: counts } = useNotesSummary()

  function noteRows(): SidebarRow[] {
    return [
      {
        id: 'anotacoes',
        label: 'Anotações',
        to: { name: 'notas', query: { tab: 'anotacoes' } },
        count: counts.value?.anotacoes ?? 0
      },
      {
        id: 'highlights',
        label: 'Highlights',
        to: { name: 'notas', query: { tab: 'highlights' } },
        count: counts.value?.highlights ?? 0
      },
      {
        id: 'perguntas-notas',
        label: 'Perguntas',
        to: { name: 'notas', query: { tab: 'perguntas' } },
        count: counts.value?.perguntas ?? 0
      }
    ]
  }

  return {
    sections: [
      {
        id: 'notas',
        label: 'Notas',
        to: { name: 'notas' },
        order: 40,
        activeRouteNames: ['notas'],
        rows: noteRows
      },
      {
        // Questions are written while studying, so Estudo gets a way into them.
        id: 'estudo-perguntas',
        label: 'Perguntas',
        to: { name: 'notas', query: { tab: 'perguntas' } },
        order: 45,
        activeRouteNames: [],
        nestUnder: 'study' as const,
        count: () => counts.value?.perguntas ?? 0
      }
    ],
    shortcuts: []
  }
}

export const homeBlocks = []

/** Notes offer their screen and nothing else: a note is found by reading it. */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  return computed<SearchEntry[]>(() => [
    {
      group: 'Estudo',
      title: 'Notas',
      subtitle: 'Highlights, anotações e perguntas',
      kind: 'tela',
      keywords: 'highlights anotacoes perguntas',
      to: { name: 'notas' }
    }
  ])
}

const notesModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default notesModule
