import type { Page } from '@/lib/page'
import type { Annotation, Highlight, LibraryKind, QuestionKind } from '@/mock/types'

/** The three lists the notes screen is split into, named as its tabs are. */
export type NoteTab = 'highlights' | 'anotacoes' | 'perguntas'

/** The material a note sits on, as much of it as a note row shows. */
export interface NoteSourceRef {
  id: string
  kind: LibraryKind
  title: string
  author: string
}

/**
 * One note of any of the three kinds. They are one record because the screen
 * filters, counts and lists them the same way, and the kind-specific fields are
 * the two a question carries.
 */
export interface NoteRecord {
  id: string
  tab: NoteTab
  text: string
  createdAt: string
  questionKind?: QuestionKind
  answer?: string
  source?: NoteSourceRef
}

export interface NotesCounts {
  highlights: number
  anotacoes: number
  perguntas: number
}

export type NotesList = Page<NoteRecord, NotesCounts>

/** What a reading screen shows in its margin, for one material. */
export interface MaterialNotes {
  highlights: Highlight[]
  annotations: Annotation[]
}

export interface NewQuestion {
  materialId?: string
  kind: QuestionKind
  text: string
}

export interface NotesSource {
  listNotes(query: { tab: NoteTab; search?: string }, signal: AbortSignal): Promise<NotesList>
  materialNotes(materialId: string, signal: AbortSignal): Promise<MaterialNotes>
  summary(signal: AbortSignal): Promise<NotesCounts>
  addQuestion(question: NewQuestion): Promise<NoteRecord>
  addHighlight(highlight: { materialId: string; text: string }): Promise<Highlight>
  addAnnotation(annotation: { materialId: string; text: string; highlightId?: string }): Promise<Annotation>
}
