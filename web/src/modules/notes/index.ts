import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import { registerReaderSlot } from '../library/readerSlots'
import type { ModuleSidebar, NorteModule, SidebarRow } from '../types'
import ReaderHighlightAction from './components/ReaderHighlightAction.vue'
import ReaderNotesPanel from './components/ReaderNotesPanel.vue'
import ReaderSelectionAction from './components/ReaderSelectionAction.vue'
import { useNotesSummary } from './data/composables'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/notas',
    name: 'notas',
    component: () => import('./views/NotesView.vue'),
    meta: { title: 'Notas' }
  },
  {
    path: '/notas/conjuntos',
    name: 'notas-conjuntos',
    component: () => import('./views/QuestionSetsView.vue'),
    meta: { title: 'Conjuntos de perguntas' }
  },
  {
    path: '/notas/conjuntos/:id',
    name: 'notas-conjunto',
    component: () => import('./views/QuestionSetView.vue'),
    meta: { title: 'Conjunto de perguntas' }
  }
]

/**
 * What this module renders inside the library's reader.
 *
 * The reader's actions are notes UI, not library UI: the library exposes the
 * slots and never names what fills them, so a server that does not list `notes`
 * leaves the reader with its own text and nothing else. The components
 * themselves check the crossing, because the shell imports every module's
 * `index.ts` to build its route table whether that module is mounted or not.
 */
registerReaderSlot({
  id: 'notes-selection-action',
  name: 'selection-actions',
  order: 10,
  component: ReaderSelectionAction
})
registerReaderSlot({
  id: 'notes-highlight-action',
  name: 'notes',
  order: 10,
  component: ReaderHighlightAction
})
registerReaderSlot({
  id: 'notes-panel',
  name: 'notes',
  order: 20,
  component: ReaderNotesPanel
})

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
      },
      {
        id: 'conjuntos',
        label: 'Conjuntos',
        to: { name: 'notas-conjuntos' },
        count: counts.value?.conjuntos ?? 0
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
        activeRouteNames: ['notas', 'notas-conjuntos', 'notas-conjunto'],
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

/** Notes offer their screens and nothing else: a note is found by reading it. */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  return computed<SearchEntry[]>(() => [
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
      title: 'Conjuntos de perguntas',
      subtitle: 'Um tema e as seis perguntas',
      kind: 'tela',
      keywords: 'conjunto perguntas tema o que por que quem quando onde como',
      to: { name: 'notas-conjuntos' }
    }
  ])
}

const notesModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default notesModule
