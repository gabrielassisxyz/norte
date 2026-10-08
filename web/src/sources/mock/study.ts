import type { MockStore } from '@/mock/store'
import type { Curriculum } from '@/mock/types'
import { WEEKLY_FOCUS } from '@/modules/study/mock/study'
import type {
  CurriculumDetail,
  MaterialContext,
  StudyCounts,
  StudyHomePage,
  StudySource,
  StudySummary
} from '@/modules/study/data/source'

import { answer } from './respond'

export function createMockStudySource(store: MockStore): StudySource {
  function counts(): StudyCounts {
    return {
      curricula: store.curricula.length,
      modules: store.curricula.reduce((total, curriculum) => total + curriculum.modules.length, 0),
      subjects: store.subjects.length
    }
  }

  function materialIdsOf(curriculum: Curriculum): string[] {
    return curriculum.modules.flatMap((module) => module.materials.map((material) => material.libraryItemId))
  }

  return {
    studyHome(signal: AbortSignal): Promise<StudyHomePage> {
      return answer(
        () => ({
          items: store.curricula,
          next_cursor: null,
          counts: counts(),
          subjects: store.subjects,
          studyDays: store.studyDays,
          focus: WEEKLY_FOCUS
        }),
        signal
      )
    },

    getCurriculum(slug: string, signal: AbortSignal): Promise<CurriculumDetail | null> {
      return answer(() => {
        const curriculum = store.curricula.find((candidate) => candidate.slug === slug)
        if (!curriculum) return null
        const named = new Set(materialIdsOf(curriculum))
        return { curriculum, materials: store.libraryItems.filter((item) => named.has(item.id)) }
      }, signal)
    },

    /**
     * Where a library item sits in the curricula, and what comes after it. The
     * join lives here because it is the server's to make: the reading screen
     * cannot hold every curriculum to find out.
     */
    materialContext(libraryItemId: string, signal: AbortSignal): Promise<MaterialContext | null> {
      return answer(() => {
        for (const curriculum of store.curricula) {
          for (const module of curriculum.modules) {
            const position = module.materials.findIndex((entry) => entry.libraryItemId === libraryItemId)
            if (position < 0) continue

            const following = module.materials[position + 1]
            const nextItem = following
              ? store.libraryItems.find((item) => item.id === following.libraryItemId)
              : undefined
            return {
              curriculumTitle: curriculum.title,
              curriculumSlug: curriculum.slug,
              moduleTitle: module.title,
              position: position + 1,
              total: module.materials.length,
              ...(nextItem ? { next: { id: nextItem.id, kind: nextItem.kind, title: nextItem.title } } : {})
            }
          }
        }
        return null
      }, signal)
    },

    summary(signal: AbortSignal): Promise<StudySummary> {
      return answer(
        () => ({
          counts: counts(),
          curricula: store.curricula.map((curriculum) => ({ slug: curriculum.slug, title: curriculum.title }))
        }),
        signal
      )
    },

    addCurriculum(curriculum) {
      return answer(() => store.addCurriculum(curriculum))
    },

    updateCurriculum(slug, updates) {
      return answer(() => store.updateCurriculum(slug, updates))
    },

    updateCurriculumModule(slug, moduleId, updates) {
      return answer(() => store.updateCurriculumModule(slug, moduleId, updates))
    }
  }
}
