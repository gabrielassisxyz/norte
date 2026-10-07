import { describe, expect, it } from 'vitest'

import { initialMockData } from '@/mock/data'

import { buildCurriculumView } from './curriculum'

const { curricula, libraryItems } = initialMockData

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

  it('sends readable kinds to the reading screen and everything else to its source', () => {
    const view = buildCurriculumView(curricula.find((candidate) => candidate.slug === 'casa-conectada')!, libraryItems)
    const [video, podcast] = view.modules[0].materials

    expect(video.href).toBe('https://example.com/home-network')
    expect(video.url).toBeUndefined()
    expect(podcast.href).toBe('https://example.com/personal-services')

    const readable = buildCurriculumView(curricula.find((candidate) => candidate.slug === 'tipografia-pratica')!, libraryItems)
    expect(readable.modules[0].materials[0].href).toBe('/material/post/post-typography')
    expect(readable.modules[0].materials[0].url).toBe('https://example.com/type-rhythm')
  })
})
