import type { Component } from 'vue'
import type { RouteLocationRaw, RouteRecordRaw } from 'vue-router'

import type { IconName } from '@/components/ds/types'
import type { MockData } from '@/mock/types'
import type { SearchEntry } from '@/search'

/** The products this frontend is split into. Mirrors the server's module names. */
export type ModuleName = 'library' | 'notes' | 'study' | 'review' | 'projects'

/**
 * Where a module's data comes from. `mock` modules work with no server behind
 * them; `api` modules only exist when `/api/config` lists them.
 */
export type ModuleBacking = 'api' | 'mock'

/**
 * The part of a module the shell can read without mounting it: enough to decide
 * whether it is on and what to answer for its addresses when it is off. It is
 * static data on purpose — importing it must not pull in a single view.
 */
export interface ModuleManifest {
  name: ModuleName
  backing: ModuleBacking
  /** Every route path this module owns, in router syntax. */
  routePaths: string[]
}

export interface SidebarLink {
  id: string
  label: string
  to: RouteLocationRaw
  count?: number | string
  /** Design-system icon, for a row that is an invitation rather than a place. */
  icon?: IconName
  /** False for cross-links that share their target with another entry. */
  trackActive?: boolean
}

export interface SidebarHead {
  head: true
  label: string
}

export type SidebarRow = SidebarLink | SidebarHead

/**
 * One top-level line of the sidebar, with the rows it reveals when expanded.
 *
 * Counts and rows are functions rather than values because they read the store
 * and have to be recomputed as it changes.
 */
export interface SidebarSection {
  id: string
  label: string
  to: RouteLocationRaw
  /** Sorts this section against every other module's, nested or not. */
  order: number
  /** Route names that mark this section as the current one. */
  activeRouteNames: string[]
  count?: () => number | string | undefined
  rows?: () => SidebarRow[]
  /**
   * Rendered as a row inside that module's section while both modules are
   * mounted, and as its own top-level line otherwise.
   */
  nestUnder?: ModuleName
}

export interface SidebarShortcutGroup {
  label: string
  order: number
  entries: () => SidebarLink[]
}

export interface ModuleSidebar {
  sections: SidebarSection[]
  shortcuts: SidebarShortcutGroup[]
}

/**
 * A piece of the home screen a module contributes. `actions` blocks sit in the
 * top action bar; `main` blocks stack down the page.
 */
export interface HomeBlock {
  id: string
  order: number
  region: 'actions' | 'main'
  component: Component
}

/** Everything the shell needs from a module, and the only shape it reads. */
export interface NorteModule {
  manifest: ModuleManifest
  routes: RouteRecordRaw[]
  sidebar: ModuleSidebar
  homeBlocks: HomeBlock[]
  searchEntries: (data: MockData) => SearchEntry[]
}
