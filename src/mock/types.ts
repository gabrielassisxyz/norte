export type LibraryKind = 'post' | 'livro' | 'paper' | 'video' | 'podcast' | 'curso'

export type LibraryStatus = 'inbox' | 'depois' | 'arquivo' | 'read'

export type MaterialKind = Extract<LibraryKind, 'post' | 'livro' | 'paper'>

export interface LibraryItem {
  id: string
  kind: LibraryKind
  title: string
  author: string
  url: string
  status: LibraryStatus
  unread: boolean
  savedAt: string
  curriculumSlug?: string
}

export interface CurriculumMaterial {
  id: string
  libraryItemId: string
  required: boolean
}

export interface CurriculumExercise {
  id: string
  title: string
  prompt: string
  completed: boolean
}

export interface CurriculumModule {
  id: string
  title: string
  summary: string
  materials: CurriculumMaterial[]
  exercises: CurriculumExercise[]
}

export type CurriculumStatus = 'active' | 'planned' | 'completed'

export interface Curriculum {
  slug: string
  title: string
  goal: string
  status: CurriculumStatus
  modules: CurriculumModule[]
}

export interface ReviewDeck {
  id: string
  title: string
  curriculumSlug: string
  description: string
}

export type CardRating = 'again' | 'hard' | 'good' | 'easy'

export interface ReviewCard {
  id: string
  deckId: string
  front: string
  back: string
  sourceLibraryItemId: string
  dueAt: string
  lastRating?: CardRating
}

export interface Highlight {
  id: string
  materialId: string
  text: string
  createdAt: string
}

export interface Annotation {
  id: string
  materialId: string
  text: string
  highlightId?: string
  createdAt: string
}

export type QuestionKind = 'what' | 'why' | 'who' | 'when' | 'where' | 'how'

export interface Question {
  id: string
  materialId?: string
  kind: QuestionKind
  text: string
  answer?: string
  createdAt: string
}

export interface Area {
  id: string
  title: string
  intention: string
  archived: boolean
}

export type ProjectStatus = 'active' | 'planning' | 'paused' | 'completed'

export interface ProjectFeature {
  id: string
  title: string
  complete: boolean
}

export interface ProjectBug {
  id: string
  title: string
  resolved: boolean
}

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export interface Project {
  id: string
  areaId: string
  title: string
  purpose: string
  status: ProjectStatus
  features: ProjectFeature[]
  bugs: ProjectBug[]
  priority: Priority
}

export type DecisionStatus = 'open' | 'decided' | 'postponed'

export interface DecisionOption {
  id: string
  title: string
  rationale: string
}

export interface Decision {
  id: string
  projectId: string
  title: string
  context: string
  status: DecisionStatus
  options: DecisionOption[]
  selectedOptionId?: string
  blockedTaskIds: string[]
  postponedUntil?: string
}

export type Bucket = 'today' | 'next' | 'later' | 'someday'

export interface TaskStep {
  id: string
  title: string
  completed: boolean
}

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  priority: Priority
  bucket: Bucket
  completed: boolean
  steps: TaskStep[]
}

export interface Session {
  id: string
  projectId: string
  taskId?: string
  startedAt: string
  durationMinutes: number
  summary: string
}

export interface MockData {
  libraryItems: LibraryItem[]
  curricula: Curriculum[]
  reviewDecks: ReviewDeck[]
  reviewCards: ReviewCard[]
  highlights: Highlight[]
  annotations: Annotation[]
  questions: Question[]
  areas: Area[]
  projects: Project[]
  decisions: Decision[]
  tasks: Task[]
  sessions: Session[]
}
