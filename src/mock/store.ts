import { reactive } from 'vue'

import { initialMockData } from './data'
import type {
  Annotation,
  Area,
  Bucket,
  CardRating,
  Curriculum,
  Highlight,
  LibraryItem,
  LibraryStatus,
  MockData,
  Project,
  Question,
  ReviewCard,
  Session,
  Task
} from './types'

type SavedLink = Pick<LibraryItem, 'kind' | 'title' | 'author' | 'url'> & Partial<Pick<LibraryItem, 'curriculumSlug'>>
type NewProject = Omit<Project, 'id' | 'features' | 'bugs'> & Partial<Pick<Project, 'features' | 'bugs'>>
type NewTask = Omit<Task, 'id' | 'steps' | 'completed'> & Partial<Pick<Task, 'steps' | 'completed'>>
type NewSession = Omit<Session, 'id'>
type NewArea = Omit<Area, 'id' | 'archived'> & Partial<Pick<Area, 'archived'>>
type NewHighlight = Omit<Highlight, 'id' | 'createdAt'>
type NewAnnotation = Omit<Annotation, 'id' | 'createdAt'>
type NewQuestion = Omit<Question, 'id' | 'createdAt'>

function cloneInitialData(): MockData {
  return JSON.parse(JSON.stringify(initialMockData)) as MockData
}

function requireItem<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`${label} "${id}" was not found`)
  return item
}

function nextId(prefix: string, items: { id: string }[]): string {
  let sequence = 1
  while (items.some((item) => item.id === `${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
}

export function createMockStore() {
  const state = reactive(cloneInitialData())

  function setLibraryItemStatus(id: string, status: LibraryStatus): void {
    requireItem(state.libraryItems, id, 'Library item').status = status
  }

  function addSavedLink(link: SavedLink): LibraryItem {
    const item: LibraryItem = {
      id: nextId('saved-link', state.libraryItems),
      ...link,
      status: 'inbox',
      unread: true,
      savedAt: '2026-10-03'
    }
    state.libraryItems.unshift(item)
    return item
  }

  function addQuestion(question: NewQuestion): Question {
    const created: Question = { id: nextId('question', state.questions), ...question, createdAt: '2026-10-03T12:00:00Z' }
    state.questions.unshift(created)
    return created
  }

  function rateCard(id: string, rating: CardRating): void {
    const card: ReviewCard = requireItem(state.reviewCards, id, 'Review card')
    card.lastRating = rating
    card.dueAt = '2026-10-17'
  }

  function decideDecision(decisionId: string, optionId: string): void {
    const decision = requireItem(state.decisions, decisionId, 'Decision')
    requireItem(decision.options, optionId, 'Decision option')
    decision.status = 'decided'
    decision.selectedOptionId = optionId
    delete decision.postponedUntil
  }

  function postponeDecision(decisionId: string, until: string): void {
    const decision = requireItem(state.decisions, decisionId, 'Decision')
    decision.status = 'postponed'
    decision.postponedUntil = until
    delete decision.selectedOptionId
  }

  function toggleTaskStep(taskId: string, stepId: string): void {
    const task = requireItem(state.tasks, taskId, 'Task')
    const step = requireItem(task.steps, stepId, 'Task step')
    step.completed = !step.completed
  }

  function toggleTaskDone(taskId: string): void {
    const task = requireItem(state.tasks, taskId, 'Task')
    task.completed = !task.completed
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
    const slug = area.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const id = `a-${slug}`
    if (state.areas.some((candidate) => candidate.id === id)) throw new Error(`Area "${id}" already exists`)
    const created: Area = { id, archived: false, ...area }
    state.areas.unshift(created)
    return created
  }

  function updateArea(id: string, updates: Pick<Area, 'title' | 'intention'>): void {
    Object.assign(requireItem(state.areas, id, 'Area'), updates)
  }

  function archiveArea(id: string): void {
    requireItem(state.areas, id, 'Area').archived = true
  }

  function updateCurriculum(slug: string, updates: Pick<Curriculum, 'title' | 'goal' | 'status'>): void {
    const curriculum = state.curricula.find((candidate) => candidate.slug === slug)
    if (!curriculum) throw new Error(`Curriculum "${slug}" was not found`)
    Object.assign(curriculum, updates)
  }

  function addHighlight(highlight: NewHighlight): Highlight {
    requireItem(state.libraryItems, highlight.materialId, 'Library item')
    const created: Highlight = { id: nextId('highlight', state.highlights), ...highlight, createdAt: '2026-10-03T12:00:00Z' }
    state.highlights.unshift(created)
    return created
  }

  function addAnnotation(annotation: NewAnnotation): Annotation {
    requireItem(state.libraryItems, annotation.materialId, 'Library item')
    if (annotation.highlightId) requireItem(state.highlights, annotation.highlightId, 'Highlight')
    const created: Annotation = { id: nextId('annotation', state.annotations), ...annotation, createdAt: '2026-10-03T12:00:00Z' }
    state.annotations.unshift(created)
    return created
  }

  return Object.assign(state, {
    setLibraryItemStatus,
    addSavedLink,
    addQuestion,
    rateCard,
    decideDecision,
    postponeDecision,
    toggleTaskStep,
    toggleTaskDone,
    addProject,
    addTask,
    addSession,
    addArea,
    updateArea,
    archiveArea,
    updateCurriculum,
    addHighlight,
    addAnnotation
  })
}

export type MockStore = ReturnType<typeof createMockStore>

export const store = createMockStore()
