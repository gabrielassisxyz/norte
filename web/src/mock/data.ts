import { buildLibraryItems } from '@/modules/library/mock/items'
import { buildAnnotations, buildHighlights, buildNotesReferencedItems, buildQuestions } from '@/modules/notes/mock/notes'
import { areas, buildDecisions, buildSessions, projects, tasks } from '@/modules/projects/mock/life'
import { buildReviewCards, buildReviewReferencedItems, reviewDecks } from '@/modules/review/mock/cards'
import { buildStudyReferencedItems, curricula } from '@/modules/study/mock/curricula'
import { buildStudyDays, subjects } from '@/modules/study/mock/study'

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

/**
 * Each store gets its own copy of the undated slices.
 *
 * They are module constants, so handing the same array to two stores lets a
 * write in one appear in the other — which, in a test suite, means one case
 * editing a curriculum changes what the next case reads. The dated slices are
 * built fresh per call and need no copy.
 */
function ownCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Every mock record, dated against one day: the caller passes the day the app
 * is on, so a screen that says "ontem" means yesterday rather than the day this
 * file was written.
 */
export function buildMockData(today: string): MockData {
  return {
    libraryItems: mergeLibraryItems(
      buildLibraryItems(today),
      buildStudyReferencedItems(today),
      buildReviewReferencedItems(today),
      buildNotesReferencedItems(today)
    ),
    curricula: ownCopy(curricula),
    reviewDecks: ownCopy(reviewDecks),
    reviewCards: buildReviewCards(today),
    highlights: buildHighlights(today),
    annotations: buildAnnotations(today),
    questions: buildQuestions(today),
    areas: ownCopy(areas),
    projects: ownCopy(projects),
    decisions: buildDecisions(today),
    tasks: ownCopy(tasks),
    sessions: buildSessions(today),
    subjects: ownCopy(subjects),
    studyDays: buildStudyDays(today)
  }
}
