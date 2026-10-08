import { toValue, watch, type MaybeRefOrGetter } from 'vue'

import { useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import type { Area, Decision, Task } from '@/mock/types'
import { useSources } from '@/sources'

import type {
  AreaDetail,
  DecisionDetail,
  ProjectDetail,
  ProjectRow,
  ProjectsOverviewPage,
  ProjectsSummary,
  TaskDetail
} from './source'

export interface ProjectsOverviewResource extends AsyncResource<ProjectsOverviewPage> {
  prependProject: (project: ProjectRow) => void
  applyArea: (area: Area) => void
}

export function useProjectsOverview(): ProjectsOverviewResource {
  const { projects } = useSources()
  const resource = useAsyncResource((signal) => projects.overview(signal))

  function prependProject(project: ProjectRow): void {
    const page = resource.data.value
    if (!page) return
    const items = [project, ...page.items.filter((existing) => existing.id !== project.id)]
    resource.data.value = { ...page, items, counts: { ...page.counts, projects: items.length } }
  }

  function applyArea(area: Area): void {
    const page = resource.data.value
    if (!page) return
    resource.data.value = {
      ...page,
      areas: page.areas.map((existing) => (existing.id === area.id ? area : existing))
    }
  }

  return { ...resource, prependProject, applyArea }
}

/**
 * Each detail read takes an `enabled` flag, because two of these screens double
 * as the empty "new" form: there is no id to read then, and reading would
 * answer "not found" for an address that is not meant to exist.
 */
export interface AreaResource extends AsyncResource<AreaDetail | null> {
  applyArea: (area: Area) => void
}

export function useArea(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): AreaResource {
  const { projects } = useSources()
  const resource = useAsyncResource((signal) => projects.getArea(toValue(id), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(id), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function applyArea(area: Area): void {
    const detail = resource.data.value
    if (!detail) return
    resource.data.value = { ...detail, area }
  }

  return { ...resource, applyArea }
}

export interface ProjectResource extends AsyncResource<ProjectDetail | null> {
  applyTask: (task: Task) => void
  countSession: () => void
}

export function useProject(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): ProjectResource {
  const { projects } = useSources()
  const resource = useAsyncResource((signal) => projects.getProject(toValue(id), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(id), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function applyTask(task: Task): void {
    const detail = resource.data.value
    if (!detail) return
    const known = detail.tasks.some((candidate) => candidate.id === task.id)
    resource.data.value = {
      ...detail,
      tasks: known ? detail.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)) : [task, ...detail.tasks]
    }
  }

  function countSession(): void {
    const detail = resource.data.value
    if (!detail) return
    resource.data.value = { ...detail, sessionCount: detail.sessionCount + 1 }
  }

  return { ...resource, applyTask, countSession }
}

export interface TaskResource extends AsyncResource<TaskDetail | null> {
  applyTask: (task: Task) => void
  refreshSessions: () => Promise<void>
}

export function useTask(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): TaskResource {
  const { projects } = useSources()
  const resource = useAsyncResource((signal) => projects.getTask(toValue(id), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(id), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function applyTask(task: Task): void {
    const detail = resource.data.value
    if (!detail) return
    resource.data.value = { ...detail, task }
  }

  return { ...resource, applyTask, refreshSessions: resource.refresh }
}

export interface DecisionResource extends AsyncResource<DecisionDetail | null> {
  applyDecision: (decision: Decision) => void
}

export function useDecision(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): DecisionResource {
  const { projects } = useSources()
  const resource = useAsyncResource((signal) => projects.getDecision(toValue(id), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(id), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function applyDecision(decision: Decision): void {
    const detail = resource.data.value
    if (!detail) return
    resource.data.value = { ...detail, decision }
  }

  return { ...resource, applyDecision }
}

/** The sidebar's area rows, and the projects a cross-module menu offers as targets. */
export function useProjectsSummary(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<ProjectsSummary> {
  const { projects } = useSources()
  return useAsyncResource((signal) => projects.summary(signal), { immediate: toValue(enabled) })
}
