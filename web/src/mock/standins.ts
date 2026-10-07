import type { LibraryItem, LibraryKind } from './types'

const KIND_BY_ID_PREFIX: Record<string, LibraryKind> = {
  post: 'post',
  book: 'livro',
  paper: 'paper',
  video: 'video',
  podcast: 'podcast',
  course: 'curso'
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
export function createStandInLibraryItem(id: string): LibraryItem {
  return {
    id,
    kind: KIND_BY_ID_PREFIX[id.split('-')[0] ?? ''] ?? 'post',
    title: `Material ${id}`,
    author: 'Material referenciado',
    url: `https://example.com/${id}`,
    status: 'arquivo',
    unread: false,
    savedAt: '2026-09-01'
  }
}
