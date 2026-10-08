import type { LibraryItemSummary, LibraryKind } from '../data/source'

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Artigo',
  livro: 'Livro',
  paper: 'PDF',
  video: 'Vídeo',
  podcast: 'Podcast',
  newsletter: 'Newsletter',
  curso: 'Curso'
}

/** Where a row leads: the API-backed reader, keyed by the item's own id. */
export function readerHref(item: Pick<LibraryItemSummary, 'id'>): string {
  return `/biblioteca/${item.id}`
}

/**
 * Who to credit a row to.
 *
 * `author` is what extraction found and is often absent; `site` is the
 * publication, and the canonical URL's host is what is left when neither
 * arrived.
 */
export function sourceOf(item: LibraryItemSummary): string {
  return item.author ?? siteOf(item)
}

/** The publication, or the host that served the page when there is none. */
export function siteOf(item: LibraryItemSummary): string {
  if (item.site) return item.site
  try {
    return new URL(item.canonical_url).hostname.replace(/^www\./, '')
  } catch {
    return 'fonte desconhecida'
  }
}

/** The reading time extraction measured, or a plausible one until it has. */
export function minutesFor(item: LibraryItemSummary): number {
  return item.minutes ?? 8
}

/** How far into the item reading got, as a whole percentage. */
export function progressPercentOf(item: LibraryItemSummary): number {
  const percent = item.read_position?.percent ?? 0
  return Math.round(Math.min(1, Math.max(0, percent)) * 100)
}
