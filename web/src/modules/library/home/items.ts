import type { LibraryItemSummary, LibraryKind } from '../data/source'

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  article: 'Article',
  book: 'Book',
  paper: 'PDF',
  video: 'Video',
  podcast: 'Podcast',
  newsletter: 'Newsletter',
  course: 'Course'
}

/** Where a row leads: the API-backed reader, keyed by the item's own id. */
export function readerHref(item: Pick<LibraryItemSummary, 'id'>): string {
  return `/library/${item.id}`
}

/**
 * Who to credit a row to, or null when extraction found no author.
 *
 * The site is printed on its own line, so falling back to it here would print
 * it twice on rows with no author.
 */
export function sourceOf(item: LibraryItemSummary): string | null {
  return item.author ?? null
}

/** The publication, or the host that served the page when there is none. */
export function siteOf(item: LibraryItemSummary): string {
  if (item.site) return item.site
  try {
    return new URL(item.canonical_url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}

/** The reading time extraction measured, or null while unknown — never an invention. */
export function minutesFor(item: LibraryItemSummary): number | null {
  return item.minutes ?? null
}

/**
 * What is left to read, not the whole: the measured minutes scaled by the
 * unread share, rounded up. Null when the length is unknown, which is when
 * the row shows no duration at all.
 */
export function minutesRemainingFor(item: LibraryItemSummary): number | null {
  if (item.minutes == null) return null
  const percent = item.read_position?.percent ?? 0
  const clamped = Math.min(1, Math.max(0, percent))
  return Math.ceil(item.minutes * (1 - clamped))
}

/** How far into the item reading got, as a whole percentage. */
export function progressPercentOf(item: LibraryItemSummary): number {
  const percent = item.read_position?.percent ?? 0
  return Math.round(Math.min(1, Math.max(0, percent)) * 100)
}
