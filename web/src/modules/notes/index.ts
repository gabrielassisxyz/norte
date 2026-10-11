import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import { registerReaderSlot } from '../library/readerSlots'
import type { ModuleSidebar, NorteModule, SidebarRow } from '../types'
import ReaderBottomActions from './components/ReaderBottomActions.vue'
import ReaderHighlightAction from './components/ReaderHighlightAction.vue'
import ReaderNotesPanel from './components/ReaderNotesPanel.vue'
import ReaderSelectionAction from './components/ReaderSelectionAction.vue'
import { useNotesSummary } from './data/composables'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/notes',
    name: 'notes',
    component: () => import('./views/NotesView.vue'),
    meta: { title: 'Notes' }
  },
  {
    path: '/notes/sets',
    name: 'notes-question-sets',
    component: () => import('./views/QuestionSetsView.vue'),
    meta: { title: 'Question sets' }
  },
  {
    path: '/notes/sets/:id',
    name: 'notes-question-set',
    component: () => import('./views/QuestionSetView.vue'),
    meta: { title: 'Question set' }
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
 *
 * Highlighting and the two ways into the sheet go in `bottom-actions`, which
 * the reader renders in its bottom bar on a phone and under the article on a
 * wide screen. The panel stays in `notes`, which is the sheet's contents on a
 * phone and the same place under the article otherwise -- so the order on a
 * wide screen is what it was when both were one slot.
 */
registerReaderSlot({
  id: 'notes-selection-action',
  name: 'selection-actions',
  order: 10,
  component: ReaderSelectionAction
})
registerReaderSlot({
  id: 'notes-highlight-action',
  name: 'bottom-actions',
  order: 10,
  component: ReaderHighlightAction
})
registerReaderSlot({
  id: 'notes-bottom-actions',
  name: 'bottom-actions',
  order: 20,
  component: ReaderBottomActions
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
        id: 'annotations',
        label: 'Annotations',
        to: { name: 'notes', query: { tab: 'annotations' } },
        count: counts.value?.annotations ?? 0
      },
      {
        id: 'highlights',
        label: 'Highlights',
        to: { name: 'notes', query: { tab: 'highlights' } },
        count: counts.value?.highlights ?? 0
      },
      {
        id: 'notes-questions',
        label: 'Questions',
        to: { name: 'notes', query: { tab: 'questions' } },
        count: counts.value?.questions ?? 0
      },
      {
        id: 'question-sets',
        label: 'Question sets',
        to: { name: 'notes-question-sets' },
        count: counts.value?.question_sets ?? 0
      }
    ]
  }

  return {
    sections: [
      {
        id: 'notes',
        label: 'Notes',
        to: { name: 'notes' },
        order: 40,
        activeRouteNames: ['notes', 'notes-question-sets', 'notes-question-set'],
        rows: noteRows
      },
      {
        // Questions are written while studying, so Study gets a way into them.
        id: 'study-questions',
        label: 'Questions',
        to: { name: 'notes', query: { tab: 'questions' } },
        order: 45,
        activeRouteNames: [],
        nestUnder: 'study' as const,
        count: () => counts.value?.questions ?? 0
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
      title: 'Notes',
      subtitle: 'Highlights, annotations and questions',
      kind: 'tela',
      keywords: 'highlights annotations questions',
      to: { name: 'notes' }
    },
    {
      group: 'Estudo',
      title: 'Question sets',
      subtitle: 'A topic and its six questions',
      kind: 'tela',
      keywords: 'question set questions topic what why who when where how',
      to: { name: 'notes-question-sets' }
    }
  ])
}

const notesModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default notesModule
