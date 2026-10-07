import { store } from '@/mock/store'
import type { MockData } from '@/mock/types'
import type { SearchEntry } from '@/search'

import type { NorteModule, SidebarLink, SidebarRow } from '../types'
import StudyContinueBlock from './home/StudyContinueBlock.vue'
import { manifest } from './manifest'

export { manifest }

function studyRows(): SidebarRow[] {
  // The mock data has no standalone subject entity; each curriculum module
  // reads as one subject on the Estudo home screen.
  const subjectCount = store.curricula.reduce((total, curriculum) => total + curriculum.modules.length, 0)
  return [
    { id: 'curriculos', label: 'Currículos', to: { name: 'estudo' }, count: store.curricula.length },
    { id: 'assuntos', label: 'Assuntos', to: { name: 'estudo', hash: '#assuntos' }, count: subjectCount }
  ]
}

function shortcutEntries(): SidebarLink[] {
  return [{ id: 'atalho-curriculos', label: 'Currículos', to: { name: 'estudo' }, count: store.curricula.length }]
}

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

export const sidebar = {
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

export const homeBlocks = [{ id: 'study-continue', order: 10, region: 'main' as const, component: StudyContinueBlock }]

export function searchEntries(data: MockData): SearchEntry[] {
  return [
    {
      group: 'Estudo',
      title: 'Estudo',
      subtitle: 'Currículos e assuntos',
      kind: 'tela',
      keywords: 'curriculos assuntos aprender',
      to: { name: 'estudo' }
    },
    ...data.curricula.map<SearchEntry>((curriculum) => ({
      group: 'Estudo',
      title: curriculum.title,
      subtitle: curriculum.goal,
      kind: 'currículo',
      keywords: curriculum.modules.map((module) => module.title).join(' '),
      to: { name: 'curriculo', params: { slug: curriculum.slug } }
    }))
  ]
}

const studyModule: NorteModule = { manifest, routes, sidebar, homeBlocks, searchEntries }

export default studyModule
