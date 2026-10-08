import { afterEach, describe, expect, it } from 'vitest'

import {
  crossModuleActionAllowed,
  isModuleMounted,
  moduleBacking,
  overrideModuleBacking,
  resetModuleMounting,
  setEnabledModules
} from './mounting'

afterEach(resetModuleMounting)

describe('the mount rule', () => {
  it.each([
    ['mock', [], true],
    ['mock', ['library'], true],
    ['api', [], false],
    ['api', ['library'], true]
  ] as const)('mounts a %s-backed module listed as %j: %s', (backing, enabled, expected) => {
    overrideModuleBacking('library', backing)
    setEnabledModules(enabled)

    expect(isModuleMounted('library')).toBe(expected)
  })

  it('reads a module backing from its manifest until a test overrides it', () => {
    // Study still reads the mock and the library reads the API, so the two
    // together say the backing comes from the manifest and not from a default.
    expect(moduleBacking('study')).toBe('mock')
    expect(moduleBacking('library')).toBe('api')
    overrideModuleBacking('study', 'api')
    expect(moduleBacking('study')).toBe('api')
    resetModuleMounting()
    expect(moduleBacking('study')).toBe('mock')
  })
})

describe('the cross-module gating rule', () => {
  it('offers an action between two mounted modules that read from the same place', () => {
    expect(crossModuleActionAllowed('study', 'review')).toBe(true)
  })

  it('refuses an action from an api-backed module into a mock-backed one', () => {
    overrideModuleBacking('library', 'api')
    setEnabledModules(['library'])

    expect(isModuleMounted('library')).toBe(true)
    expect(crossModuleActionAllowed('library', 'study')).toBe(false)
    expect(crossModuleActionAllowed('library', 'projects')).toBe(false)
  })

  it('refuses an action into a module that is not mounted at all', () => {
    overrideModuleBacking('study', 'api')
    setEnabledModules([])

    expect(crossModuleActionAllowed('library', 'study')).toBe(false)
  })

  it('offers an action between two api-backed modules the server lists', () => {
    overrideModuleBacking('library', 'api')
    overrideModuleBacking('study', 'api')
    setEnabledModules(['library', 'study'])

    expect(crossModuleActionAllowed('library', 'study')).toBe(true)
  })
})
