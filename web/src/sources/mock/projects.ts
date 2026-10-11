import type { MockStore } from '@/mock/store'
import type { Area, Project } from '@/mock/types'
import type {
  AreaDetail,
  AreaRailEntry,
  ProjectDetail,
  ProjectRow,
  ProjectsCounts,
  ProjectsOverviewPage,
  ProjectsSearchIndex,
  ProjectsSource,
  ProjectsSummary,
  DecisionDetail,
  TaskDetail
} from '@/modules/projects/data/source'

import { answer } from './respond'

export function createMockProjectsSource(store: MockStore): ProjectsSource {
  function areaOf(areaId: string | undefined): Area | undefined {
    return store.areas.find((candidate) => candidate.id === areaId)
  }

  /** The row aggregates the server computes, so a screen never counts them itself. */
  function row(project: Project): ProjectRow {
    const tasks = store.tasks.filter((task) => task.projectId === project.id)
    const open = tasks.filter((task) => !task.completed)
    return {
      ...project,
      areaTitle: areaOf(project.areaId)?.title ?? 'Unnamed area',
      nextStep: open[0]?.title ?? 'Set the next step',
      openTasks: open.length,
      pendingDecisions: store.decisions.filter(
        (decision) => decision.projectId === project.id && decision.status !== 'decided'
      ).length
    }
  }

  function counts(projects: Project[]): ProjectsCounts {
    const projectIds = new Set(projects.map((project) => project.id))
    return {
      projects: projects.length,
      active: projects.filter((project) => project.status === 'active').length,
      paused: projects.filter((project) => project.status === 'paused').length,
      openTasks: store.tasks.filter((task) => !task.completed && projectIds.has(task.projectId)).length,
      pendingDecisions: store.decisions.filter(
        (decision) => decision.status !== 'decided' && projectIds.has(decision.projectId)
      ).length
    }
  }

  function rail(): AreaRailEntry[] {
    return store.areas.map((area) => ({
      id: area.id,
      title: area.title,
      projects: store.projects.filter((project) => project.areaId === area.id).length,
      archived: area.archived
    }))
  }

  return {
    overview(signal: AbortSignal): Promise<ProjectsOverviewPage> {
      return answer(
        () => ({
          items: store.projects.map(row),
          next_cursor: null,
          counts: counts(store.projects),
          areas: store.areas
        }),
        signal
      )
    },

    getArea(id: string, signal: AbortSignal): Promise<AreaDetail | null> {
      return answer(() => {
        const area = areaOf(id)
        if (!area) return null
        const projects = store.projects.filter((project) => project.areaId === id)
        const projectIds = new Set(projects.map((project) => project.id))
        return {
          area,
          projects: projects.map(row),
          tasks: store.tasks.filter((task) => projectIds.has(task.projectId)),
          decisions: store.decisions.filter((decision) => projectIds.has(decision.projectId)),
          sessions: [...store.sessions]
            .filter((session) => projectIds.has(session.projectId))
            .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
          rail: rail(),
          archivedCount: store.areas.filter((candidate) => candidate.archived).length
        }
      }, signal)
    },

    getProject(id: string, signal: AbortSignal): Promise<ProjectDetail | null> {
      return answer(() => {
        const project = store.projects.find((candidate) => candidate.id === id)
        if (!project) return null
        return {
          project,
          area: areaOf(project.areaId),
          tasks: store.tasks.filter((task) => task.projectId === id),
          decisions: store.decisions.filter((decision) => decision.projectId === id),
          sessionCount: store.sessions.filter((session) => session.projectId === id).length
        }
      }, signal)
    },

    getTask(id: string, signal: AbortSignal): Promise<TaskDetail | null> {
      return answer(() => {
        const task = store.tasks.find((candidate) => candidate.id === id)
        if (!task) return null
        const project = store.projects.find((candidate) => candidate.id === task.projectId)
        return {
          task,
          project,
          area: areaOf(project?.areaId),
          sessions: store.sessions.filter((session) => session.taskId === id),
          blockingDecisions: store.decisions.filter((decision) => decision.blockedTaskIds.includes(id)),
          siblingTasks: store.tasks.filter(
            (candidate) =>
              candidate.projectId === task.projectId &&
              candidate.id !== id &&
              !candidate.completed &&
              (candidate.priority === 'P1' || candidate.priority === 'P2')
          )
        }
      }, signal)
    },

    getDecision(id: string, signal: AbortSignal): Promise<DecisionDetail | null> {
      return answer(() => {
        const decision = store.decisions.find((candidate) => candidate.id === id)
        if (!decision) return null
        const project = store.projects.find((candidate) => candidate.id === decision.projectId)
        const siblings = store.decisions.filter((candidate) => candidate.projectId === decision.projectId)
        return {
          decision,
          project,
          area: areaOf(project?.areaId),
          related: siblings.filter((candidate) => candidate.id !== decision.id),
          blockedTasks: store.tasks.filter((task) => decision.blockedTaskIds.includes(task.id)),
          decidedCount: siblings.filter((candidate) => candidate.status === 'decided').length
        }
      }, signal)
    },

    summary(signal: AbortSignal): Promise<ProjectsSummary> {
      return answer(
        () => ({
          counts: counts(store.projects),
          areas: rail(),
          projects: store.projects.map((project) => ({ id: project.id, title: project.title }))
        }),
        signal
      )
    },

    searchIndex(signal: AbortSignal): Promise<ProjectsSearchIndex> {
      return answer(
        () => ({
          areas: store.areas,
          projects: store.projects,
          decisions: store.decisions,
          tasks: store.tasks
        }),
        signal
      )
    },

    addArea(area) {
      return answer(() => store.addArea(area))
    },

    updateArea(id, updates) {
      return answer(() => store.updateArea(id, updates))
    },

    archiveArea(id) {
      return answer(() => store.archiveArea(id))
    },

    unarchiveArea(id) {
      return answer(() => store.unarchiveArea(id))
    },

    addProject(project) {
      return answer(() => row(store.addProject(project)))
    },

    addTask(task) {
      return answer(() => store.addTask(task))
    },

    addSession(session) {
      return answer(() => store.addSession(session))
    },

    updateTask(id, updates) {
      return answer(() => store.updateTask(id, updates))
    },

    setTaskBucket(id, bucket) {
      return answer(() => store.setTaskBucket(id, bucket))
    },

    toggleTaskDone(id) {
      return answer(() => store.toggleTaskDone(id))
    },

    toggleTaskStep(id, stepId) {
      return answer(() => store.toggleTaskStep(id, stepId))
    },

    decideDecision(id, optionId, reasoning) {
      return answer(() => store.decideDecision(id, optionId, reasoning))
    },

    postponeDecision(id, until) {
      return answer(() => store.postponeDecision(id, until))
    },

    updateDecision(id, updates) {
      return answer(() => store.updateDecision(id, updates))
    }
  }
}
