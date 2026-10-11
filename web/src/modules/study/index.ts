import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarLink, SidebarRow } from '../types'
import { useStudyHome, useStudySummary } from './data/composables'
import StudyContinueBlock from './home/StudyContinueBlock.vue'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/study',
    name: 'study',
    component: () => import('./views/StudyHomeView.vue'),
    meta: { title: 'Study' }
  },
  {
    path: '/curricula/:slug',
    name: 'curriculum',
    component: () => import('./views/CurriculumView.vue'),
    meta: { title: 'Curriculum' }
  }
]

export function useSidebar(): ModuleSidebar {
  const { data: summary } = useStudySummary()

  function studyRows(): SidebarRow[] {
    return [
      { id: 'curricula', label: 'Curricula', to: { name: 'study' }, count: summary.value?.counts.curricula ?? 0 }
      // Subjects are no longer a row here. They are the core's and have
      // their own pages, so the shell lists them as a top-level section; a
      // second entry under Study would point at a screen that only shows the
      // ones this module happens to be holding.
    ]
  }

  function shortcutEntries(): SidebarLink[] {
    return [
      {
        id: 'shortcut-curricula',
        label: 'Curricula',
        to: { name: 'study' },
        count: summary.value?.counts.curricula ?? 0
      }
    ]
  }

  return {
    sections: [
      {
        id: 'study',
        label: 'Study',
        to: { name: 'study' },
        order: 20,
        activeRouteNames: ['study', 'curriculum'],
        rows: studyRows
      }
    ],
    shortcuts: [{ label: 'Study', order: 20, entries: shortcutEntries }]
  }
}

export const homeBlocks = [{ id: 'study-continue', order: 10, region: 'main' as const, component: StudyContinueBlock }]

const SCREEN_ENTRY: SearchEntry = {
  group: 'Study',
  title: 'Study',
  subtitle: 'Curricula and subjects',
  kind: 'tela',
  keywords: 'curricula subjects learn',
  to: { name: 'study' }
}

/**
 * The study screen plus every curriculum. The home read is what carries the
 * goal and the module titles a palette entry is searched by, so the palette
 * reads it rather than the slimmer summary the sidebar uses.
 */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  const { data: page } = useStudyHome()
  return computed(() => [
    SCREEN_ENTRY,
    ...(page.value?.items ?? []).map<SearchEntry>((curriculum) => ({
      group: 'Study',
      title: curriculum.title,
      subtitle: curriculum.goal,
      kind: 'curriculum',
      keywords: curriculum.modules.map((module) => module.title).join(' '),
      to: { name: 'curriculum', params: { slug: curriculum.slug } }
    }))
  ])
}

const studyModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default studyModule
