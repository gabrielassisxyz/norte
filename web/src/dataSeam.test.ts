import { describe, expect, it } from 'vitest'

/**
 * Every production file of every module and of the shell, read as text.
 *
 * What this asserts on is the import graph, so the files are read rather than
 * imported: importing them would prove nothing about which file names which,
 * and would run every module's side effects to find out.
 */
const SOURCES = import.meta.glob('./{modules,shell}/**/*.{ts,vue}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const FIXTURES = import.meta.glob('./__fixtures__/*.{ts,vue}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/**
 * A file is production when it is neither a test nor a planted violation, and
 * when it is not part of the mock itself: a mock slice naming another mock
 * slice is the mock being assembled, not a screen reaching into it.
 */
function isProduction(path: string): boolean {
  if (path.includes('.test.') || path.includes('.fixture.')) return false
  return !path.split('/').includes('mock')
}

/** Every module specifier the file names, static or dynamic. */
function importedSpecifiers(source: string): string[] {
  const found: string[] = []
  const pattern = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    found.push(match[1])
  }
  return found
}

/**
 * Whether a specifier points at invented data.
 *
 * `mock/types` is the exception, and the only one: it is the shared domain
 * types, which carry no data and outlive the mock. Everything else with a
 * `mock` segment — the store, the assembled data, a module's seed slice, the
 * bundle of mock sources — is data a screen must not read except through the
 * source injected above it.
 */
function isMockDataModule(specifier: string): boolean {
  const path = specifier.replace(/^@\//, '')
  if (/(^|\/)mock\/types$/.test(path)) return false
  return path.split('/').includes('mock')
}

function mockImportsOf(source: string): string[] {
  return importedSpecifiers(source).filter(isMockDataModule)
}

describe('no screen reads the mock data directly', () => {
  const production = Object.keys(SOURCES).filter(isProduction)

  it('has production files to scan in the first place', () => {
    // A scan over an empty set passes for the wrong reason.
    expect(production.length).toBeGreaterThan(40)
    expect(production.some((path) => path.endsWith('.vue'))).toBe(true)
    expect(production.some((path) => path.startsWith('./shell/'))).toBe(true)
  })

  it.each(production)('%s names no mock module', (path) => {
    expect(mockImportsOf(SOURCES[path])).toEqual([])
  })
})

describe('the scan itself rejects a planted violation', () => {
  it('catches the store and the mock source bundle in the fixture', () => {
    const planted = FIXTURES['./__fixtures__/mockStoreImport.fixture.ts']

    expect(planted, 'the planted fixture is missing').toBeTypeOf('string')
    expect(mockImportsOf(planted)).toEqual(['@/mock/store', '@/sources/mock'])
  })

  it('leaves the shared domain types alone, which every screen may name', () => {
    expect(mockImportsOf("import type { LibraryItem } from '@/mock/types'")).toEqual([])
    expect(mockImportsOf("import type { Task } from '../../mock/types'")).toEqual([])
  })

  it('reads a dynamic import as an import', () => {
    expect(mockImportsOf("const data = await import('@/mock/data')")).toEqual(['@/mock/data'])
  })
})
