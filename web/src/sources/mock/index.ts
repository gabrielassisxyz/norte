import { createMockStore, type MockStore } from '@/mock/store'

import type { AppSources } from '..'
import { createMockLibrarySource } from './library'
import { createMockNotesSource } from './notes'
import { createMockProjectsSource } from './projects'
import { createMockReviewSource } from './review'
import { createMockStudySource } from './study'

/**
 * The mock behind every module, as the sources the screens read from.
 *
 * This is the only place left that knows the mock store exists. A module asks
 * its own source interface for what it needs, so replacing this bundle with one
 * that talks HTTP changes no screen — which is the whole point of the seam.
 */
export function createMockSources(store: MockStore = createMockStore()): AppSources {
  return {
    library: createMockLibrarySource(store),
    notes: createMockNotesSource(store),
    study: createMockStudySource(store),
    review: createMockReviewSource(store),
    projects: createMockProjectsSource(store)
  }
}
