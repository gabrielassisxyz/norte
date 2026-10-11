import { daysAgo, timestampDaysAgo } from './relative'
import type { LibraryItem, LibraryKind } from './types'

const KIND_BY_ID_PREFIX: Record<string, LibraryKind> = {
  post: 'article',
  book: 'book',
  paper: 'paper',
  video: 'video',
  podcast: 'podcast',
  course: 'course'
}

/**
 * A neutral library entry standing in for an item that another module's mock
 * slice names by id.
 *
 * The library's own slice carries the real entry and wins the merge in
 * `data.ts` for as long as that slice exists, so this is never what a screen
 * shows today. Its only job is to keep the study, review and notes screens
 * resolvable after the library's mock slice is deleted, which is why it invents
 * nothing the id does not already say.
 */
export function createStandInLibraryItem(
  id: string,
  today: string,
  overrides: Partial<LibraryItem> = {}
): LibraryItem {
  return {
    id,
    kind: KIND_BY_ID_PREFIX[id.split('-')[0] ?? ''] ?? 'article',
    title: `Material ${id}`,
    author: 'Material referenciado',
    url: `https://example.com/${id}`,
    location: 'archive',
    unread: false,
    read_at: timestampDaysAgo(today, 30),
    savedAt: daysAgo(today, 32),
    ...overrides
  }
}

/**
 * A stand-in nobody has read yet, sitting in the inbox.
 *
 * The reading state of a referenced item is not incidental: a curriculum's
 * progress line, its current material and its "next" button are all computed
 * from it, so a slice whose stand-ins were all read would describe a curriculum
 * that is finished.
 */
export function createUnreadStandInLibraryItem(id: string, today: string): LibraryItem {
  return createStandInLibraryItem(id, today, { location: 'inbox', unread: true, read_at: undefined })
}
