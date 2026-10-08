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
 * Two are absent on purpose. The library reads the API, so its source is built
 * by `createApiLibrarySource`; the core is always on and has no mock at all.
 * The return type says so, which is what makes the entry point name both
 * explicitly instead of silently installing invented data for either.
 */
export function createMockSources(store: MockStore = createMockStore()): Omit<AppSources, 'library' | 'core'> {
  return {
    notes: createMockNotesSource(store),
    study: createMockStudySource(store),
    review: createMockReviewSource(store),
    projects: createMockProjectsSource(store)
  }
}
