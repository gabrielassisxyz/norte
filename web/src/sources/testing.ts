import { nextTick, type App, type Plugin } from 'vue'

import { createMockStore, type MockStore } from '@/mock/store'
import type { LibraryItemRecord } from '@/modules/library/data/source'
import { fakeLibrarySource, libraryRecord } from '@/modules/library/data/testing'
import { fakeNotesSource } from '@/modules/notes/data/testing'
import { fakeCoreSource } from '@/shell/data/testing'

import { appSourcesKey, type AppSources } from '.'
import { createMockSources } from './mock'

/**
 * Helpers for mounting a screen against sources a test controls. They are only
 * ever imported by tests; the application installs its own bundle in `main.ts`.
 */
const MODULE_NAMES: Array<keyof AppSources> = ['core', 'library', 'notes', 'study', 'review', 'projects']

/**
 * A source that fails loudly instead of answering.
 *
 * A screen reaching for a module the test did not fake is a fact worth knowing:
 * silently answering with nothing would make the test pass while describing a
 * screen that reads from somewhere nobody looked at.
 */
function unavailableSource(name: keyof AppSources): never {
  throw new Error(`The ${name} source was not faked for this test`)
}

function refusingSource(name: keyof AppSources): unknown {
  return new Proxy(
    {},
    {
      get() {
        return () => unavailableSource(name)
      }
    }
  )
}

/** A bundle where only what the test provided can be called. */
export function fakeSources(provided: Partial<AppSources>): AppSources {
  const bundle = Object.fromEntries(
    MODULE_NAMES.map((name) => [name, provided[name] ?? refusingSource(name)])
  ) as unknown as AppSources
  return bundle
}

/** A Vue plugin that provides the bundle, which is how a mounted screen gets it. */
export function sourcesPlugin(provided: Partial<AppSources>): Plugin {
  const bundle = fakeSources(provided)
  return {
    install(app: App) {
      app.provide(appSourcesKey, bundle)
    }
  }
}

/**
 * Let every pending read settle and the DOM catch up.
 *
 * A mock source answers on a later microtask on purpose, so a screen that was
 * just mounted is still showing its loading state; several passes are needed
 * because one read often starts another.
 */
export async function flushReads(passes = 6): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

/**
 * A small library for a test that is not about the library.
 *
 * The shell's own screens — the sidebar, the home, the palette — show library
 * rows, so they need some; they are not the library's tests, so the set is
 * deliberately small and the fields are only the ones those screens read.
 */
export function shellLibraryRecords(): LibraryItemRecord[] {
  return [
    libraryRecord({
      id: 'lib-post',
      kind: 'post',
      title: 'Um texto guardado',
      author: 'Equipe Norte',
      site: 'notas.example',
      minutes: 8,
      saved_at: '2026-10-03T09:00:00Z',
      last_opened_at: '2026-10-03T18:00:00Z',
      read_position: { v: 1, percent: 0.42 }
    }),
    libraryRecord({
      id: 'lib-livro',
      kind: 'livro',
      title: 'Um livro guardado',
      author: 'Marina Costa',
      site: 'editora.example',
      minutes: 28,
      saved_at: '2026-10-02T09:00:00Z',
      last_opened_at: '2026-10-03T17:00:00Z',
      read_position: { v: 1, percent: 0.1 }
    }),
    libraryRecord({
      id: 'lib-paper',
      kind: 'paper',
      title: 'Um paper guardado',
      site: 'papers.example',
      // A note is part of what the palette searches, so one record carries one.
      why: 'Para a horta da varanda',
      minutes: 16,
      saved_at: '2026-09-29T09:00:00Z',
      last_opened_at: '2026-10-03T16:00:00Z'
    }),
    libraryRecord({
      id: 'lib-depois',
      kind: 'post',
      title: 'Guardado para depois',
      site: 'depois.example',
      status: 'depois',
      minutes: 11,
      saved_at: '2026-09-27T09:00:00Z',
      last_opened_at: '2026-10-03T15:00:00Z'
    }),
    libraryRecord({
      id: 'lib-video',
      kind: 'video',
      title: 'Um vídeo guardado',
      site: 'canal.example',
      status: 'arquivo',
      unread: false,
      read_at: '2026-10-01T09:00:00Z',
      saved_at: '2026-09-26T09:00:00Z',
      last_opened_at: '2026-10-03T14:00:00Z'
    }),
    libraryRecord({
      id: 'lib-curso',
      kind: 'curso',
      title: 'Um curso guardado',
      site: 'curso.example',
      status: 'arquivo',
      unread: false,
      read_at: '2026-09-30T09:00:00Z',
      saved_at: '2026-09-25T09:00:00Z',
      last_opened_at: '2026-10-03T13:00:00Z'
    })
  ]
}

/**
 * The mock bundle with a library and a notes source the test controls.
 *
 * Both read the API, so `createMockSources` has nothing to offer for either; a
 * screen outside them that shows their rows still needs them, and these are it.
 * Mounting a module is a separate decision and stays with the test:
 * `setEnabledModules(['library', 'notes'])`.
 */
export function appSourcesWithLibrary(
  options: {
    store?: MockStore
    records?: LibraryItemRecord[]
    library?: AppSources['library']
    notes?: AppSources['notes']
    core?: AppSources['core']
  } = {}
): AppSources {
  return {
    ...createMockSources(options.store ?? createMockStore()),
    library: options.library ?? fakeLibrarySource(options.records ?? shellLibraryRecords()),
    notes: options.notes ?? fakeNotesSource(),
    // The core is always on, so a screen mounted here can always reach it: an
    // empty one is the right default, never a refusing stand-in.
    core: options.core ?? fakeCoreSource()
  }
}
