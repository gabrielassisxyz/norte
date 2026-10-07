import { describe, expect, it } from 'vitest'

import { initialMockData } from '@/mock/data'
import { annotations, highlights, notesReferencedItems, questions } from '@/modules/notes/mock/notes'
import { reviewCards, reviewReferencedItems } from '@/modules/review/mock/cards'
import { curricula, studyReferencedItems } from '@/modules/study/mock/curricula'

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
    const own = new Set(studyReferencedItems.map((item) => item.id))
    const named = curricula.flatMap((curriculum) =>
      curriculum.modules.flatMap((module) => module.materials.map((material) => material.libraryItemId))
    )

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !own.has(id))).toEqual([])
  })

  it('keeps every card source resolvable without the library slice', () => {
    const own = new Set(reviewReferencedItems.map((item) => item.id))
    const named = reviewCards.map((card) => card.sourceLibraryItemId)

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !own.has(id))).toEqual([])
  })

  it('keeps every note target resolvable without the library slice', () => {
    const own = new Set(notesReferencedItems.map((item) => item.id))
    const named = [...highlights, ...annotations, ...questions]
      .map((note) => note.materialId)
      .filter((id): id is string => Boolean(id))

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !own.has(id))).toEqual([])
  })

  it('does not let a stand-in displace the library entry it stands in for', () => {
    // The library's own slice is merged first, so its richer entry wins while it
    // exists; a stand-in leaking into the visible data would show up here as an
    // item carrying the stand-in's author.
    expect(initialMockData.libraryItems.filter((item) => item.author === 'Material referenciado')).toEqual([])
  })
})
