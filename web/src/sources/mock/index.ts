import { createMockStore, type MockStore } from '@/mock/store'

import type { AppSources } from '..'
import { createMockNotesSource } from './notes'
import { createMockProjectsSource } from './projects'
import { createMockReviewSource } from './review'
import { createMockStudySource } from './study'

/**
 * The mock behind every module that still has one, as the sources the screens
 * read from.
 *
 * The library is absent on purpose: it reads the API, so its source is built by
 * `createApiLibrarySource` and this bundle has nothing to offer for it. The
 * return type says so, which is what makes the entry point name the library's
 * source explicitly instead of silently installing invented data for it.
 */
export function createMockSources(store: MockStore = createMockStore()): Omit<AppSources, 'library'> {
  return {
    notes: createMockNotesSource(store),
    study: createMockStudySource(store),
    review: createMockReviewSource(store),
    projects: createMockProjectsSource(store)
  }
}
