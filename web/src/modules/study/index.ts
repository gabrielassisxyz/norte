import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarLink, SidebarRow } from '../types'
import { useStudyHome, useStudySummary } from './data/composables'
import StudyContinueBlock from './home/StudyContinueBlock.vue'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/estudo',
    name: 'estudo',
    component: () => import('./views/StudyHomeView.vue'),
    meta: { title: 'Estudo' }
  },
  {
    path: '/curriculos/:slug',
    name: 'curriculo',
    component: () => import('./views/CurriculumView.vue'),
    meta: { title: 'Currículo' }
  }
]

export function useSidebar(): ModuleSidebar {
  const { data: summary } = useStudySummary()

  function studyRows(): SidebarRow[] {
    return [
      { id: 'curriculos', label: 'Currículos', to: { name: 'estudo' }, count: summary.value?.counts.curricula ?? 0 }
      // Assuntos is no longer a row here. Subjects are the core's and have
      // their own pages, so the shell lists them as a top-level section; a
      // second entry under Estudo would point at a screen that only shows the
      // ones this module happens to be holding.
    ]
  }

  function shortcutEntries(): SidebarLink[] {
    return [
      {
        id: 'atalho-curriculos',
        label: 'Currículos',
        to: { name: 'estudo' },
        count: summary.value?.counts.curricula ?? 0
      }
    ]
  }

  return {
    sections: [
      {
        id: 'estudo',
        label: 'Estudo',
        to: { name: 'estudo' },
        order: 20,
        activeRouteNames: ['estudo', 'curriculo'],
        rows: studyRows
      }
    ],
    shortcuts: [{ label: 'Estudo', order: 20, entries: shortcutEntries }]
  }
}

export const homeBlocks = [{ id: 'study-continue', order: 10, region: 'main' as const, component: StudyContinueBlock }]

const SCREEN_ENTRY: SearchEntry = {
  group: 'Estudo',
  title: 'Estudo',
  subtitle: 'Currículos e assuntos',
  kind: 'tela',
  keywords: 'curriculos assuntos aprender',
  to: { name: 'estudo' }
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
      group: 'Estudo',
      title: curriculum.title,
      subtitle: curriculum.goal,
      kind: 'currículo',
      keywords: curriculum.modules.map((module) => module.title).join(' '),
      to: { name: 'curriculo', params: { slug: curriculum.slug } }
    }))
  ])
}

const studyModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default studyModule
