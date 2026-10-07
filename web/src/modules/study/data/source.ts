import type { Page } from '@/lib/page'
import type { Curriculum, CurriculumStatus, LibraryItem, LibraryKind, StudyDay, Subject } from '@/mock/types'

export interface StudyCounts {
  curricula: number
  /** Modules across every curriculum, which is what the sidebar calls subjects. */
  modules: number
  subjects: number
}

/**
 * The study home, as one read: the curricula it lists, plus the bands around
 * them. The screen draws them together, so splitting them into three reads
 * would only give it three loading states to render.
 */
export interface StudyHomePage extends Page<Curriculum, StudyCounts> {
  subjects: Subject[]
  studyDays: StudyDay[]
  focus: string
}

/** One curriculum with the library items its modules name, already resolved. */
export interface CurriculumDetail {
  curriculum: Curriculum
  materials: LibraryItem[]
}

/** Where a material sits inside a curriculum, for the reading screen's header. */
export interface MaterialContext {
  curriculumTitle: string
  curriculumSlug: string
  moduleTitle: string
  position: number
  total: number
  next?: { id: string; kind: LibraryKind; title: string }
}

export interface StudySummary {
  counts: StudyCounts
  curricula: Array<{ slug: string; title: string }>
}

export interface StudySource {
  studyHome(signal: AbortSignal): Promise<StudyHomePage>
  getCurriculum(slug: string, signal: AbortSignal): Promise<CurriculumDetail | null>
  materialContext(libraryItemId: string, signal: AbortSignal): Promise<MaterialContext | null>
  summary(signal: AbortSignal): Promise<StudySummary>
  addCurriculum(curriculum: { title: string; goal: string }): Promise<Curriculum>
  updateCurriculum(slug: string, updates: { title: string; goal: string; status: CurriculumStatus }): Promise<Curriculum>
  updateCurriculumModule(slug: string, moduleId: string, updates: { title: string }): Promise<Curriculum>
}
