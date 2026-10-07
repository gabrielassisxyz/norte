import { store } from '@/mock/store'
import type { MockData } from '@/mock/types'
import type { SearchEntry } from '@/search'

import type { NorteModule } from '../types'
import ReviewDueAction from './home/ReviewDueAction.vue'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/revisao',
    name: 'revisao',
    component: () => import('./views/ReviewView.vue'),
    meta: { title: 'Revisão' }
  }
]

export const sidebar = {
  sections: [
    {
      id: 'revisao',
      label: 'Revisão',
      to: { name: 'revisao' },
      order: 25,
      activeRouteNames: ['revisao'],
      // Revisão is a way into Estudo when Estudo is there, and a product of its
      // own when it is not.
      nestUnder: 'study' as const,
      count: () => store.reviewCards.length
    }
  ],
  shortcuts: []
}

export const homeBlocks = [{ id: 'review-due', order: 20, region: 'actions' as const, component: ReviewDueAction }]

export function searchEntries(_data: MockData): SearchEntry[] {
  return [
    {
      group: 'Estudo',
      title: 'Revisão',
      subtitle: 'Cartões para revisar',
      kind: 'tela',
      keywords: 'flashcards cartões anki',
      to: { name: 'revisao' }
    }
  ]
}

const reviewModule: NorteModule = { manifest, routes, sidebar, homeBlocks, searchEntries }

export default reviewModule
