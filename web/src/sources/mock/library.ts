import type { MockStore } from '@/mock/store'
import type { LibraryItem, LibraryKind } from '@/mock/types'
import { countLibraryItems } from '@/modules/library/data/counts'
import type { LibraryList, LibraryListQuery, LibrarySource, LibrarySummary } from '@/modules/library/data/source'

import { answer, searchMatches } from './respond'

const KINDS: LibraryKind[] = ['post', 'livro', 'paper', 'video', 'podcast', 'curso']

function sortItems(items: LibraryItem[], sort: LibraryListQuery['sort']): LibraryItem[] {
  if (sort === 'titulo') return [...items].sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'))
  return [...items].sort((left, right) => right.savedAt.localeCompare(left.savedAt))
}

export function createMockLibrarySource(store: MockStore): LibrarySource {
  function selected(query: LibraryListQuery): LibraryItem[] {
    // `newsletter` is a kind the library has no items of yet; it is a real
    // filter on the screen, so it answers with nothing rather than everything.
    if (query.kind === 'newsletter') return []
    return store.libraryItems.filter(
      (item) =>
        (!query.kind || item.kind === query.kind) && searchMatches(query.search ?? '', item.title, item.author, item.domain)
    )
  }

  return {
    listItems(query: LibraryListQuery, signal: AbortSignal): Promise<LibraryList> {
      return answer(() => {
        const items = selected(query)
        return { items: sortItems(items, query.sort), next_cursor: null, counts: countLibraryItems(items) }
      }, signal)
    },

    getItem(id: string, signal: AbortSignal) {
      return answer(() => store.libraryItems.find((item) => item.id === id) ?? null, signal)
    },

    summary(signal: AbortSignal): Promise<LibrarySummary> {
      return answer(() => {
        const slugs = [...new Set(store.libraryItems.map((item) => item.curriculumSlug).filter(Boolean))] as string[]
        return {
          counts: countLibraryItems(store.libraryItems),
          kinds: Object.fromEntries(
            KINDS.map((kind) => [kind, store.libraryItems.filter((item) => item.kind === kind).length])
          ) as Record<LibraryKind, number>,
          lists: slugs.map((slug) => ({
            slug,
            count: store.libraryItems.filter((item) => item.curriculumSlug === slug).length
          }))
        }
      }, signal)
    },

    saveLink(link) {
      return answer(() => store.addSavedLink(link))
    },

    setStatus(id, status) {
      return answer(() => store.setLibraryItemStatus(id, status))
    },

    setUnread(id, unread) {
      return answer(() => store.setLibraryItemUnread(id, unread))
    },

    setCurriculum(id, curriculumSlug) {
      return answer(() => store.setLibraryItemCurriculum(id, curriculumSlug))
    }
  }
}
