import { nextTick, type App, type Plugin } from 'vue'

import { appSourcesKey, type AppSources } from '.'

/**
 * Helpers for mounting a screen against sources a test controls. They are only
 * ever imported by tests; the application installs its own bundle in `main.ts`.
 */
const MODULE_NAMES: Array<keyof AppSources> = ['library', 'notes', 'study', 'review', 'projects']

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
