import { afterEach, describe, expect, it } from 'vitest'

import { buildMockData } from '@/mock/data'
import { overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'

const mockData = buildMockData('2026-10-03')

import { buildCurriculumView } from './curriculum'

const { curricula, libraryItems } = mockData

afterEach(() => {
  resetModuleMounting()
})

describe('curriculum view model', () => {
  it('marks at most one material as the current one across the whole curriculum', () => {
    for (const curriculum of curricula) {
      const view = buildCurriculumView(curriculum, libraryItems)
      const current = view.modules.flatMap((module) => module.materials).filter((material) => material.status === 'current')

      expect(current.length, `${curriculum.slug} has ${current.length} current materials`).toBeLessThanOrEqual(1)
      expect(view.next?.id).toBe(current[0]?.id)
    }
  })

  it('counts required materials and keeps the progress within them', () => {
    const view = buildCurriculumView(curricula.find((candidate) => candidate.slug === 'horta-caseira')!, libraryItems)

    expect(view.requiredTotal).toBe(4)
    expect(view.requiredDone).toBe(2)
    expect(view.modules.map((module) => module.status)).toEqual(['current', 'next', 'done'])
  })

  it('sends a kind nobody reads in the app to its source', () => {
    const view = buildCurriculumView(curricula.find((candidate) => candidate.slug === 'casa-conectada')!, libraryItems)
    const [video, podcast] = view.modules[0].materials

    expect(video.href).toBe('https://example.com/video-network')
    expect(video.url).toBeUndefined()
    expect(podcast.href).toBe('https://example.com/podcast-home-server')
  })

  it('sends a readable kind to the source too while the library reads elsewhere', () => {
    // These ids come from this module's own slice, and the library resolves ids
    // against the server. Offering the in-app reader here would open a reader
    // with nothing in it.
    const view = buildCurriculumView(curricula.find((candidate) => candidate.slug === 'tipografia-pratica')!, libraryItems)

    expect(view.modules[0].materials[0].href).toBe('https://example.com/post-typography')
    expect(view.modules[0].materials[0].url).toBeUndefined()
  })

  it('sends a readable kind to the reading screen once both read the same place', () => {
    overrideModuleBacking('library', 'mock')
    setEnabledModules([])
    const view = buildCurriculumView(curricula.find((candidate) => candidate.slug === 'tipografia-pratica')!, libraryItems)

    expect(view.modules[0].materials[0].href).toBe('/material/article/post-typography')
    expect(view.modules[0].materials[0].url).toBe('https://example.com/post-typography')
  })
})
