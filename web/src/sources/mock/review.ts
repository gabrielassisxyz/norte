import { todayIsoDate } from '@/lib/clock'
import type { MockStore } from '@/mock/store'
import type { ReviewCounts, ReviewQueuePage, ReviewSource } from '@/modules/review/data/source'

import { answer } from './respond'

export function createMockReviewSource(store: MockStore): ReviewSource {
  function counts(): ReviewCounts {
    const today = todayIsoDate()
    return {
      cards: store.reviewCards.length,
      due: store.reviewCards.filter((card) => card.dueAt <= today).length,
      decks: store.reviewDecks.length
    }
  }

  return {
    listCards(signal: AbortSignal): Promise<ReviewQueuePage> {
      return answer(
        () => ({ items: store.reviewCards, next_cursor: null, counts: counts(), decks: store.reviewDecks }),
        signal
      )
    },

    summary(signal: AbortSignal) {
      return answer(counts, signal)
    },

    rateCard(id, rating) {
      return answer(() => store.rateCard(id, rating))
    }
  }
}
