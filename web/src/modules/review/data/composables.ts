import { toValue, type MaybeRefOrGetter } from 'vue'

import { useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import { todayIsoDate } from '@/lib/clock'
import type { ReviewCard } from '@/mock/types'
import { useSources } from '@/sources'

import type { ReviewCounts, ReviewQueuePage } from './source'

export interface ReviewQueueResource extends AsyncResource<ReviewQueuePage> {
  /** Put a rated card back into the queue, with the due date it came back with. */
  applyCard: (card: ReviewCard) => void
}

export function useReviewQueue(): ReviewQueueResource {
  const { review } = useSources()
  const resource = useAsyncResource((signal) => review.listCards(signal))

  function applyCard(card: ReviewCard): void {
    const page = resource.data.value
    if (!page) return
    const items = page.items.map((existing) => (existing.id === card.id ? card : existing))
    const today = todayIsoDate()
    resource.data.value = {
      ...page,
      items,
      counts: { ...page.counts, due: items.filter((candidate) => candidate.dueAt <= today).length }
    }
  }

  return { ...resource, applyCard }
}

export function useReviewSummary(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<ReviewCounts> {
  const { review } = useSources()
  return useAsyncResource((signal) => review.summary(signal), { immediate: toValue(enabled) })
}
