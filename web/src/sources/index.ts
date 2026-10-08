import { inject, provide, type App, type InjectionKey } from 'vue'

import type { LibrarySource } from '@/modules/library/data/source'
import type { NotesSource } from '@/modules/notes/data/source'
import type { ProjectsSource } from '@/modules/projects/data/source'
import type { ReviewSource } from '@/modules/review/data/source'
import type { StudySource } from '@/modules/study/data/source'

/**
 * Where every module reads from, as one bundle.
 *
 * It is one injection rather than one per module because screens cross module
 * lines constantly — a card shows its library item, a decision shows its
 * reading — and a test that mounts such a screen then has one provider to fake
 * instead of three. Which crossings are *allowed* is still the mount rule's
 * business, not this bundle's.
 */
export interface AppSources {
  library: LibrarySource
  notes: NotesSource
  study: StudySource
  review: ReviewSource
  projects: ProjectsSource
}

export const appSourcesKey: InjectionKey<AppSources> = Symbol('norte.sources')

/**
 * The sources this screen reads from.
 *
 * It throws rather than falling back to the mock, because a view that silently
 * reads invented data when its provider is missing is the exact failure this
 * seam exists to prevent.
 */
export function useSources(): AppSources {
  const sources = inject(appSourcesKey, null)
  if (!sources) throw new Error('No data sources are provided above this component')
  return sources
}

/** Provide the sources from inside a component, which is what a test wrapper does. */
export function provideSources(sources: AppSources): void {
  provide(appSourcesKey, sources)
}

/** Provide them application-wide, which is what the entry point does once. */
export function installSources(app: App, sources: AppSources): void {
  app.provide(appSourcesKey, sources)
}
