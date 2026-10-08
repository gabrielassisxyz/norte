import { describe, expect, it } from 'vitest'

import { buildMockData } from '@/mock/data'
import { buildAnnotations, buildHighlights, buildNotesReferencedItems, buildQuestions } from '@/modules/notes/mock/notes'
import { buildReviewCards, buildReviewReferencedItems } from '@/modules/review/mock/cards'
import { buildStudyReferencedItems, curricula } from '@/modules/study/mock/curricula'

/** One day to build every slice against; which day it is changes nothing here. */
const TODAY = '2026-10-03'

/**
 * Every source file of the three modules, read as text. What this asserts on is
 * the import graph, so the files are read rather than imported: importing them
 * would prove nothing about which file names which.
 */
const SOURCES = import.meta.glob('./{study,review,notes}/**/*.{ts,vue}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** Every specifier the library's mock slice can be named by from those folders. */
const LIBRARY_SLICE_IMPORTS = [
  '@/modules/library/mock/items',
  '../library/mock/items',
  '../../library/mock/items',
  '../../../library/mock/items'
]

function filesUnder(name: string): string[] {
  return Object.keys(SOURCES).filter((path) => path.startsWith(`./${name}/`))
}

describe('the study, review and notes modules do not reach into the library slice', () => {
  it.each(['study', 'review', 'notes'])('has no file under %s importing it', (name) => {
    const files = filesUnder(name)
    expect(files.length).toBeGreaterThan(0)

    const offenders = files.filter((path) =>
      LIBRARY_SLICE_IMPORTS.some((specifier) => SOURCES[path].includes(`'${specifier}'`))
    )

    expect(offenders).toEqual([])
  })
})

describe('each slice carries the library items it names', () => {
  it('keeps every curriculum material resolvable without the library slice', () => {
    const own = new Set(buildStudyReferencedItems(TODAY).map((item) => item.id))
    const named = curricula.flatMap((curriculum) =>
      curriculum.modules.flatMap((module) => module.materials.map((material) => material.libraryItemId))
    )

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !own.has(id))).toEqual([])
  })

  it('keeps every card source resolvable without the library slice', () => {
    const own = new Set(buildReviewReferencedItems(TODAY).map((item) => item.id))
    const named = buildReviewCards(TODAY).map((card) => card.sourceLibraryItemId)

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !own.has(id))).toEqual([])
  })

  it('keeps every note target resolvable without the library slice', () => {
    const own = new Set(buildNotesReferencedItems(TODAY).map((item) => item.id))
    const named = [...buildHighlights(TODAY), ...buildAnnotations(TODAY), ...buildQuestions(TODAY)]
      .map((note) => note.materialId)
      .filter((id): id is string => Boolean(id))

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !own.has(id))).toEqual([])
  })

  it('holds nothing but stand-ins, now that the library reads the API', () => {
    // The library has no mock slice any more, so every library record the mock
    // carries is a stand-in some other module's slice names by id. A record
    // with another author would be a library slice growing back.
    const records = buildMockData(TODAY).libraryItems

    expect(records.length).toBeGreaterThan(0)
    expect(records.filter((item) => item.author !== 'Material referenciado')).toEqual([])
  })
})
