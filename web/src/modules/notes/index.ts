import { store } from '@/mock/store'
import type { MockData } from '@/mock/types'
import type { SearchEntry } from '@/search'

import type { NorteModule, SidebarRow } from '../types'
import { manifest } from './manifest'

export { manifest }

function noteRows(): SidebarRow[] {
  return [
    { id: 'anotacoes', label: 'Anotações', to: { name: 'notas', query: { tab: 'anotacoes' } }, count: store.annotations.length },
    { id: 'highlights', label: 'Highlights', to: { name: 'notas', query: { tab: 'highlights' } }, count: store.highlights.length },
    { id: 'perguntas-notas', label: 'Perguntas', to: { name: 'notas', query: { tab: 'perguntas' } }, count: store.questions.length }
  ]
}

export const routes = [
  {
    path: '/notas',
    name: 'notas',
    component: () => import('./views/NotesView.vue'),
    meta: { title: 'Notas' }
  }
]

export const sidebar = {
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
      count: () => store.questions.length
    }
  ],
  shortcuts: []
}

export const homeBlocks = []

export function searchEntries(_data: MockData): SearchEntry[] {
  return [
    {
      group: 'Estudo',
      title: 'Notas',
      subtitle: 'Highlights, anotações e perguntas',
      kind: 'tela',
      keywords: 'highlights anotacoes perguntas',
      to: { name: 'notas' }
    }
  ]
}

const notesModule: NorteModule = { manifest, routes, sidebar, homeBlocks, searchEntries }

export default notesModule
