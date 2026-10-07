import { toValue, watch, type MaybeRefOrGetter } from 'vue'

import { useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import type { Annotation, Highlight } from '@/mock/types'
import { useSources } from '@/sources'

import type { MaterialNotes, NoteRecord, NoteTab, NotesCounts, NotesList } from './source'

export interface NotesResource extends AsyncResource<NotesList> {
  /** Put a created note at the front of the list it belongs to. */
  prependNote: (note: NoteRecord) => void
}

export function useNotes(query: MaybeRefOrGetter<{ tab: NoteTab; search?: string }>): NotesResource {
  const { notes } = useSources()
  const resource = useAsyncResource((signal) => notes.listNotes(toValue(query), signal))

  watch(
    () => toValue(query),
    () => {
      void resource.refresh()
    },
    { deep: true }
  )

  function prependNote(note: NoteRecord): void {
    const page = resource.data.value
    if (!page) return
    const counts: NotesCounts = { ...page.counts, [note.tab]: page.counts[note.tab] + 1 }
    const belongs = toValue(query).tab === note.tab
    resource.data.value = { ...page, items: belongs ? [note, ...page.items] : page.items, counts }
  }

  return { ...resource, prependNote }
}

export interface MaterialNotesResource extends AsyncResource<MaterialNotes> {
  applyHighlight: (highlight: Highlight) => void
  applyAnnotation: (annotation: Annotation) => void
}

/**
 * The highlights and annotations of one material, read only while the caller
 * says the crossing into the notes module is allowed.
 */
export function useMaterialNotes(
  materialId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): MaterialNotesResource {
  const { notes } = useSources()
  const resource = useAsyncResource((signal) => notes.materialNotes(toValue(materialId), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(materialId), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function applyHighlight(highlight: Highlight): void {
    const current = resource.data.value
    if (!current) return
    resource.data.value = { ...current, highlights: [...current.highlights, highlight] }
  }

  function applyAnnotation(annotation: Annotation): void {
    const current = resource.data.value
    if (!current) return
    resource.data.value = { ...current, annotations: [...current.annotations, annotation] }
  }

  return { ...resource, applyHighlight, applyAnnotation }
}

export function useNotesSummary(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<NotesCounts> {
  const { notes } = useSources()
  return useAsyncResource((signal) => notes.summary(signal), { immediate: toValue(enabled) })
}
