import type { Page } from '@/lib/page'
import type { LibraryItem, LibraryKind, LibraryStatus } from '@/mock/types'

/** The filters the library list is read with. Status and unread are applied on the page. */
export interface LibraryListQuery {
  /**
   * A kind to narrow to, or null for every kind. `newsletter` is a kind the
   * screen offers and the library has no items of, and narrowing to it answers
   * with nothing rather than with everything.
   */
  kind?: LibraryKind | 'newsletter' | null
  search?: string
  sort?: 'data' | 'titulo'
}

export interface LibraryCounts {
  inbox: number
  depois: number
  arquivo: number
  tudo: number
  unread: number
}

export type LibraryList = Page<LibraryItem, LibraryCounts>

/** What the sidebar asks for: the counts it prints, without the rows behind them. */
export interface LibrarySummary {
  counts: LibraryCounts
  kinds: Record<LibraryKind, number>
  /**
   * How many items each curriculum holds, by slug. The title belongs to the
   * study module, so only the join this module owns travels here.
   */
  lists: Array<{ slug: string; count: number }>
}

export interface NewSavedLink {
  kind: LibraryKind
  title: string
  author: string
  url: string
  curriculumSlug?: string
}

/**
 * Everything the library screens read and write, as calls that can be slow and
 * can fail. Every mutation answers with the record as the source now holds it,
 * which is the only value a screen is allowed to display afterwards.
 */
export interface LibrarySource {
  listItems(query: LibraryListQuery, signal: AbortSignal): Promise<LibraryList>
  /** Null when there is no such item, which is a "not found" page rather than an error. */
  getItem(id: string, signal: AbortSignal): Promise<LibraryItem | null>
  summary(signal: AbortSignal): Promise<LibrarySummary>
  saveLink(link: NewSavedLink): Promise<LibraryItem>
  setStatus(id: string, status: LibraryStatus): Promise<LibraryItem>
  setUnread(id: string, unread: boolean): Promise<LibraryItem>
  setCurriculum(id: string, curriculumSlug: string): Promise<LibraryItem>
}
