import type {
  AnnotationRecord,
  HighlightRecord,
  ItemNoteRecord,
  ItemNotes,
  NewAnnotation,
  NewHighlight,
  NewQuestion,
  NewQuestionSet,
  NoteSourceRef,
  NotesCounts,
  NotesListQuery,
  NotesPage,
  NotesSource,
  QuestionRecord,
  QuestionSetRecord,
  QuestionSetSummary
} from './source'

/**
 * A notes source a test drives, holding its records in memory.
 *
 * It is here rather than in a test file because several suites need it — the
 * Notas screen, the reader's actions, the question-set screen, the shell's
 * sidebar — and because the filtering and the cursor have to behave the way the
 * server does for a filter or a pagination test to mean anything. The
 * application never constructs it: `main.ts` installs the API source.
 */
const DEFAULT_LIMIT = 50

export function noteSource(overrides: Partial<NoteSourceRef> = {}): NoteSourceRef {
  const id = overrides.id ?? 'item-1'
  return { id, module: 'library', type: 'article', title: `Texto ${id}`, ...overrides }
}

export function highlightRecord(overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  const id = overrides.id ?? 'highlight-1'
  return {
    id,
    item_id: 'item-1',
    exact: `Trecho ${id}`,
    prefix: '',
    suffix: '',
    position_hint: 0,
    status: 'anchored',
    created_at: '2026-10-08T12:00:00Z',
    source: noteSource(),
    ...overrides
  }
}

export function annotationRecord(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  const id = overrides.id ?? 'annotation-1'
  return {
    id,
    item_id: 'item-1',
    text: `Anotação ${id}`,
    created_at: '2026-10-08T12:00:00Z',
    updated_at: '2026-10-08T12:00:00Z',
    source: noteSource(),
    ...overrides
  }
}

export function questionRecord(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  const id = overrides.id ?? 'question-1'
  return {
    id,
    text: `Pergunta ${id}?`,
    status: 'open',
    created_at: '2026-10-08T12:00:00Z',
    updated_at: '2026-10-08T12:00:00Z',
    ...overrides
  }
}

export function questionSetRecord(overrides: Partial<QuestionSetRecord> = {}): QuestionSetRecord {
  const id = overrides.id ?? 'set-1'
  return {
    id,
    topic: `Tema ${id}`,
    question_count: 0,
    created_at: '2026-10-08T12:00:00Z',
    questions: [],
    ...overrides
  }
}

/** Every call a test may want to assert on, in the order they were made. */
export interface FakeNotesCalls {
  highlights: NotesListQuery[]
  annotations: NotesListQuery[]
  questions: NotesListQuery[]
  sets: NotesListQuery[]
  counts: number
  itemNotes: string[]
  addedHighlights: NewHighlight[]
  deletedHighlights: string[]
  addedAnnotations: NewAnnotation[]
  addedQuestions: NewQuestion[]
  addedSets: NewQuestionSet[]
  writtenNotes: Array<{ itemId: string; text: string }>
}

export interface FakeNotesSource extends NotesSource {
  held: {
    highlights: HighlightRecord[]
    annotations: AnnotationRecord[]
    questions: QuestionRecord[]
    sets: QuestionSetRecord[]
    itemNotes: Map<string, string>
  }
  calls: FakeNotesCalls
}

export interface FakeNotesRecords {
  highlights?: HighlightRecord[]
  annotations?: AnnotationRecord[]
  questions?: QuestionRecord[]
  sets?: QuestionSetRecord[]
  itemNotes?: Record<string, string>
}

/** The server's own narrowing: the row's text, or its source item's title. */
function matches(query: NotesListQuery, text: string, source?: NoteSourceRef, itemId?: string): boolean {
  if (query.item_id && query.item_id !== itemId) return false
  const needle = query.q?.trim().toLocaleLowerCase('en')
  if (!needle) return true
  const haystack = `${text} ${source?.title ?? ''}`.toLocaleLowerCase('en')
  return haystack.includes(needle)
}

/**
 * One page of rows, with the cursor the offset it was issued at.
 *
 * It is the simplest token that still makes a second page a different page,
 * which is all a screen's "carregar mais" can be asked to prove.
 */
function paged<TRow>(rows: TRow[], query: NotesListQuery): NotesPage<TRow> {
  const from = query.cursor ? Number(query.cursor) : 0
  const limit = query.limit ?? DEFAULT_LIMIT
  const page = rows.slice(from, from + limit)
  return { items: page, next_cursor: from + limit < rows.length ? String(from + limit) : null }
}

