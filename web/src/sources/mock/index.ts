import { createMockStore, type MockStore } from '@/mock/store'

import type { AppSources } from '..'
import { createMockProjectsSource } from './projects'
import { createMockReviewSource } from './review'
import { createMockStudySource } from './study'

/**
 * The mock behind every module that still has one, as the sources the screens
 * read from.
 *
 * The library and the notes are absent on purpose: both read the API, so their
 * sources are built by `createApiLibrarySource` and `createApiNotesSource` and
 * this bundle has nothing to offer for either. The return type says so, which
 * is what makes the entry point name them explicitly instead of silently
 * installing invented data for them.
 */
export function createMockSources(store: MockStore = createMockStore()): Omit<AppSources, 'library' | 'notes'> {
  return {
    study: createMockStudySource(store),
    review: createMockReviewSource(store),
    projects: createMockProjectsSource(store)
  }
}
