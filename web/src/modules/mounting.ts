import { reactive } from 'vue'

import { manifest as libraryManifest } from './library/manifest'
import { manifest as notesManifest } from './notes/manifest'
import { manifest as projectsManifest } from './projects/manifest'
import { manifest as reviewManifest } from './review/manifest'
import { manifest as studyManifest } from './study/manifest'
import type { ModuleBacking, ModuleManifest, ModuleName } from './types'

/**
 * Only the manifests are imported here, never a module's `index.ts`: a view
 * asking whether another module is mounted must not drag that module's screens
 * into its own bundle, and the cycle it would create is what breaks first.
 */
const MANIFESTS: Record<ModuleName, ModuleManifest> = {
  library: libraryManifest,
  notes: notesManifest,
  study: studyManifest,
  review: reviewManifest,
  projects: projectsManifest
}

const state = reactive<{
  /** The module names `/api/config` reported, once it has answered. */
  enabled: string[]
  /** Set by tests only, to exercise the mount rule against an `api` module. */
  backings: Partial<Record<ModuleName, ModuleBacking>>
}>({
  enabled: [],
  backings: {}
})

export function setEnabledModules(names: readonly string[]): void {
  state.enabled = [...names]
}

export function enabledModuleNames(): readonly string[] {
  return state.enabled
}

export function moduleBacking(name: ModuleName): ModuleBacking {
  return state.backings[name] ?? MANIFESTS[name].backing
}

/**
 * The one mount rule.
 *
 * A module backed by the mock has nothing to ask the server about and is always
 * there. A module backed by the API exists only while the server says it is
 * switched on, because its screens have nowhere to read from otherwise.
 */
export function isModuleMounted(name: ModuleName): boolean {
  return moduleBacking(name) === 'mock' || state.enabled.includes(name)
}

export function mountedModuleNames(): ModuleName[] {
  return (Object.keys(MANIFESTS) as ModuleName[]).filter(isModuleMounted)
}

/**
 * The one gating rule for an action that reaches from one module into another.
 *
 * The target has to be mounted, and the two modules have to read from the same
 * place: a real id is a UUID and a mock id is a string like `saved-link-3`, so
 * joining an `api` item to `mock` data would write a reference that neither
 * side can resolve.
 */
export function crossModuleActionAllowed(source: ModuleName, target: ModuleName): boolean {
  return isModuleMounted(target) && moduleBacking(target) === moduleBacking(source)
}

/** Test seam: flip a manifest's backing without editing the manifest itself. */
export function overrideModuleBacking(name: ModuleName, backing: ModuleBacking): void {
  state.backings[name] = backing
}

export function resetModuleMounting(): void {
  state.enabled = []
  state.backings = {}
}
