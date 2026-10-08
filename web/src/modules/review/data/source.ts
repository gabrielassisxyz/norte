import type { Page } from '@/lib/page'
import type { CardRating, ReviewCard, ReviewDeck } from '@/mock/types'

export interface ReviewCounts {
  cards: number
  /** Cards due on or before the day the read was made. */
  due: number
  decks: number
}

/**
 * The review queue: every card the decks hold, with the decks themselves. The
 * screen needs both totals and due cards per deck, so it reads the cards and
 * does its own arithmetic rather than asking once per deck.
 */
export interface ReviewQueuePage extends Page<ReviewCard, ReviewCounts> {
  decks: ReviewDeck[]
}

export interface ReviewSource {
  listCards(signal: AbortSignal): Promise<ReviewQueuePage>
  summary(signal: AbortSignal): Promise<ReviewCounts>
  rateCard(id: string, rating: CardRating): Promise<ReviewCard>
}
