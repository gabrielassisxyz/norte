export type LibraryKind = 'post' | 'livro' | 'paper' | 'video' | 'podcast' | 'curso'

/**
 * Where an item sits. Reading is not a place: an item that has been read keeps
 * the status it had and carries `unread`/`read_at` instead, so marking it read
 * does not move it out of the list the user put it in.
 */
export type LibraryStatus = 'inbox' | 'depois' | 'arquivo'

export type MaterialKind = Extract<LibraryKind, 'post' | 'livro' | 'paper'>

export interface LibraryItem {
  id: string
  kind: LibraryKind
  title: string
  author: string
  url: string
  domain?: string
  minutes?: number
  readProgress?: number
  status: LibraryStatus
  unread: boolean
  /** When it was read, and absent while `unread` is true. */
  read_at?: string
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

export interface CurriculumInstrumentRow {
  key: string
  value: string
}

/** A worksheet a module asks you to fill in, shown as a key/value table. */
export interface CurriculumInstrument {
  name: string
  rows: CurriculumInstrumentRow[]
  note?: string
}

export interface CurriculumModule {
  id: string
  title: string
  summary: string
  materials: CurriculumMaterial[]
  exercises: CurriculumExercise[]
  /** Planned span, used by the module ruler. */
  weeks?: number
  instrument?: CurriculumInstrument
  evaluation?: string
}

export type CurriculumStatus = 'active' | 'planned' | 'completed'

export interface Curriculum {
  slug: string
  title: string
  goal: string
  status: CurriculumStatus
  modules: CurriculumModule[]
  currentModule?: string
  currentLesson?: string
  currentItem?: number
  totalItems?: number
  progress?: number
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
  /** When the decision was opened, which is what the screen dates it by. */
  createdAt: string
  status: DecisionStatus
  options: DecisionOption[]
  selectedOptionId?: string
  /** Written when the choice is none of the recorded options. */
  reasoning?: string
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

/** A subject groups library material across curricula on the Estudo home. */
export interface Subject {
  id: string
  name: string
  curricula: number
  courses: number
  articles: number
  videos: number
  notes: number
  questions: number
  /** Short Portuguese recency label, e.g. "hoje" or "há 2d". */
  activity: string
}

/** One day of study activity backing the Estudo streak band and stats. */
export interface StudyDay {
  /** ISO date (YYYY-MM-DD). */
  date: string
  /** Minutes studied that day; 0 means no study. */
  minutes: number
  /** Items completed that day (exercises, materials, reviews). */
  completed: number
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
  subjects: Subject[]
  studyDays: StudyDay[]
}
