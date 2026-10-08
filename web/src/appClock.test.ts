import { describe, expect, it } from 'vitest'

/**
 * Every file under `src`, read as text.
 *
 * The subject is what the code says, not what it does: a constant holding a
 * date is invisible to a behaviour test on any day the literal happens to be
 * close enough to the real one, and obvious in the source.
 */
const SOURCES = import.meta.glob('./**/*.{ts,vue}', {
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
 * The constants through which the app used to decide what day it was. A test
 * may still pin a date — that is what `vi.setSystemTime` is for — so the scan
 * covers production files only.
 */
const LEGACY_DATE_SYMBOLS = ['TODAY', 'MOCK_TODAY', 'STUDY_TODAY', 'DEFAULT_DUE_DATE', 'AGE_BY_DATE']

/**
 * A date written into the code, in either spelling the app uses: `2026-10-03`
 * inside a string, or `20261003` as a bare number.
 *
 * A format string (`'YYYY-MM-DD'`) and a parser (`/^(\d{4})-(\d{2})-(\d{2})/`)
 * are both allowed and neither matches: the first has no digits, and the second
 * spells its digits as escapes rather than as a date.
 */
const ISO_DATE_LITERAL = /['"`]\d{4}-\d{2}-\d{2}/
const COMPACT_DATE_LITERAL = /(?<![\d.])20\d{6}(?![\d.])/

function isProduction(path: string): boolean {
  return !path.includes('.test.') && !path.includes('.fixture.')
}

/**
 * The areas where a written-in date would be a lie rather than a constant: the
 * mock data, which has to keep ageing against the clock, and the screens, which
 * must not decide what day it is for themselves.
 */
function isDatedArea(path: string): boolean {
  const segments = path.split('/')
  if (segments.includes('mock')) return true
  if (segments.includes('views')) return true
  return path.startsWith('./shell/')
}

function legacySymbolsIn(source: string): string[] {
  return LEGACY_DATE_SYMBOLS.filter((name) => new RegExp(`\\b${name}\\b`).test(source))
}

function dateLiteralsIn(source: string): string[] {
  const found: string[] = []
  for (const line of source.split('\n')) {
    const iso = ISO_DATE_LITERAL.exec(line)
    if (iso) found.push(iso[0].slice(1))
    const compact = COMPACT_DATE_LITERAL.exec(line)
    if (compact) found.push(compact[0])
  }
  return found
}

describe('no production file carries a date of its own', () => {
  const production = Object.keys(SOURCES).filter(isProduction)
  const dated = production.filter(isDatedArea)

  it('has files to scan in both the whole tree and the dated areas', () => {
    // A scan over an empty set passes for the wrong reason.
    expect(production.length).toBeGreaterThan(60)
    expect(dated.length).toBeGreaterThan(20)
    expect(dated.some((path) => path.includes('/mock/'))).toBe(true)
    expect(dated.some((path) => path.includes('/views/'))).toBe(true)
  })

  it.each(production)('%s names none of the retired date constants', (path) => {
    expect(legacySymbolsIn(SOURCES[path])).toEqual([])
  })

  it.each(dated)('%s writes no date into itself', (path) => {
    expect(dateLiteralsIn(SOURCES[path])).toEqual([])
  })
})

describe('the scan itself rejects a planted date', () => {
  it('catches all five retired constants in the fixture', () => {
    const planted = FIXTURES['./__fixtures__/legacyDateSymbols.fixture.ts']

    expect(planted, 'the planted fixture is missing').toBeTypeOf('string')
    expect(legacySymbolsIn(planted).sort()).toEqual([...LEGACY_DATE_SYMBOLS].sort())
  })

  it('catches a record timestamped by a literal in the mock area', () => {
    const planted = FIXTURES['./__fixtures__/mockRecordDate.fixture.ts']

    expect(planted, 'the planted fixture is missing').toBeTypeOf('string')
    expect(dateLiteralsIn(planted)).toEqual(['2026-10-03', '2026-10-01'])
  })

  it('catches a screen deciding its own today and due date', () => {
    const planted = FIXTURES['./__fixtures__/viewDueDate.fixture.vue']

    expect(planted, 'the planted fixture is missing').toBeTypeOf('string')
    expect(dateLiteralsIn(planted)).toEqual(['2026-10-03', '20261003', '2026-10-10'])
  })

  it('leaves a format string and a parser alone', () => {
    expect(dateLiteralsIn("const mask = 'YYYY-MM-DD'")).toEqual([])
    expect(dateLiteralsIn('const ISO = /^(\\d{4})-(\\d{2})-(\\d{2})/')).toEqual([])
    expect(dateLiteralsIn('const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000')).toEqual([])
  })
})
