<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { ReaderLiveSelection, ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { useItemNotes } from '../data/composables'
import { annotationAwaitingPassage } from '../data/passageAttach'
import { notesGainedNote } from '../data/revision'
import type { AnnotationRecord, HighlightRecord } from '../data/source'
import { markPassage } from './passageMarking'
import ReaderSelectionToolbar, { type ToolbarAnchor } from './ReaderSelectionToolbar.vue'

/**
 * Highlighting what the person selected, and marking in the text what is
 * already highlighted.
 *
 * Selecting is the whole gesture: a passage released inside the article is
 * highlighted at once and the toolbar opens over it, so nothing has to be
 * confirmed and no control has to be found. What is then done with the
 * highlight — undone, annotated, questioned, copied — belongs to the toolbar.
 *
 * It fills the reader's `bottom-actions` slot and renders nothing of its own
 * there: the toolbar is placed against the window, and what is left in the flow
 * is the notice a passage the server could not place produces.
 *
 * The marking is redone on every render rather than once. `content_html` is
 * inserted with `v-html`, so a re-extraction replaces the whole subtree and
 * every wrapper this put in the text is gone with it; `renderedAt` is what says
 * so.
 */
const props = defineProps<ReaderSlotProps>()

const { notes } = useSources()
const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))
const writing = useAsyncAction()

const {
  data: notesOfItem,
  applyHighlight,
  applyAnnotation,
  replaceAnnotation,
  dropHighlight
} = useItemNotes(
  () => props.itemId,
  () => allowed.value
)

/**
 * Why the server kept the passage without a position, or null when it placed it.
 *
 * The two reasons are different facts about the text and read differently to the
 * person: a repeated passage is in the article more than once and the server
 * refuses to choose, while a passage it could not find is not in the article at
 * all. Only the create response tells them apart — `ambiguous` is not stored,
 * so a later read cannot — which is why it is recorded here as it arrives.
 */
type UnplacedReason = 'repeated' | 'missing'

const UNPLACED_NOTICES: Record<UnplacedReason, string> = {
  repeated: 'repeated passage: highlight kept without a position',
  missing: 'passage not found in this text: highlight kept without a position'
}

const unplacedReason = ref<UnplacedReason | null>(null)

/** The passage the toolbar is open for, with the rectangle it was opened against. */
const open = ref<{ highlight: HighlightRecord; rect: ToolbarAnchor } | null>(null)

/**
 * The selection a highlight has already been made for.
 *
 * The reader reports a selection from a mouse, from a key and from
 * `selectionchange`, and marking the passage changes the DOM under that
 * selection, which reports it again — so without this the one gesture sent
 * several creates. It is cleared when the toolbar closes, because selecting the
 * same words again is a person asking for the passage back.
 */
const handled = ref<string | null>(null)

function signatureOf(selected: ReaderLiveSelection): string {
  return [selected.exact, selected.prefix, selected.suffix].join('\u0000')
}

const anchored = computed(() =>
  (notesOfItem.value?.highlights ?? []).filter((highlight) => highlight.status === 'anchored')
)

/** The item's notes that hang on no passage, which the toolbar offers to attach. */
const looseNotes = computed<AnnotationRecord[]>(() =>
  (notesOfItem.value?.annotations ?? []).filter((annotation) => !annotation.highlight_id)
)

const notesOnOpenPassage = computed(() => {
  const id = open.value?.highlight.id
  if (!id) return 0
  return (notesOfItem.value?.annotations ?? []).filter((annotation) => annotation.highlight_id === id).length
})

function rectOf(element: Element): ToolbarAnchor {
  const box = element.getBoundingClientRect()
  return { top: box.top, bottom: box.bottom, left: box.left, width: box.width }
}

/**
 * The first line of what is selected, which is what the toolbar sits over.
 *
 * A selection spanning several lines has one rectangle per line, and the union
 * of them is as wide as the column: placing the toolbar over that would centre
 * it on the paragraph rather than on the words.
 */
function rectOfSelection(): ToolbarAnchor | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const rects = selection.getRangeAt(0).getClientRects()
  const first = rects.length > 0 ? rects[0] : selection.getRangeAt(0).getBoundingClientRect()
  return { top: first.top, bottom: first.bottom, left: first.left, width: first.width }
}

/** The marks this passage has in the text now, in document order. */
function marksOf(exact: string): HTMLElement[] {
  const root = props.articleRoot
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-notes-passage]')).filter(
    (mark) => mark.dataset.notesPassage === exact
  )
}

/**
 * Where the toolbar should be, asked again on every scroll.
 *
 * The mark in the text is preferred over the rectangle the toolbar was opened
 * with, because the mark is still there after the article has scrolled and the
 * selection may not be. A passage the text does not single out has no mark, and
 * then the rectangle it was opened with is all there is.
 */
function measureAnchor(): ToolbarAnchor | null {
  const current = open.value
  if (!current) return null
  const marks = marksOf(current.highlight.exact)
  return marks.length > 0 ? rectOf(marks[0]) : current.rect
}

function close(): void {
  open.value = null
  handled.value = null
}

