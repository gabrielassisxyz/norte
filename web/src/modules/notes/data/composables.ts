import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import { describeFailure, useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { notesCountsRevision, notesRevision } from './revision'
import type {
  AnnotationRecord,
  HighlightRecord,
  ItemNoteRecord,
  ItemNotes,
  NoteTab,
  NotesCounts,
  NotesListQuery,
  NotesPage,
  NotesSource,
  QuestionRecord,
  QuestionSetRecord,
  QuestionSetSummary
} from './source'

/** One row of any of the three lists the Notes screen shows. */
export type NoteRow = HighlightRecord | AnnotationRecord | QuestionRecord

export interface NotesListResource<TRow> extends AsyncResource<NotesPage<TRow>> {
  /** True while a further page is on its way, which is not the first load. */
  loadingMore: Ref<boolean>
  /** Why the last "load more" failed, or null; the loaded rows stay. */
  loadMoreError: Ref<string | null>
  /** Whether the server said there is another page. */
  hasMore: ComputedRef<boolean>
  /** Ask for the page after the one being held, and append it. */
  loadMore: () => Promise<void>
  /** Put a created row at the front of the list it belongs to. */
  prepend: (row: TRow) => void
}

/** Which of the source's list calls a tab reads. */
type NotesListReader<TRow> = (
  source: NotesSource,
  query: NotesListQuery,
  signal: AbortSignal
) => Promise<NotesPage<TRow>>

/**
 * One paginated notes list, re-read whenever the query changes.
 *
 * A changed query supersedes the request in flight rather than racing it, which
 * is what keeps a fast typist from seeing the results of a filter they have
 * already moved past. `data.items` is every page loaded so far, not the last
 * one: "load more" is how the screen grows a list, so the value it renders
 * has to be the whole list and `next_cursor` the frontier of it.
 */
function useNotesList<TRow extends { id: string }>(
  read: NotesListReader<TRow>,
  query: MaybeRefOrGetter<NotesListQuery>,
  enabled: MaybeRefOrGetter<boolean> = true
): NotesListResource<TRow> {
  const { notes } = useSources()
  const loadingMore = ref(false)
  const loadMoreError = ref<string | null>(null)

  const resource = useAsyncResource<NotesPage<TRow>>(
    // A fresh read always starts at the first page: a cursor belongs to the
    // filters it was issued under, and the server refuses it under others.
    (signal) => read(notes, { ...toValue(query), cursor: undefined }, signal),
    { immediate: toValue(enabled) }
  )

  watch(
    [() => toValue(query), notesRevision, () => toValue(enabled)],
    () => {
      if (toValue(enabled)) void resource.refresh()
    },
    { deep: true }
  )

  const hasMore = computed(() => resource.data.value !== null && resource.data.value.next_cursor !== null)

  async function loadMore(): Promise<void> {
    const held = resource.data.value
    if (!held?.next_cursor || loadingMore.value) return
    loadingMore.value = true
    loadMoreError.value = null
    const controller = new AbortController()
    try {
      const page = await read(notes, { ...toValue(query), cursor: held.next_cursor }, controller.signal)
      const current = resource.data.value
      // The list may have been re-read under another filter while this page was
      // in flight; appending it then would mix two answers into one list.
      if (current !== held) return
      const known = new Set(held.items.map((row) => row.id))
      resource.data.value = {
        items: [...held.items, ...page.items.filter((row) => !known.has(row.id))],
        next_cursor: page.next_cursor
      }
    } catch (cause) {
      // Kept apart from `error`: that one replaces the whole list with the
      // load-error panel, and the rows already loaded are still good.
      loadMoreError.value = describeFailure(cause)
    } finally {
      loadingMore.value = false
    }
  }

  function prepend(row: TRow): void {
    const held = resource.data.value
    if (!held) return
    resource.data.value = { ...held, items: [row, ...held.items] }
  }

  return { ...resource, loadingMore, loadMoreError, hasMore, loadMore, prepend }
}

export function useNotesHighlights(
  query: MaybeRefOrGetter<NotesListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): NotesListResource<HighlightRecord> {
  return useNotesList((source, sent, signal) => source.listHighlights(sent, signal), query, enabled)
}

export function useNotesAnnotations(
  query: MaybeRefOrGetter<NotesListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): NotesListResource<AnnotationRecord> {
  return useNotesList((source, sent, signal) => source.listAnnotations(sent, signal), query, enabled)
}

export function useNotesQuestions(
  query: MaybeRefOrGetter<NotesListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): NotesListResource<QuestionRecord> {
  return useNotesList((source, sent, signal) => source.listQuestions(sent, signal), query, enabled)
}

export function useNotesQuestionSets(
  query: MaybeRefOrGetter<NotesListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): NotesListResource<QuestionSetSummary> {
  return useNotesList((source, sent, signal) => source.listQuestionSets(sent, signal), query, enabled)
}

export interface NotesQuestionSetResource extends AsyncResource<QuestionSetRecord | null> {
  apply: (set: QuestionSetRecord) => void
}

/**
 * One question set. `data` is null for a set that does not exist, which the
 * screen renders as its own page — `loading` is how "not answered yet" is told
 * apart from "not there".
 */
export function useNotesQuestionSet(id: MaybeRefOrGetter<string>): NotesQuestionSetResource {
  const { notes } = useSources()
  const resource = useAsyncResource((signal) => notes.questionSet(toValue(id), signal))

  watch(
    () => toValue(id),
    (nowId, previousId) => {
      if (previousId !== nowId) resource.data.value = null
      void resource.refresh()
    }
  )

  function apply(set: QuestionSetRecord): void {
    resource.data.value = set
  }

  return { ...resource, apply }
}

export interface ItemNotesResource extends AsyncResource<ItemNotes> {
  applyHighlight: (highlight: HighlightRecord) => void
  applyAnnotation: (annotation: AnnotationRecord) => void
  dropHighlight: (id: string) => void
}

/**
 * The highlights and annotations of one item, read only while the caller says
 * the crossing into the notes module is allowed.
 */
export function useItemNotes(
  itemId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): ItemNotesResource {
  const { notes } = useSources()
  const resource = useAsyncResource((signal) => notes.itemNotes(toValue(itemId), signal), {
    immediate: toValue(enabled)
  })

  /**
   * A creation anywhere in the reader re-reads this, unlike the paginated lists.
   *
   * `notesRevision` exists because a screen cannot place a row it did not
   * create, and both halves of the reader are that screen for each other: the
   * passage layer over the article and the panel under it hold separate copies
   * of one item's notes, so a highlight made in either was invisible in the
   * other until the page was reloaded. Re-reading costs one request and throws
   * nothing away here — this is every note of one item, not page one of fifty.
   */
  watch([() => toValue(itemId), () => toValue(enabled), notesRevision], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function applyHighlight(highlight: HighlightRecord): void {
    const current = resource.data.value
    if (!current) return
    resource.data.value = { ...current, highlights: [...current.highlights, highlight] }
  }

  function applyAnnotation(annotation: AnnotationRecord): void {
    const current = resource.data.value
    if (!current) return
    resource.data.value = { ...current, annotations: [...current.annotations, annotation] }
  }

  /** A deleted highlight takes the annotations that hung on it, as the schema does. */
  function dropHighlight(id: string): void {
    const current = resource.data.value
    if (!current) return
    resource.data.value = {
      highlights: current.highlights.filter((highlight) => highlight.id !== id),
      annotations: current.annotations.filter((annotation) => annotation.highlight_id !== id)
    }
  }

  return { ...resource, applyHighlight, applyAnnotation, dropHighlight }
}

export interface ItemNoteResource extends AsyncResource<ItemNoteRecord | null> {
  apply: (note: ItemNoteRecord) => void
}

/** The one freeform note an item carries, which is the reader's "Note" tab. */
export function useItemNote(
  itemId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): ItemNoteResource {
  const { notes } = useSources()
  const resource = useAsyncResource<ItemNoteRecord | null>(
    (signal) => notes.itemNote(toValue(itemId), signal),
    { immediate: toValue(enabled) }
  )

  watch([() => toValue(itemId), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function apply(note: ItemNoteRecord): void {
    resource.data.value = note
  }

  return { ...resource, apply }
}

/**
 * The counts the sidebar and the Notes tabs print, straight from `/counts`.
 *
 * They are never derived from the rows on screen: a count over one page of a
 * paginated list is the size of that page, which is not what any of these
 * labels claims to be.
 */
export function useNotesSummary(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<NotesCounts> {
  const { notes } = useSources()
  const resource = useAsyncResource((signal) => notes.counts(signal), { immediate: toValue(enabled) })

  watch([notesCountsRevision, () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  return resource
}

/** Which tab a row belongs to, for a screen that counts what it just created. */
export function noteTabOf(row: NoteRow): NoteTab {
  if ('exact' in row) return 'highlights'
  if ('status' in row) return 'questions'
  return 'annotations'
}
