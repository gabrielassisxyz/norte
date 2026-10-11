import { reactive } from 'vue'

import { nowTimestamp, shiftIsoDate, todayIsoDate } from '@/lib/clock'

import { buildMockData } from './data'
import type {
  Area,
  Bucket,
  CardRating,
  Curriculum,
  CurriculumModule,
  Decision,
  Project,
  ReviewCard,
  Session,
  Task
} from './types'

/** How far a rating pushes a card out, matching the intervals the deck offers. */
const DAYS_BY_RATING: Record<CardRating, number> = { again: 0, hard: 2, good: 6, easy: 14 }

type NewProject = Omit<Project, 'id' | 'features' | 'bugs'> & Partial<Pick<Project, 'features' | 'bugs'>>
type NewTask = Omit<Task, 'id' | 'steps' | 'completed'> & Partial<Pick<Task, 'steps' | 'completed'>>
type NewSession = Omit<Session, 'id'>
type NewArea = Omit<Area, 'id' | 'archived'> & Partial<Pick<Area, 'archived'>>
type NewCurriculum = Omit<Curriculum, 'slug' | 'status' | 'modules'> & Partial<Pick<Curriculum, 'status' | 'modules'>>

function requireItem<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`${label} "${id}" was not found`)
  return item
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function nextId(prefix: string, items: { id: string }[]): string {
  let sequence = 1
  while (items.some((item) => item.id === `${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
}

/**
 * One mock dataset with the operations a screen performs on it.
 *
 * The data is dated against `today`, which the caller reads from the clock, and
 * every record this store creates is dated the same way — so a store built this
 * morning and a link saved this afternoon agree about what day it is.
 */
export function createMockStore(today: string = todayIsoDate()) {
  const state = reactive(buildMockData(today))

  function rateCard(id: string, rating: CardRating): ReviewCard {
    const card: ReviewCard = requireItem(state.reviewCards, id, 'Review card')
    card.lastRating = rating
    card.dueAt = shiftIsoDate(todayIsoDate(), DAYS_BY_RATING[rating])
    return card
  }

  /**
   * `optionId` may name a choice that is none of the recorded options, which is
   * what the "Outra" answer is; it then carries its own reasoning.
   */
  function decideDecision(decisionId: string, optionId: string, reasoning?: string): Decision {
    const decision = requireItem(state.decisions, decisionId, 'Decision')
    if (decision.options.some((option) => option.id === optionId)) {
      delete decision.reasoning
    } else {
      if (!reasoning?.trim()) throw new Error(`Decision "${decisionId}" needs a reason for a choice of its own`)
      decision.reasoning = reasoning.trim()
    }
    decision.status = 'decided'
    decision.selectedOptionId = optionId
    delete decision.postponedUntil
    return decision
  }

  function postponeDecision(decisionId: string, until: string): Decision {
    const decision = requireItem(state.decisions, decisionId, 'Decision')
    decision.status = 'postponed'
    decision.postponedUntil = until
    delete decision.selectedOptionId
    return decision
  }

  function updateDecision(decisionId: string, updates: Pick<Decision, 'title' | 'context'>): Decision {
    const decision = requireItem(state.decisions, decisionId, 'Decision')
    Object.assign(decision, updates)
    return decision
  }

  function toggleTaskStep(taskId: string, stepId: string): Task {
    const task = requireItem(state.tasks, taskId, 'Task')
    const step = requireItem(task.steps, stepId, 'Task step')
    step.completed = !step.completed
    return task
  }

  function toggleTaskDone(taskId: string): Task {
    const task = requireItem(state.tasks, taskId, 'Task')
    task.completed = !task.completed
    return task
  }

  function setTaskBucket(taskId: string, bucket: Bucket): Task {
    const task = requireItem(state.tasks, taskId, 'Task')
    task.bucket = bucket
    return task
  }

  function updateTask(taskId: string, updates: Pick<Task, 'title' | 'description'>): Task {
    return Object.assign(requireItem(state.tasks, taskId, 'Task'), updates)
  }

  function addProject(project: NewProject): Project {
    requireItem(state.areas, project.areaId, 'Area')
    const created: Project = { id: nextId('project', state.projects), features: [], bugs: [], ...project }
    state.projects.unshift(created)
    return created
  }

  function addTask(task: NewTask): Task {
    requireItem(state.projects, task.projectId, 'Project')
    const created: Task = { id: nextId('task', state.tasks), steps: [], completed: false, ...task }
    state.tasks.unshift(created)
    return created
  }

  function addSession(session: NewSession): Session {
    requireItem(state.projects, session.projectId, 'Project')
    if (session.taskId) requireItem(state.tasks, session.taskId, 'Task')
    const created: Session = { id: nextId('session', state.sessions), ...session }
    state.sessions.unshift(created)
    return created
  }

  function addArea(area: NewArea): Area {
    const id = `a-${slugify(area.title)}`
    if (state.areas.some((candidate) => candidate.id === id)) throw new Error(`Area "${id}" already exists`)
    const created: Area = { id, archived: false, ...area }
    state.areas.unshift(created)
    return created
  }

  function updateArea(id: string, updates: Pick<Area, 'title' | 'intention'>): Area {
    return Object.assign(requireItem(state.areas, id, 'Area'), updates)
  }

  function archiveArea(id: string): Area {
    const area = requireItem(state.areas, id, 'Area')
    area.archived = true
    return area
  }

  function unarchiveArea(id: string): Area {
    const area = requireItem(state.areas, id, 'Area')
    area.archived = false
    return area
  }

  function requireCurriculum(slug: string): Curriculum {
    const curriculum = state.curricula.find((candidate) => candidate.slug === slug)
    if (!curriculum) throw new Error(`Curriculum "${slug}" was not found`)
    return curriculum
  }

  function updateCurriculum(slug: string, updates: Pick<Curriculum, 'title' | 'goal' | 'status'>): Curriculum {
    return Object.assign(requireCurriculum(slug), updates)
  }

  function updateCurriculumModule(slug: string, moduleId: string, updates: Pick<CurriculumModule, 'title'>): Curriculum {
    Object.assign(requireItem(requireCurriculum(slug).modules, moduleId, 'Curriculum module'), updates)
    return requireCurriculum(slug)
  }

  function addCurriculum(curriculum: NewCurriculum): Curriculum {
    const slug = slugify(curriculum.title)
    if (!slug) throw new Error('A curriculum needs a title that yields a slug')
    if (state.curricula.some((candidate) => candidate.slug === slug)) throw new Error(`Curriculum "${slug}" already exists`)
    // A new curriculum starts with one empty module so the page has somewhere to put materials.
    const created: Curriculum = {
      slug,
      status: 'planned',
      modules: [{ id: 'mod-1', title: 'First module', summary: '', materials: [], exercises: [] }],
      ...curriculum
    }
    state.curricula.unshift(created)
    return created
  }

  return Object.assign(state, {
    rateCard,
    decideDecision,
    postponeDecision,
    updateDecision,
    toggleTaskStep,
    toggleTaskDone,
    setTaskBucket,
    updateTask,
    addProject,
    addTask,
    addSession,
    addArea,
    updateArea,
    archiveArea,
    unarchiveArea,
    updateCurriculum,
    updateCurriculumModule,
    addCurriculum
  })
}

export type MockStore = ReturnType<typeof createMockStore>
