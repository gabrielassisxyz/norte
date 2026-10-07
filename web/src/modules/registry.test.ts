import { describe, expect, it } from 'vitest'

import { initialMockData } from '@/mock/data'

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
  it.each(MODULES)('%s exports routes, sidebar, homeBlocks, searchEntries and a manifest', (name, module) => {
    expect(Array.isArray(module.routes)).toBe(true)
    expect(Array.isArray(module.homeBlocks)).toBe(true)
    expect(typeof module.searchEntries).toBe('function')
    expect(module.sidebar).toMatchObject({ sections: expect.any(Array), shortcuts: expect.any(Array) })
    expect(module.manifest).toMatchObject({ name, backing: 'mock', routePaths: expect.any(Array) })
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

  it('answers the search with entries only for its own screens', () => {
    for (const module of norteModules) {
      const entries = module.searchEntries(initialMockData)
      expect(entries.length, `${module.manifest.name} search entries`).toBeGreaterThan(0)
    }
  })
})
