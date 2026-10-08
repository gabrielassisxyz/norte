import { createMockStore, type MockStore } from '@/mock/store'

import type { AppSources } from '..'
import { createMockProjectsSource } from './projects'
import { createMockReviewSource } from './review'
import { createMockStudySource } from './study'

/**
 * The mock behind every module that still has one, as the sources the screens
 * read from.
 *
 * Three are absent on purpose. The library and the notes read the API, so their
 * sources are built by `createApiLibrarySource` and `createApiNotesSource`; the
 * core is always on and has no mock at all. The return type says so, which is
 * what makes the entry point name them explicitly instead of silently
 * installing invented data for any of them.
 */
export function createMockSources(store: MockStore = createMockStore()): Omit<AppSources, 'library' | 'notes' | 'core'> {
  return {
    study: createMockStudySource(store),
    review: createMockReviewSource(store),
    projects: createMockProjectsSource(store)
  }
}
