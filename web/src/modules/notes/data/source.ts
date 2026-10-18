import type { components } from '@/api/notes'

/**
 * The notes records, as the contract defines them.
 *
 * Nothing is renamed on the way in: a field called `created_at` on the wire
 * stays `created_at` in the screens, because a view that reads `createdAt`
 * cannot be checked against `api/openapi/notes.yaml` by eye.
 */
export type NoteSourceRef = components['schemas']['NoteSource']
export type HighlightStatus = components['schemas']['HighlightStatus']
export type QuestionKind = components['schemas']['QuestionKind']
export type QuestionStatus = components['schemas']['QuestionStatus']
export type HighlightRecord = components['schemas']['Highlight']
export type AnnotationRecord = components['schemas']['Annotation']
export type QuestionRecord = components['schemas']['Question']
export type QuestionSetSummary = components['schemas']['QuestionSet']
export type QuestionSetRecord = components['schemas']['QuestionSetDetail']
export type ItemNoteRecord = components['schemas']['ItemNote']
export type NotesCounts = components['schemas']['NoteCounts']
export type NewHighlight = components['schemas']['NewHighlight']
export type NewAnnotation = components['schemas']['NewAnnotation']
export type NewQuestion = components['schemas']['NewQuestion']
export type QuestionPatch = components['schemas']['QuestionPatch']
export type NewQuestionSet = components['schemas']['NewQuestionSet']

/** The six prompts a question set offers, in the order its screen shows them. */
export const QUESTION_KINDS: QuestionKind[] = ['what', 'why', 'who', 'when', 'where', 'how']

/** The three lists the Notes screen is split into, named as its tabs are. */
export type NoteTab = 'highlights' | 'annotations' | 'questions'

/**
 * The filters a notes list is read with — every one of them a query parameter.
 *
 * The narrowing is the server's business and not the page's: a screen that
 * filtered the rows it already held would be filtering one page of fifty and
 * calling the result the answer.
 */
export interface NotesListQuery {
  item_id?: string
  set_id?: string
  status?: QuestionStatus
  q?: string
  cursor?: string
  limit?: number
}

/**
 * One page of rows. `next_cursor` is null on the last page rather than absent,
 * because a page the screen is holding always answers "is there more" with a
 * value.
 */
export interface NotesPage<TRow> {
  items: TRow[]
  next_cursor: string | null
}

/** What a reading screen shows in its margin, for one item. */
export interface ItemNotes {
  highlights: HighlightRecord[]
  annotations: AnnotationRecord[]
}

/**
 * Everything the notes screens read and write.
 *
 * Every mutation answers with the record as the server now holds it, which is
 * the only value a screen may display afterwards: a highlight comes back
 * `orphaned` when the passage could not be placed, and a screen showing what it
 * sent would claim the mark landed somewhere it did not.
 */
export interface NotesSource {
  listHighlights(query: NotesListQuery, signal: AbortSignal): Promise<NotesPage<HighlightRecord>>
  listAnnotations(query: NotesListQuery, signal: AbortSignal): Promise<NotesPage<AnnotationRecord>>
  listQuestions(query: NotesListQuery, signal: AbortSignal): Promise<NotesPage<QuestionRecord>>
  listQuestionSets(query: NotesListQuery, signal: AbortSignal): Promise<NotesPage<QuestionSetSummary>>
  /** Null when there is no such set, which is a "not found" page rather than an error. */
  questionSet(id: string, signal: AbortSignal): Promise<QuestionSetRecord | null>
  counts(signal: AbortSignal): Promise<NotesCounts>
  /** The highlights and annotations of one item, which is what a reader needs at once. */
  itemNotes(itemId: string, signal: AbortSignal): Promise<ItemNotes>
  /** Every question one item raised, whatever its state: the reader filters, not the source. */
  itemQuestions(itemId: string, signal: AbortSignal): Promise<QuestionRecord[]>
  itemNote(itemId: string, signal: AbortSignal): Promise<ItemNoteRecord>
  putItemNote(itemId: string, text: string): Promise<ItemNoteRecord>
  addHighlight(highlight: NewHighlight): Promise<HighlightRecord>
  deleteHighlight(id: string): Promise<void>
  addAnnotation(annotation: NewAnnotation): Promise<AnnotationRecord>
  updateAnnotation(id: string, text: string): Promise<AnnotationRecord>
  /**
   * Point a note that hangs on nothing at a passage.
   *
   * It is its own call rather than a field of `updateAnnotation`, because the
   * contract refuses to move a note between passages: the only change this can
   * make is from no passage to one, and a caller that could send a text and a
   * passage in one patch would read as if it could also move it.
   */
  attachAnnotationPassage(id: string, highlightId: string): Promise<AnnotationRecord>
  deleteAnnotation(id: string): Promise<void>
  addQuestion(question: NewQuestion): Promise<QuestionRecord>
  /** Only the fields present are applied; there is no delete, and `dropped` is how a question is let go. */
  updateQuestion(id: string, patch: QuestionPatch): Promise<QuestionRecord>
  addQuestionSet(set: NewQuestionSet): Promise<QuestionSetRecord>
}

/** The label each prompt of a question set is offered under. */
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  what: 'What',
  why: 'Why',
  who: 'Who',
  when: 'When',
  where: 'Where',
  how: 'How'
}
