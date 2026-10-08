import type { components } from '@/api/library'

/**
 * The library's records, as the contract defines them.
 *
 * Nothing here is renamed on the way in. A field called `saved_at` on the wire
 * stays `saved_at` in the screens, because a view that reads `savedAt` is a
 * view that cannot be checked against `api/openapi/library.yaml` by eye — and
 * the rename has to be undone the first time the contract gains a field.
 */
export type LibraryKind = components['schemas']['ItemKind']
export type LibraryStatus = components['schemas']['ItemStatus']
export type LibraryViewName = components['schemas']['LibraryView']
/**
 * The shelves an item can sit on, which is every view except `now`.
 *
 * `now` is a value of the same parameter but not a shelf: it reads every
 * status, nothing is counted under it, and no sidebar row addresses it. The
 * distinction is a type rather than a comment so that a map keyed by shelf —
 * the labels, the counts — cannot silently acquire an entry for it.
 */
export type LibraryShelf = Exclude<LibraryViewName, 'now'>
export type LibrarySort = components['schemas']['LibrarySort']
export type ExtractStatus = components['schemas']['ExtractStatus']
export type TextSelection = components['schemas']['TextSelection']
export type ReadPosition = components['schemas']['ReadPosition']
export type LibraryItemSummary = components['schemas']['LibraryItemSummary']
export type LibraryItemRecord = components['schemas']['LibraryItem']
export type LibraryCounts = components['schemas']['LibraryCounts']
export type LibraryDraw = components['schemas']['LibraryDraw']
export type LibraryPatch = components['schemas']['PatchItemRequest']
export type ExtractAck = components['schemas']['ExtractItemResponse']

/**
 * The filters a list is read with — every one of them a query parameter.
 *
 * The shelf and the unread flag are the server's business, not the page's: a
 * page that filtered the rows it already held would show the first page of
 * `tudo` narrowed down, and call that the inbox.
 */
export interface LibraryListQuery {
  view?: LibraryViewName
  /** A kind to narrow to, or null for every kind. */
  tipo?: LibraryKind | null
  /** True for unread only, false for read only, null for both. */
  unread?: boolean | null
  sort?: LibrarySort
  q?: string
  cursor?: string
  limit?: number
}

/**
 * One page of summaries. `next_cursor` is null on the last page rather than
 * absent, because a page the screen is holding always answers the question
 * "is there more" with a value.
 */
export interface LibraryItemList {
  items: LibraryItemSummary[]
  next_cursor: string | null
}

/**
 * What a serendipity draw asks for.
 *
 * `away_from_focus` is the contract's own spelling and the button's whole
 * point: the items related to what the person is focused on already have the
 * “o que ler agora” view, so the draw leans the other way. `seed` exists for
 * a test that needs the same answer twice.
 */
export interface LibraryDrawQuery {
  away_from_focus?: boolean
  n?: number
  seed?: number
}

/**
 * What the save dialog sends: the address, optionally why it was kept, and the
 * registry ids it is about.
 *
 * `link_to` is the contract's own field name and the links are created by the
 * save itself, in its transaction. A dialog that saved first and linked after
 * would leave an unlinked item behind whenever the second call failed.
 */
export interface NewSavedLink {
  url: string
  why?: string
  link_to?: string[]
}

/**
 * What a save answers with: the record as the server now holds it, and
 * whether the canonical URL was already saved.
 *
 * The POST answers 201 on a creation and 200 on a duplicate; the dialog
 * tells the two apart so a second save of an archived link does not claim it
 * landed in the inbox.
 */
export interface LibrarySaveOutcome {
  record: LibraryItemRecord
  duplicate: boolean
}

/**
 * Everything the library screens read and write.
 *
 * Every mutation answers with the record as the server now holds it, which is
 * the only value a screen may display afterwards. The one exception is
 * `extractItem`, which answers with the queued job: the text arrives later, and
 * the reader finds out by reading the item again.
 */
export interface LibrarySource {
  listItems(query: LibraryListQuery, signal: AbortSignal): Promise<LibraryItemList>
  /** Null when there is no such item, which is a "not found" page rather than an error. */
  getItem(id: string, signal: AbortSignal): Promise<LibraryItemRecord | null>
  counts(signal: AbortSignal): Promise<LibraryCounts>
  /** Answers with the saved record, new or already there, and whether it was already there. */
  saveLink(link: NewSavedLink): Promise<LibrarySaveOutcome>
  patchItem(id: string, patch: LibraryPatch): Promise<LibraryItemRecord>
  openItem(id: string): Promise<LibraryItemRecord>
  extractItem(id: string): Promise<ExtractAck>
  /**
   * The items a random draw landed on, in draw order, or an empty list when
   * there is nothing unread to draw from.
   *
   * An empty library is not a failure to report: the button has a sentence for
   * it, and a thrown error would put that sentence in the error panel instead.
   */
  drawItems(query: LibraryDrawQuery, signal: AbortSignal): Promise<LibraryItemSummary[]>
}

/** One entry of `content_headings`, which is a JSON array on the wire. */
export interface LibraryHeading {
  level: number
  text: string
  anchor: string
}

/**
 * The headings of a record, or none.
 *
 * `content_headings` is text carrying JSON, so a record written by an older
 * extraction — or by one that failed halfway — can hold something this cannot
 * read. The reader uses the headings only to name a reading position, so
 * answering with none is a working article without an anchor, not a failure.
 */
export function parseHeadings(raw: string | undefined): LibraryHeading[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is LibraryHeading =>
        typeof entry === 'object' && entry !== null && typeof (entry as LibraryHeading).anchor === 'string'
    )
  } catch {
    return []
  }
}
