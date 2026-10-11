import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule } from '../types'
import { useReviewSummary } from './data/composables'
import ReviewDueAction from './home/ReviewDueAction.vue'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/review',
    name: 'review',
    component: () => import('./views/ReviewView.vue'),
    meta: { title: 'Review' }
  }
]

export function useSidebar(): ModuleSidebar {
  const { data: counts } = useReviewSummary()

  return {
    sections: [
      {
        id: 'review',
        label: 'Review',
        to: { name: 'review' },
        order: 25,
        activeRouteNames: ['review'],
        // Review is a way into Study when Study is there, and a product of its
        // own when it is not.
        nestUnder: 'study' as const,
        count: () => counts.value?.cards ?? 0
      }
    ],
    shortcuts: []
  }
}

export const homeBlocks = [{ id: 'review-due', order: 20, region: 'actions' as const, component: ReviewDueAction }]

/** A card is reached through its deck, so the module offers only its screen. */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  return computed<SearchEntry[]>(() => [
    {
      group: 'Study',
      title: 'Review',
      subtitle: 'Cards to review',
      kind: 'tela',
      keywords: 'flashcards cards anki',
      to: { name: 'review' }
    }
  ])
}

const reviewModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default reviewModule
