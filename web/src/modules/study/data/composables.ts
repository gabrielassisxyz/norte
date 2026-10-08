import { toValue, watch, type MaybeRefOrGetter } from 'vue'

import { useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import type { Curriculum } from '@/mock/types'
import { useSources } from '@/sources'

import type { CurriculumDetail, MaterialContext, StudyHomePage, StudySummary } from './source'

export interface StudyHomeResource extends AsyncResource<StudyHomePage> {
  /** Put a created or edited curriculum into the page the screen is holding. */
  applyCurriculum: (curriculum: Curriculum) => void
}

export function useStudyHome(): StudyHomeResource {
  const { study } = useSources()
  const resource = useAsyncResource((signal) => study.studyHome(signal))

  function applyCurriculum(curriculum: Curriculum): void {
    const page = resource.data.value
    if (!page) return
    const known = page.items.some((candidate) => candidate.slug === curriculum.slug)
    const items = known
      ? page.items.map((candidate) => (candidate.slug === curriculum.slug ? curriculum : candidate))
      : [curriculum, ...page.items]
    resource.data.value = { ...page, items, counts: { ...page.counts, curricula: items.length } }
  }

  return { ...resource, applyCurriculum }
}

export interface CurriculumResource extends AsyncResource<CurriculumDetail | null> {
  apply: (curriculum: Curriculum) => void
}

/**
 * One curriculum, with the library items its modules name already resolved.
 *
 * `enabled` is false while the screen is the empty "novo currículo" form: there
 * is nothing to read yet, and reading would answer "not found" for a slug that
 * is not meant to exist.
 */
export function useCurriculum(
  slug: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): CurriculumResource {
  const { study } = useSources()
  const resource = useAsyncResource((signal) => study.getCurriculum(toValue(slug), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(slug), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function apply(curriculum: Curriculum): void {
    const detail = resource.data.value
    resource.data.value = detail ? { ...detail, curriculum } : { curriculum, materials: [] }
  }

  return { ...resource, apply }
}

/**
 * Where a library item sits in the curricula, read only while the caller says
 * the crossing is allowed: an item of one backing cannot be joined to curricula
 * of another, so asking at all would be the mistake.
 */
export function useMaterialContext(
  libraryItemId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): AsyncResource<MaterialContext | null> {
  const { study } = useSources()
  const resource = useAsyncResource((signal) => study.materialContext(toValue(libraryItemId), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(libraryItemId), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  return resource
}

/** The sidebar's counts and the curriculum titles a cross-module menu offers. */
export function useStudySummary(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<StudySummary> {
  const { study } = useSources()
  return useAsyncResource((signal) => study.summary(signal), { immediate: toValue(enabled) })
}