export function fakeNotesSource(
  records: FakeNotesRecords = {},
  overrides: Partial<NotesSource> = {}
): FakeNotesSource {
  const held = {
    highlights: [...(records.highlights ?? [])],
    annotations: [...(records.annotations ?? [])],
    questions: [...(records.questions ?? [])],
    sets: [...(records.sets ?? [])],
    itemNotes: new Map(Object.entries(records.itemNotes ?? {}))
  }
  const calls: FakeNotesCalls = {
    highlights: [],
    annotations: [],
    questions: [],
    sets: [],
    counts: 0,
    itemNotes: [],
    addedHighlights: [],
    deletedHighlights: [],
    addedAnnotations: [],
    addedQuestions: [],
    addedSets: [],
    writtenNotes: []
  }

  const source: FakeNotesSource = {
    held,
    calls,

    async listHighlights(query) {
      calls.highlights.push({ ...query })
      return paged(
        held.highlights.filter((row) => matches(query, row.exact, row.source, row.item_id)),
        query
      )
    },

    async listAnnotations(query) {
      calls.annotations.push({ ...query })
      return paged(
        held.annotations.filter((row) => matches(query, row.text, row.source, row.item_id)),
        query
      )
    },

    async listQuestions(query) {
      calls.questions.push({ ...query })
      return paged(
        held.questions.filter(
          (row) =>
            matches(query, row.text, row.source, row.item_id) &&
            (!query.set_id || row.set_id === query.set_id) &&
            (!query.status || row.status === query.status)
        ),
        query
      )
    },

    async listQuestionSets(query) {
      calls.sets.push({ ...query })
      const summaries: QuestionSetSummary[] = held.sets
        .filter((row) => matches(query, row.topic))
        .map((row) => ({
          id: row.id,
          topic: row.topic,
          question_count: row.question_count,
          created_at: row.created_at
        }))
      return paged(summaries, query)
    },

    async questionSet(id) {
      return held.sets.find((row) => row.id === id) ?? null
    },

    async counts(): Promise<NotesCounts> {
      calls.counts += 1
      return {
        highlights: held.highlights.length,
        anotacoes: held.annotations.length,
        perguntas: held.questions.length,
        conjuntos: held.sets.length
      }
    },

    async itemNotes(itemId): Promise<ItemNotes> {
      calls.itemNotes.push(itemId)
      return {
        highlights: held.highlights.filter((row) => row.item_id === itemId),
        annotations: held.annotations.filter((row) => row.item_id === itemId)
      }
    },

    async itemNote(itemId): Promise<ItemNoteRecord> {
      const text = held.itemNotes.get(itemId)
      if (text === undefined) return { item_id: itemId, text: '' }
      return { id: `note-${itemId}`, item_id: itemId, text }
    },

    async putItemNote(itemId, text): Promise<ItemNoteRecord> {
      calls.writtenNotes.push({ itemId, text })
      const trimmed = text.trim()
      if (!trimmed) {
        held.itemNotes.delete(itemId)
        return { item_id: itemId, text: '' }
      }
      held.itemNotes.set(itemId, trimmed)
      return { id: `note-${itemId}`, item_id: itemId, text: trimmed }
    },

    async addHighlight(highlight) {
      calls.addedHighlights.push({ ...highlight })
      const created = highlightRecord({
        id: `highlight-${held.highlights.length + 1}`,
        item_id: highlight.item_id,
        exact: highlight.exact,
        prefix: highlight.prefix ?? '',
        suffix: highlight.suffix ?? ''
      })
      held.highlights.unshift(created)
      return created
    },

    async deleteHighlight(id) {
      calls.deletedHighlights.push(id)
      held.highlights = held.highlights.filter((row) => row.id !== id)
      held.annotations = held.annotations.filter((row) => row.highlight_id !== id)
    },

    async addAnnotation(annotation) {
      calls.addedAnnotations.push({ ...annotation })
      const created = annotationRecord({
        id: `annotation-${held.annotations.length + 1}`,
        item_id: annotation.item_id,
        text: annotation.text,
        ...(annotation.highlight_id ? { highlight_id: annotation.highlight_id } : {})
      })
      held.annotations.unshift(created)
      return created
    },

    async addQuestion(question) {
      calls.addedQuestions.push({ ...question })
      const created = questionRecord({
        id: `question-${held.questions.length + 1}`,
        text: question.text,
        ...(question.item_id ? { item_id: question.item_id, source: noteSource({ id: question.item_id }) } : {}),
        ...(question.annotation_id ? { annotation_id: question.annotation_id } : {}),
        ...(question.set_id ? { set_id: question.set_id } : {}),
        ...(question.kind ? { kind: question.kind } : {})
      })
      held.questions.unshift(created)
      return created
    },

    async addQuestionSet(set) {
      calls.addedSets.push({ ...set })
      const id = `set-${held.sets.length + 1}`
      // Only the prompts carrying text become questions, which is the rule the
      // server applies: a blank prompt is a question nobody asked.
      const written = (set.questions ?? []).filter((prompt) => prompt.text.trim() !== '')
      const questions = written.map((prompt, index) =>
        questionRecord({
          id: `${id}-question-${index + 1}`,
          text: prompt.text.trim(),
          kind: prompt.kind,
          set_id: id
        })
      )
      const created = questionSetRecord({
        id,
        topic: set.topic,
        question_count: questions.length,
        questions
      })
      held.sets.unshift(created)
      held.questions.unshift(...questions)
      return created
    },

    ...overrides
  }

  return source
}
