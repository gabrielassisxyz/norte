import createClient from 'openapi-fetch'

import { apiBaseUrl } from '@/api/client'
import type { paths } from '@/api/notes'

import type {
  AnnotationRecord,
  HighlightRecord,
  ItemNoteRecord,
  ItemNotes,
  NewAnnotation,
  NewHighlight,
  NewQuestion,
  NewQuestionSet,
  NotesCounts,
  NotesListQuery,
  NotesPage,
  NotesSource,
  QuestionRecord,
  QuestionSetRecord,
  QuestionSetSummary
} from './source'

/**
 * The notes module's own HTTP client, typed from `api/openapi/notes.yaml`.
 *
 * It is constructed here rather than beside the core client so that the core
 * client does not carry the notes paths. `main.ts` installs this source
 * unconditionally; whether the server lists the module decides only whether the
 * notes screens and the reader's notes actions are mounted, and an unmounted
 * one never calls it.
 */
const notesClient = createClient<paths>({ baseUrl: apiBaseUrl })

interface ApiFailure {
  error?: { code?: string; message?: string }
}

/**
 * The message a failed call reports.
 *
 * The contract's envelope carries a sentence written for a person, so that is
 * what the screen shows; a failure that arrived without one (a proxy, a dropped
 * connection) falls back to the status, which is still more than "erro".
 */
function failureMessage(failure: unknown, status: number): string {
  const detail = (failure as ApiFailure | undefined)?.error
  if (detail?.message) return detail.message
  if (detail?.code) return detail.code
  return `a resposta do servidor foi ${status || 'vazia'}`
}

function failureCode(failure: unknown): string | undefined {
  return (failure as ApiFailure | undefined)?.error?.code
}

interface Answered<T> {
  data?: T
  error?: unknown
  response: Response
}

/** The body of a successful call, or a thrown error carrying the API's message. */
function unwrap<T>(answered: Answered<T>): T {
  if (answered.error !== undefined || answered.data === undefined) {
    throw new Error(failureMessage(answered.error, answered.response?.status ?? 0))
  }
  return answered.data
}

/**
 * The query as the contract spells it.
 *
 * An absent filter and a filter set to an empty string are the same request --
 * "do not narrow by this" -- so neither reaches the wire.
 */
function listQuery(query: NotesListQuery): Record<string, string | number> {
  const sent: Record<string, string | number> = {}
  if (query.item_id) sent.item_id = query.item_id
  if (query.set_id) sent.set_id = query.set_id
  if (query.status) sent.status = query.status
  if (query.q?.trim()) sent.q = query.q.trim()
  if (query.cursor) sent.cursor = query.cursor
  if (query.limit) sent.limit = query.limit
  return sent
}

/** A list answer as the screens read it, with the cursor always a value. */
function page<TRow>(answered: { items: TRow[]; next_cursor?: string }): NotesPage<TRow> {
  return { items: answered.items, next_cursor: answered.next_cursor ?? null }
}

export function createApiNotesSource(): NotesSource {
  return {
    async listHighlights(query, signal) {
      const answered = await notesClient.GET('/api/notes/highlights', {
        params: { query: listQuery(query) },
        signal
      })
      return page(unwrap(answered as Answered<{ items: HighlightRecord[]; next_cursor?: string }>))
    },

    async listAnnotations(query, signal) {
      const answered = await notesClient.GET('/api/notes/annotations', {
        params: { query: listQuery(query) },
        signal
      })
      return page(unwrap(answered as Answered<{ items: AnnotationRecord[]; next_cursor?: string }>))
    },

    async listQuestions(query, signal) {
      const answered = await notesClient.GET('/api/notes/questions', {
        params: { query: listQuery(query) },
        signal
      })
      return page(unwrap(answered as Answered<{ items: QuestionRecord[]; next_cursor?: string }>))
    },

    async listQuestionSets(query, signal) {
      const answered = await notesClient.GET('/api/notes/question-sets', {
        params: { query: listQuery(query) },
        signal
      })
      return page(unwrap(answered as Answered<{ items: QuestionSetSummary[]; next_cursor?: string }>))
    },

    async questionSet(id, signal) {
      const answered = await notesClient.GET('/api/notes/question-sets/{id}', {
        params: { path: { id } },
        signal
      })
      // An id that is not there is a page of its own, not a failure to report.
      if (failureCode(answered.error) === 'not_found') return null
      return unwrap(answered as Answered<QuestionSetRecord>)
    },

    async counts(signal) {
      return unwrap((await notesClient.GET('/api/notes/counts', { signal })) as Answered<NotesCounts>)
    },

    /**
     * The two lists a reader needs are read in parallel, because they decorate
     * the same text: showing the highlights a moment before the notes that hang
     * on them would make the margin move under the person reading.
     */
    async itemNotes(itemId, signal): Promise<ItemNotes> {
      const [highlights, annotations] = await Promise.all([
        this.listHighlights({ item_id: itemId, limit: 200 }, signal),
        this.listAnnotations({ item_id: itemId, limit: 200 }, signal)
      ])
      return { highlights: highlights.items, annotations: annotations.items }
    },

    async itemNote(itemId, signal) {
      const answered = await notesClient.GET('/api/notes/items/{item_id}/note', {
        params: { path: { item_id: itemId } },
        signal
      })
      return unwrap(answered as Answered<ItemNoteRecord>)
    },

    async putItemNote(itemId, text) {
      const answered = await notesClient.PUT('/api/notes/items/{item_id}/note', {
        params: { path: { item_id: itemId } },
        body: { text }
      })
      return unwrap(answered as Answered<ItemNoteRecord>)
    },

    async addHighlight(highlight: NewHighlight) {
      const answered = await notesClient.POST('/api/notes/highlights', { body: highlight })
      return unwrap(answered as Answered<HighlightRecord>)
    },

    async deleteHighlight(id: string) {
      const answered = await notesClient.DELETE('/api/notes/highlights/{id}', {
        params: { path: { id } }
      })
      if (answered.error !== undefined) {
        throw new Error(failureMessage(answered.error, answered.response?.status ?? 0))
      }
    },

    async addAnnotation(annotation: NewAnnotation) {
      const answered = await notesClient.POST('/api/notes/annotations', { body: annotation })
      return unwrap(answered as Answered<AnnotationRecord>)
    },

    async addQuestion(question: NewQuestion) {
      const answered = await notesClient.POST('/api/notes/questions', { body: question })
      return unwrap(answered as Answered<QuestionRecord>)
    },

    async addQuestionSet(set: NewQuestionSet) {
      const answered = await notesClient.POST('/api/notes/question-sets', { body: set })
      return unwrap(answered as Answered<QuestionSetRecord>)
    }
  }
}