/**
 * Highlight what was just released, once per selection.
 *
 * The browser's own selection is dropped as soon as the highlight exists: what
 * stands for the passage from then on is the mark, and leaving the blue
 * selection over it would show the person two overlapping claims about the same
 * words.
 */
async function highlightSelection(selected: ReaderLiveSelection): Promise<void> {
  const signature = signatureOf(selected)
  if (handled.value === signature) return
  handled.value = signature
  unplacedReason.value = null
  const rect = rectOfSelection()
  const created = await writing.run(() =>
    notes.addHighlight({
      item_id: props.itemId,
      exact: selected.exact,
      prefix: selected.prefix,
      suffix: selected.suffix
    })
  )
  if (!created) {
    handled.value = null
    return
  }
  applyHighlight(created)
  if (created.status === 'orphaned') {
    unplacedReason.value = created.ambiguous === true ? 'repeated' : 'missing'
  }
  notesGainedNote()
  window.getSelection()?.removeAllRanges()
  props.clearSelection()
  open.value = { highlight: created, rect: rect ?? { top: 0, bottom: 0, left: 0, width: 0 } }
}

watch(
  () => props.liveSelection,
  (selected) => {
    if (!allowed.value || !selected) return
    // A selection made to attach a loose note is the panel's: it makes the
    // highlight itself and links the note to it, and a second highlight from
    // here would be the same words stored twice with a toolbar over them.
    if (annotationAwaitingPassage()) return
    void highlightSelection(selected)
  }
)

/**
 * Clicking a passage already in the text opens the same toolbar for it.
 *
 * The mark carries the passage's text and not its id, because the id is not
 * what finds it again after a re-extraction; the item's own highlights are
 * where the record comes from.
 */
function handleArticleClick(event: MouseEvent): void {
  if (!allowed.value) return
  const target = event.target
  if (!(target instanceof Element)) return
  const mark = target.closest('[data-notes-passage]')
  if (!(mark instanceof HTMLElement)) return
  const found = anchored.value.find((highlight) => highlight.exact === mark.dataset.notesPassage)
  if (!found) return
  unplacedReason.value = null
  handled.value = null
  open.value = { highlight: found, rect: rectOf(mark) }
}

watch(
  () => props.articleRoot,
  (root, previous) => {
    previous?.removeEventListener('click', handleArticleClick)
    root?.addEventListener('click', handleArticleClick)
  },
  { immediate: true }
)

onBeforeUnmount(() => props.articleRoot?.removeEventListener('click', handleArticleClick))

/**
 * Wrap each anchored passage where it appears in the rendered article.
 *
 * The passage is located by its words and the context stored with it, not by
 * the first text that happens to contain it, and is wrapped one text node at a
 * time so it can cross an inline element. A passage the article no longer
 * singles out is left unmarked; it is still listed beside the text.
 */
function markPassages(): void {
  const root = props.articleRoot
  if (!root) return
  for (const existing of root.querySelectorAll('[data-notes-passage]')) {
    const text = existing.textContent ?? ''
    existing.replaceWith(document.createTextNode(text))
  }
  root.normalize()
  for (const highlight of anchored.value) {
    markPassage(root, highlight)
  }
}

watch([() => props.renderedAt, () => props.articleRoot, anchored], markPassages, { immediate: true })

function onRemoved(id: string): void {
  dropHighlight(id)
  // The margin list is another copy of this item's notes, so it only learns
  // the passage is gone by reading again.
  notesGainedNote()
  close()
}

function onAnnotated(annotation: AnnotationRecord): void {
  applyAnnotation(annotation)
  notesGainedNote()
  close()
}

function onAttached(annotation: AnnotationRecord): void {
  replaceAnnotation(annotation)
  notesGainedNote()
  close()
}

function onQuestioned(): void {
  // The question is held by the panel's own copy of the item's questions, and
  // nothing here holds one to place it in.
  notesGainedNote()
  close()
}
</script>

<template>
  <div v-if="allowed" class="notes-highlight-action">
    <ReaderSelectionToolbar
      v-if="open"
      :item-id="itemId"
      :highlight="open.highlight"
      :measure="measureAnchor"
      :loose-notes="looseNotes"
      :notes-on-passage="notesOnOpenPassage"
      @close="close"
      @removed="onRemoved"
      @annotated="onAnnotated"
      @attached="onAttached"
      @questioned="onQuestioned"
    />
    <p
      v-if="unplacedReason"
      class="notes-highlight-notice"
      role="status"
      :data-notes-unplaced="unplacedReason"
    >
      {{ UNPLACED_NOTICES[unplacedReason] }}
    </p>
    <p v-if="writing.error.value" class="notes-highlight-error" role="alert">
      Could not highlight: {{ writing.error.value }}
    </p>
  </div>
</template>

<style scoped>
.notes-highlight-action:not(:empty) { margin-top: var(--space-4); }
.notes-highlight-notice { margin: var(--space-2) 0 0; color: var(--ink-2); font-size: 13px; line-height: 20px; }
.notes-highlight-error { margin: var(--space-2) 0 0; color: var(--danger); font-size: 13px; line-height: 20px; }

/* Inside the reader's bar the notices are the bar's own cell, with no frame. */
@media (max-width: 900px) {
  .notes-highlight-action:not(:empty) { margin-top: 0; }
}
</style>
