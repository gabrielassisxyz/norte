import type { Page } from '@/lib/page'
import type {
  Area,
  Bucket,
  Decision,
  Priority,
  Project,
  ProjectStatus,
  Session,
  Task
} from '@/mock/types'

/**
 * A project as a list row: the project plus the three facts the row shows,
 * counted by the source rather than by the screen. A screen that counts open
 * tasks itself has to hold every task of every project to do it.
 */
export interface ProjectRow extends Project {
  areaTitle: string
  nextStep: string
  openTasks: number
  pendingDecisions: number
}

export interface ProjectsCounts {
  projects: number
  active: number
  paused: number
  openTasks: number
  pendingDecisions: number
}

export interface ProjectsOverviewPage extends Page<ProjectRow, ProjectsCounts> {
  areas: Area[]
}

/** One line of the area rail: every area the screen can switch to. */
export interface AreaRailEntry {
  id: string
  title: string
  projects: number
}

export interface AreaDetail {
  area: Area
  projects: ProjectRow[]
  tasks: Task[]
  decisions: Decision[]
  sessions: Session[]
  rail: AreaRailEntry[]
  archivedCount: number
}

export interface ProjectDetail {
  project: Project
  area?: Area
  tasks: Task[]
  decisions: Decision[]
  sessionCount: number
}

export interface TaskDetail {
  task: Task
  project?: Project
  area?: Area
  sessions: Session[]
  blockingDecisions: Decision[]
  siblingTasks: Task[]
}

export interface DecisionDetail {
  decision: Decision
  project?: Project
  area?: Area
  /** The project's other decisions, which the screen lists as related. */
  related: Decision[]
  blockedTasks: Task[]
  decidedCount: number
}

export interface ProjectsSummary {
  counts: ProjectsCounts
  areas: AreaRailEntry[]
  /** Enough of each project to offer it as a target, which is what a "new task here" menu needs. */
  projects: Array<{ id: string; title: string }>
}

export interface NewProjectInput {
  areaId: string
  title: string
  purpose: string
  status: ProjectStatus
  priority: Priority
}

export interface NewTaskInput {
  projectId: string
  title: string
  description: string
  priority: Priority
  bucket: Bucket
}

export interface NewSessionInput {
  projectId: string
  taskId?: string
  startedAt: string
  durationMinutes: number
  summary: string
}

export interface ProjectsSource {
  overview(signal: AbortSignal): Promise<ProjectsOverviewPage>
  getArea(id: string, signal: AbortSignal): Promise<AreaDetail | null>
  getProject(id: string, signal: AbortSignal): Promise<ProjectDetail | null>
  getTask(id: string, signal: AbortSignal): Promise<TaskDetail | null>
  getDecision(id: string, signal: AbortSignal): Promise<DecisionDetail | null>
  summary(signal: AbortSignal): Promise<ProjectsSummary>
  addArea(area: { title: string; intention: string }): Promise<Area>
  updateArea(id: string, updates: { title: string; intention: string }): Promise<Area>
  archiveArea(id: string): Promise<Area>
  unarchiveArea(id: string): Promise<Area>
  addProject(project: NewProjectInput): Promise<Project>
  addTask(task: NewTaskInput): Promise<Task>
  addSession(session: NewSessionInput): Promise<Session>
  updateTask(id: string, updates: { title: string; description: string }): Promise<Task>
  setTaskBucket(id: string, bucket: Bucket): Promise<Task>
  toggleTaskDone(id: string): Promise<Task>
  toggleTaskStep(id: string, stepId: string): Promise<Task>
  decideDecision(id: string, optionId: string, reasoning?: string): Promise<Decision>
  postponeDecision(id: string, until: string): Promise<Decision>
  updateDecision(id: string, updates: { title: string; context: string }): Promise<Decision>
}
