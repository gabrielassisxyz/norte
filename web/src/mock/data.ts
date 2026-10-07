import { libraryItems } from '@/modules/library/mock/items'
import { annotations, highlights, notesReferencedItems, questions } from '@/modules/notes/mock/notes'
import { areas, decisions, projects, sessions, tasks } from '@/modules/projects/mock/life'
import { reviewCards, reviewDecks, reviewReferencedItems } from '@/modules/review/mock/cards'
import { curricula, studyReferencedItems } from '@/modules/study/mock/curricula'
import { studyDays, subjects } from '@/modules/study/mock/study'

import type { LibraryItem, MockData } from './types'

/**
 * The library's own slice first, then the stand-ins the other modules carry for
 * the items they reference. Deduplicating on id means the library's richer
 * entry wins while its slice exists, and the referencing module's stand-in
 * keeps its screens resolvable once that slice is gone.
 */
function mergeLibraryItems(...slices: LibraryItem[][]): LibraryItem[] {
  const merged: LibraryItem[] = []
  const seen = new Set<string>()
  for (const slice of slices) {
    for (const item of slice) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}

export const initialMockData: MockData = {
  libraryItems: mergeLibraryItems(libraryItems, studyReferencedItems, reviewReferencedItems, notesReferencedItems),
  curricula,
  reviewDecks,
  reviewCards,
  highlights,
  annotations,
  questions,
  areas,
  projects,
  decisions,
  tasks,
  sessions,
  subjects,
  studyDays
}
