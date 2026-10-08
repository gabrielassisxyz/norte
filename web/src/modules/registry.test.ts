import { describe, expect, it } from 'vitest'

import * as library from './library'
import * as notes from './notes'
import * as projects from './projects'
import * as review from './review'
import * as study from './study'
import { norteModules } from './index'
import type { ModuleName } from './types'

const MODULES: Array<[ModuleName, Record<string, unknown>]> = [
  ['library', library],
  ['notes', notes],
  ['study', study],
  ['review', review],
  ['projects', projects]
]

describe('what every module has to export', () => {
  it.each(MODULES)('%s exports routes, a sidebar, home blocks, search entries and a manifest', (name, module) => {
    expect(Array.isArray(module.routes)).toBe(true)
    expect(Array.isArray(module.homeBlocks)).toBe(true)
    // Both are composables: they read from the module's source, so they can
    // only be called by a component that has the sources provided above it.
    expect(typeof module.useSearchEntries).toBe('function')
    expect(typeof module.useSidebar).toBe('function')
    // The library and the notes read the API; the rest still read the mock.
    expect(module.manifest).toMatchObject({
      name,
      backing: name === 'library' || name === 'notes' ? 'api' : 'mock',
      routePaths: expect.any(Array)
    })
  })

  it('declares in the manifest every path its route table owns', () => {
    for (const module of norteModules) {
      const declared = [...module.manifest.routePaths].sort()
      const actual = module.routes.map((route) => route.path).sort()
      expect(declared, `${module.manifest.name} manifest`).toEqual(actual)
    }
  })

  it('loads its routes lazily, so a mounted module costs nothing until it is opened', () => {
    for (const module of norteModules) {
      for (const route of module.routes) {
        expect(typeof route.component, `${String(route.name)} component`).toBe('function')
      }
    }
  })

  it('declares both of its navigation composables, which the shell calls once each', () => {
    for (const module of norteModules) {
      expect(typeof module.useSidebar, `${module.manifest.name} useSidebar`).toBe('function')
      expect(typeof module.useSearchEntries, `${module.manifest.name} useSearchEntries`).toBe('function')
    }
  })
})
