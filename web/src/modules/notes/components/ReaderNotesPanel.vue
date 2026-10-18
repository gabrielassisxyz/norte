<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Button from '@/components/ds/Button.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { describeFailure, useAsyncAction } from '@/lib/asyncResource'
import type { ReaderLiveSelection, ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { useItemNote, useItemNotes, useItemQuestions } from '../data/composables'
import { annotationAwaitingPassage, beginPassageAttach, endPassageAttach } from '../data/passageAttach'
import { noteChanged, notesGainedNote } from '../data/revision'
import type { AnnotationRecord, HighlightRecord, QuestionRecord } from '../data/source'

/**
 * Everything a reading leaves behind, under the article: the notes in the
 * margin, the one note for the whole text, the passages that are no longer in
 * the text, and the question the reading raised.
 *
 * It renders through the reader's slot, so the library never names this module
 * and a reader with notes switched off renders none of it. On a phone that slot
 * is the bottom sheet, and the reader hands over the section whoever opened the
 * sheet asked for — `annotations`, `note` or `question`, names this module chose
 * and the reader passes along without reading.
 */
const props = defineProps<ReaderSlotProps>()

type PanelTab = 'margin' | 'note'

/**
 * One row of the margin. `highlight` is the anchored passage the row can jump
 * to, or null for a row that hangs on nothing in the text.
 */
type MarginEntry =
  | { kind: 'passage'; key: string; highlight: HighlightRecord }
  | {
      kind: 'annotation'
      key: string
      annotation: AnnotationRecord
      highlight: HighlightRecord | null
      /** A second or later note on one passage, which does not repeat the quote. */
      continued: boolean
    }
  | { kind: 'question'; key: string; question: QuestionRecord; highlight: HighlightRecord | null }

/** The row being rewritten in place, with what its box holds now. */
interface MarginEdit {
  key: string
  draft: string
  error: string
}

const { notes } = useSources()
const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))

const tab = ref<PanelTab>('margin')
const annotationDraft = ref('')
const annotationTarget = ref('')
const noteDraft = ref('')
const questionDraft = ref('')
const questionAnnotation = ref('')
const questionError = ref('')
const questionField = ref<HTMLTextAreaElement>()
const editing = ref<MarginEdit | null>(null)

const writing = useAsyncAction()

const {
  data: itemNotes,
  applyHighlight,
  applyAnnotation,
  replaceAnnotation,
  dropAnnotation,
  dropHighlight,
  refresh: refreshItemNotes
} = useItemNotes(
  () => props.itemId,
  () => allowed.value
)
const { data: itemQuestions, applyQuestion } = useItemQuestions(
  () => props.itemId,
  () => allowed.value
)
const { data: itemNote, apply: applyItemNote } = useItemNote(
  () => props.itemId,
  () => allowed.value
)

const highlights = computed(() => itemNotes.value?.highlights ?? [])
const annotations = computed(() => itemNotes.value?.annotations ?? [])
const orphaned = computed(() => highlights.value.filter((highlight) => highlight.status === 'orphaned'))

/** Oldest first, by the fixed-width UTC text the server writes, then by id. */
function byCreation(first: { created_at: string; id: string }, second: { created_at: string; id: string }): number {
  if (first.created_at !== second.created_at) return first.created_at < second.created_at ? -1 : 1
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

/**
 * The margin, as one list in reading order: every passage at its place in the
 * text, each note on it, and each question a note became right after that
 * note; then what hangs on nothing in the text, oldest first.
 *
 * A passage with no note is still a row, because it is the thing the person
 * marked and the row is where its note gets written. A dropped question is
 * left out: it was let go, and the Questions screen still lists it under its
 * state. A note on a passage the text no longer holds stays out too, as it
 * did before; its passage is listed in its own section below.
 */
const marginEntries = computed<MarginEntry[]>(() => {
  const anchored = highlights.value
    .filter((highlight) => highlight.status === 'anchored')
    .sort((first, second) => first.position_hint - second.position_hint || byCreation(first, second))
  const anchoredIds = new Set(anchored.map((highlight) => highlight.id))
  const listed = annotations.value
    .filter((annotation) => !annotation.highlight_id || anchoredIds.has(annotation.highlight_id))
    .sort(byCreation)
  const listedIds = new Set(listed.map((annotation) => annotation.id))
  const questions = (itemQuestions.value ?? []).filter((question) => question.status !== 'dropped').sort(byCreation)

  const entries: MarginEntry[] = []
  const pushAnnotation = (annotation: AnnotationRecord, highlight: HighlightRecord | null, continued: boolean) => {
    entries.push({ kind: 'annotation', key: `annotation-${annotation.id}`, annotation, highlight, continued })
    for (const question of questions.filter((candidate) => candidate.annotation_id === annotation.id)) {
      entries.push({ kind: 'question', key: `question-${question.id}`, question, highlight })
    }
  }

  for (const highlight of anchored) {
    const notesOnIt = listed.filter((annotation) => annotation.highlight_id === highlight.id)
    if (notesOnIt.length === 0) entries.push({ kind: 'passage', key: `passage-${highlight.id}`, highlight })
    notesOnIt.forEach((annotation, index) => pushAnnotation(annotation, highlight, index > 0))
  }

  const loose: Array<AnnotationRecord | QuestionRecord> = [
    ...listed.filter((annotation) => !annotation.highlight_id),
    ...questions.filter((question) => !question.annotation_id || !listedIds.has(question.annotation_id))
  ].sort(byCreation)
  for (const row of loose) {
    if ('status' in row) entries.push({ kind: 'question', key: `question-${row.id}`, question: row, highlight: null })
    else pushAnnotation(row, null, false)
  }
  return entries
})

const tabs = computed(() => [
  { value: 'margin', label: 'Annotations', count: marginEntries.value.length },
  { value: 'note', label: 'Note' }
])

// The note's text is the server's answer, not the box's: a draft typed and then
// abandoned must not come back as the note on the next read.
watch(
  () => itemNote.value?.text,
  (text) => {
    noteDraft.value = text ?? ''
  },
  { immediate: true }
)

function selectTab(value: string): void {
  if (value === 'margin' || value === 'note') tab.value = value
}

/**
 * Show the part of the panel the reader was asked for.
 *
 * The question form is always rendered, below both tabs, so a request for it
 * puts the cursor in it rather than switching anything: on a phone the sheet
 * opens scrolled to the top and the form is off the bottom of it, which is the
 * same "the control is somewhere else" problem the sheet exists to solve.
 */
watch(
  () => props.notesSection,
  async (request) => {
    if (!request) return
    if (request.section === 'annotations') tab.value = 'margin'
    // `note` is the section the reader's own `?notes=note` deep link carries,
    // and the note search entry on the server builds that address. The other
    // section names are still this module's and are translated with it.
    if (request.section === 'note') tab.value = 'note'
    if (request.section !== 'question') return
    await nextTick()
    questionField.value?.scrollIntoView({ block: 'nearest' })
    questionField.value?.focus()
  }
)

/** Open the margin box against one passage, which is a note on that highlight. */
function annotate(highlightId: string): void {
  annotationTarget.value = highlightId
  tab.value = 'margin'
}

async function saveAnnotation(): Promise<void> {
  const text = annotationDraft.value.trim()
  if (!text) return
  const created = await writing.run(() =>
    notes.addAnnotation({
      item_id: props.itemId,
      text,
      ...(annotationTarget.value ? { highlight_id: annotationTarget.value } : {})
    })
  )
  if (!created) return
  applyAnnotation(created)
  notesGainedNote()
  annotationDraft.value = ''
  annotationTarget.value = ''
}

async function saveNote(): Promise<void> {
  const written = await writing.run(() => notes.putItemNote(props.itemId, noteDraft.value))
  if (!written) return
  applyItemNote(written)
  notesGainedNote()
}

/**
 * "Turn into a question" at the end of a reading.
 *
 * The trailing "?" is the same rule the Notes screen applies, because it is the
 * same thing being written: a question is a question wherever it is typed.
 */
async function turnIntoQuestion(): Promise<void> {
  const text = questionDraft.value.trim()
  if (!text.endsWith('?')) {
    questionError.value = 'A question has to end with “?”.'
    return
  }
  const created = await writing.run(() =>
    notes.addQuestion({
      item_id: props.itemId,
      text,
      ...(questionAnnotation.value ? { annotation_id: questionAnnotation.value } : {})
    })
  )
  if (!created) {
    questionError.value = `Could not save: ${writing.error.value ?? 'unknown error'}`
    return
  }
  // The margin holds the item's questions now, so the one written here is
  // placed from the answer rather than by making every copy read again.
  applyQuestion(created)
  noteChanged()
  questionDraft.value = ''
  questionAnnotation.value = ''
  questionError.value = ''
}

/** "Turn into question" on one note: the question box, pointing at that note. */
async function askAbout(annotation: AnnotationRecord): Promise<void> {
  questionAnnotation.value = annotation.id
  questionDraft.value = ''
  questionError.value = ''
  await nextTick()
  questionField.value?.scrollIntoView({ block: 'nearest' })
  questionField.value?.focus()
}

function entryText(entry: MarginEntry): string {
  if (entry.kind === 'annotation') return entry.annotation.text
  if (entry.kind === 'question') return entry.question.text
  return ''
}

async function startEdit(entry: MarginEntry): Promise<void> {
  editing.value = { key: entry.key, draft: entryText(entry), error: '' }
  await nextTick()
  document.getElementById('notes-reader-edit')?.focus()
}

async function saveEdit(entry: MarginEntry): Promise<void> {
  const edit = editing.value
  if (!edit || edit.key !== entry.key) return
  const text = edit.draft.trim()
  if (!text) return
  if (entry.kind === 'question' && !text.endsWith('?')) {
    edit.error = 'A question has to end with “?”.'
    return
  }
  if (entry.kind === 'annotation') {
    const updated = await writing.run(() => notes.updateAnnotation(entry.annotation.id, text))
    if (!updated) return
    replaceAnnotation(updated)
  } else if (entry.kind === 'question') {
    const updated = await writing.run(() => notes.updateQuestion(entry.question.id, { text }))
    if (!updated) return
    applyQuestion(updated)
  }
  noteChanged()
  editing.value = null
}

/**
 * Remove one row. A question has no delete: `dropped` is how the model lets
 * one go, and it stays on the Questions screen under that state, so it is the
 * one removal that asks nothing.
 */
async function removeEntry(entry: MarginEntry): Promise<void> {
  if (entry.kind === 'question') {
    const updated = await writing.run(() => notes.updateQuestion(entry.question.id, { status: 'dropped' }))
    if (!updated) return
    applyQuestion(updated)
    noteChanged()
    return
  }
  if (entry.kind === 'annotation') {
    if (!window.confirm('Delete this annotation?')) return
    const done = await writing.run(async () => {
      await notes.deleteAnnotation(entry.annotation.id)
      return true
    })
    if (!done) return
    dropAnnotation(entry.annotation.id)
    noteChanged()
    return
  }
  if (!window.confirm('Delete this highlighted passage?')) return
  const done = await writing.run(async () => {
    await notes.deleteHighlight(entry.highlight.id)
    return true
  })
  if (!done) return
  dropHighlight(entry.highlight.id)
  // The mark in the article belongs to another copy of this item's notes,
  // which only learns the passage is gone by reading again.
  notesGainedNote()
}

/* --------------------------------------------- attaching a note to a passage */

/**
 * The note whose passage is being picked, and what went wrong picking it.
 *
 * Which note is waiting is shared state rather than a ref here, because the
 * passage layer over the article has to read it too — see `passageAttach`.
 * The error is this panel's alone: it is the one that made the requests.
 */
const attaching = computed(() => annotationAwaitingPassage())
const attachError = ref('')
/** True from the selection being taken until both of its requests have answered. */
const attachingNow = ref(false)

function startAttach(annotation: AnnotationRecord): void {
  attachError.value = ''
  beginPassageAttach(annotation.id)
  // On a phone the panel is the sheet, and the sheet covers the article the
  // passage has to be selected in.
  if (props.phone) props.closeNotes()
}

function cancelAttach(): void {
  endPassageAttach()
}

function onAttachKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !attaching.value) return
  cancelAttach()
}

onMounted(() => window.addEventListener('keydown', onAttachKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onAttachKeydown))

/**
 * Highlight what was selected and hang the waiting note on it.
 *
 * The highlight is made first because the note can only point at one that
 * exists; that ordering is also what makes the failure interesting. A note the
 * server refuses to attach — it was attached from another window meanwhile, and
 * the contract allows the move only once — would otherwise leave a passage
 * marked in the text that the person never asked to highlight, so the create is
 * undone before the error is shown.
 */
async function attachToSelection(annotationId: string, selected: ReaderLiveSelection): Promise<void> {
  attachingNow.value = true
  attachError.value = ''
  try {
    const created = await writing.run(() =>
      notes.addHighlight({
        item_id: props.itemId,
        exact: selected.exact,
        prefix: selected.prefix,
        suffix: selected.suffix
      })
    )
    // Still waiting: the passage was not stored, so the next selection is
    // still this note's to attach.
    if (!created) return
    applyHighlight(created)
    try {
      const updated = await notes.attachAnnotationPassage(annotationId, created.id)
      replaceAnnotation(updated)
    } catch (cause) {
      attachError.value = describeFailure(cause)
      await notes.deleteHighlight(created.id)
      dropHighlight(created.id)
      return
    } finally {
      endPassageAttach()
    }
    notesGainedNote()
    window.getSelection()?.removeAllRanges()
    props.clearSelection()
  } finally {
    attachingNow.value = false
  }
}

watch(
  () => props.liveSelection,
  (selected) => {
    const annotationId = attaching.value
    if (!allowed.value || !selected || !annotationId || attachingNow.value) return
    void attachToSelection(annotationId, selected)
  }
)

async function retry(): Promise<void> {
  writing.clear()
  await refreshItemNotes()
}
</script>

<template>
  <section v-if="allowed" class="notes-reader" aria-labelledby="notes-reader-title">
    <h2 id="notes-reader-title" class="notes-reader-title">What this reading left behind</h2>
    <SegmentedControl :model-value="tab" :options="tabs" label="Notes for this reading" @change="selectTab" />

    <!--
      Teleported because on a phone this panel is the bottom sheet, and the
      sheet is hidden with `v-show` the moment attaching starts: a banner left
      inside it would be display:none exactly when it has something to say.
    -->
    <Teleport to="body">
      <div v-if="attaching" class="notes-reader-attach" role="status" data-notes-attach>
        <span>Select the passage for this note</span>
        <button type="button" data-action="cancel-attach" @click="cancelAttach">Cancel</button>
      </div>
    </Teleport>

    <p v-if="attachError" class="notes-reader-error" role="alert" data-notes-attach-error>
      Could not attach: {{ attachError }}
    </p>

    <div v-if="tab === 'margin'" class="notes-reader-margin">
      <form class="notes-reader-form" @submit.prevent="saveAnnotation">
        <label for="notes-reader-annotation">
          {{ annotationTarget ? 'Annotate the chosen passage' : 'Free annotation' }}
        </label>
        <textarea
          id="notes-reader-annotation"
          v-model="annotationDraft"
          rows="3"
          placeholder="What does this passage change?"
        />
        <div class="notes-reader-submit">
          <Button
            data-action="annotate"
            variant="primary"
            size="sm"
            type="submit"
            :disabled="!annotationDraft.trim() || writing.pending.value"
          >
            Annotate
          </Button>
        </div>
      </form>

      <p v-if="marginEntries.length === 0" class="notes-reader-empty">
        Nothing in the margin yet. Whatever you highlight while reading shows up here.
      </p>
      <div
        v-for="entry in marginEntries"
        :key="entry.key"
        class="notes-reader-entry"
        :class="{
          'is-continued': entry.kind === 'annotation' && entry.continued,
          'is-attaching': entry.kind === 'annotation' && entry.annotation.id === attaching
        }"
        :data-entry="entry.kind"
        :data-key="entry.key"
      >
        <form
          v-if="editing?.key === entry.key"
          class="notes-reader-form notes-reader-edit"
          @submit.prevent="saveEdit(entry)"
        >
          <textarea
            id="notes-reader-edit"
            v-model="editing.draft"
            :aria-label="entry.kind === 'question' ? 'Rewrite the question' : 'Rewrite the annotation'"
            rows="3"
            @input="editing.error = ''"
            @keydown.esc="editing = null"
          />
          <p v-if="editing.error" class="notes-reader-error" role="alert">{{ editing.error }}</p>
          <div class="notes-reader-submit">
            <Button data-action="cancel-edit" variant="secondary" size="sm" type="button" @click="editing = null">
              Cancel
            </Button>
            <Button
              data-action="save-edit"
              variant="primary"
              size="sm"
              type="submit"
              :disabled="!editing.draft.trim() || writing.pending.value"
            >
              Save
            </Button>
          </div>
        </form>

        <template v-else>
          <div v-if="entry.kind === 'question'" class="notes-reader-question">
            <span class="notes-reader-question-mark" aria-label="Question">?</span>
            <div>
              <p class="notes-reader-question-text">{{ entry.question.text }}</p>
              <p v-if="entry.question.status === 'answered' && entry.question.answer" class="notes-reader-answer">
                {{ entry.question.answer }}
              </p>
              <p class="notes-reader-question-state">
                {{ entry.question.status === 'answered' ? 'Answered' : 'Open' }}
              </p>
            </div>
          </div>
          <AnnotationItem
            v-else-if="entry.kind === 'annotation'"
            :kind="entry.highlight ? 'linked' : 'loose'"
            :quote="entry.highlight && !entry.continued ? entry.highlight.exact : undefined"
            :note="entry.annotation.text"
          />
          <AnnotationItem v-else :quote="entry.highlight.exact" @add-note="annotate(entry.highlight.id)" />

          <button
            v-if="entry.highlight"
            type="button"
            class="notes-reader-jump"
            data-action="jump"
            aria-label="Show this passage in the text"
            title="Show in the text"
            @click="props.scrollToPassage(entry.highlight.exact)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 11L11 5M6 5h5v5" />
            </svg>
          </button>

          <div class="notes-reader-entry-actions">
            <button v-if="entry.kind !== 'passage'" type="button" data-action="edit" @click="startEdit(entry)">
              Edit
            </button>
            <button v-if="entry.kind === 'annotation'" type="button" data-action="ask" @click="askAbout(entry.annotation)">
              Turn into question
            </button>
            <button
              v-if="entry.kind === 'annotation' && !entry.annotation.highlight_id"
              type="button"
              data-action="attach-passage"
              :disabled="attachingNow"
              @click="startAttach(entry.annotation)"
            >
              Attach to passage
            </button>
            <button type="button" data-action="delete" :disabled="writing.pending.value" @click="removeEntry(entry)">
              Delete
            </button>
          </div>
        </template>
      </div>
    </div>

    <form v-else class="notes-reader-form" @submit.prevent="saveNote">
      <label for="notes-reader-note">Note on this material</label>
      <textarea
        id="notes-reader-note"
        v-model="noteDraft"
        rows="5"
        placeholder="A note about the whole text."
      />
      <div class="notes-reader-submit">
        <Button data-action="save-note" variant="primary" size="sm" type="submit" :disabled="writing.pending.value">
          Save note
        </Button>
      </div>
    </form>

    <section v-if="orphaned.length > 0" class="notes-reader-orphans" aria-labelledby="notes-orphans-title">
      <h3 id="notes-orphans-title">Passages not found in this text</h3>
      <!--
        The reason is not claimed, because the reader cannot know it: `ambiguous`
        travels on the create response and is never stored, so a passage listed
        here may be one the text no longer holds or one it holds twice over.
      -->
      <p class="notes-reader-empty">
        They may be repeated in the text or no longer in it. They are still kept.
      </p>
      <blockquote v-for="highlight in orphaned" :key="highlight.id" class="notes-reader-orphan">
        {{ highlight.exact }}
      </blockquote>
    </section>

    <form class="notes-reader-form" @submit.prevent="turnIntoQuestion">
      <label for="notes-reader-question">Turn into a question</label>
      <select v-if="annotations.length > 0" v-model="questionAnnotation" aria-label="Source annotation">
        <option value="">No source annotation</option>
        <option v-for="annotation in annotations" :key="annotation.id" :value="annotation.id">
          {{ annotation.text }}
        </option>
      </select>
      <textarea
        id="notes-reader-question"
        ref="questionField"
        v-model="questionDraft"
        rows="3"
        placeholder="Ends with “?”."
        aria-describedby="notes-reader-question-error"
        @input="questionError = ''"
      />
      <p v-if="questionError" id="notes-reader-question-error" class="notes-reader-error" role="alert">
        {{ questionError }}
      </p>
      <div class="notes-reader-submit">
        <Button
          data-action="turn-into-question"
          variant="secondary"
          size="sm"
          type="submit"
          :disabled="writing.pending.value"
        >
          Turn into a question
        </Button>
      </div>
    </form>

    <p v-if="writing.error.value && !questionError" class="notes-reader-error" role="alert">
      Could not save: {{ writing.error.value }}
      <button type="button" class="notes-reader-retry" @click="retry">Try again</button>
    </p>
  </section>
</template>

<style scoped>
.notes-reader { display: grid; gap: var(--space-4); margin: 48px 0 64px; padding-top: var(--space-6); border-top: 1px solid var(--line); }
/* Inside the reader's sheet the panel is the whole surface: no rule, no gap above. */
@media (max-width: 900px) {
  .notes-reader { margin: 0; padding-top: var(--space-2); border-top: 0; }
  .notes-reader-title { font-size: 16px; }
}
.notes-reader-title { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 20px; font-weight: 650; letter-spacing: -0.015em; }
.notes-reader-margin { display: grid; gap: var(--space-3); }
/* The row draws the rule under itself, so the actions sit above it rather than past it. */
.notes-reader-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--space-2); border-bottom: 1px solid var(--line); }
.notes-reader-entry :deep(.nt-ann) { padding-bottom: var(--space-2); border-bottom: 0; }
.notes-reader-entry:has(+ .is-continued) { border-bottom: 0; }
.notes-reader-entry.is-continued { margin-top: calc(-1 * var(--space-3)); padding-left: var(--space-3); }
.notes-reader-entry.is-continued :deep(.nt-ann) { padding-top: var(--space-2); }
.notes-reader-edit { grid-column: 1 / -1; padding: var(--space-3) 0; }
.notes-reader-question { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: var(--space-2); padding: var(--space-4) 0 var(--space-2); }
.notes-reader-question-mark { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--norte); color: var(--surface); font-family: var(--font-display); font-size: 12px; font-weight: 700; }
.notes-reader-question p { margin: 0; }
.notes-reader-question-text { color: var(--ink); font-size: 14px; line-height: 22px; }
.notes-reader-question .notes-reader-answer { margin-top: var(--space-1); color: var(--ink-2); font-size: 14px; line-height: 22px; }
.notes-reader-question .notes-reader-question-state { margin-top: var(--space-2); color: var(--muted); font-size: 12px; line-height: 16px; }
.notes-reader-jump { grid-column: 2; grid-row: 1; align-self: start; display: grid; place-items: center; width: 28px; height: 28px; margin-top: var(--space-3); border: 0; border-radius: var(--radius-xs); background: none; color: var(--muted); cursor: pointer; }
.notes-reader-jump:hover { color: var(--norte); }
.notes-reader-entry-actions { grid-column: 1 / -1; display: flex; gap: var(--space-3); padding-bottom: var(--space-3); }
.notes-reader-entry-actions button { padding: 0; border: 0; background: none; color: var(--muted); cursor: pointer; font-family: var(--font-display); font-size: 12px; font-weight: 550; }
.notes-reader-entry-actions button:hover { color: var(--ink); }
.notes-reader-jump:focus-visible,
.notes-reader-entry-actions button:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
/* Where there is a pointer that hovers, the row's actions wait for it; a phone has none and keeps them, quietly. */
@media (hover: hover) {
  .notes-reader-entry-actions { opacity: 0; transition: opacity 120ms ease; }
  .notes-reader-entry:hover .notes-reader-entry-actions,
  .notes-reader-entry:focus-within .notes-reader-entry-actions { opacity: 1; }
}
.notes-reader-form { display: grid; gap: var(--space-2); }
.notes-reader-form > label { font-family: var(--font-display); font-size: 14px; font-weight: 550; }
.notes-reader-form textarea,
.notes-reader-form select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 24px;
}
.notes-reader-form textarea:focus-visible,
.notes-reader-form select:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.notes-reader-submit { display: flex; justify-content: flex-end; gap: var(--space-2); }
.notes-reader-empty { margin: 0; color: var(--muted); font-size: 14px; line-height: 22px; }
.notes-reader-orphans { display: grid; gap: var(--space-2); }
.notes-reader-orphans h3 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 15px; font-weight: 600; }
.notes-reader-orphan { margin: 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--line-strong); color: var(--ink-2); font-size: 14px; line-height: 22px; }
.notes-reader-error { margin: 0; color: var(--danger); font-size: 13px; line-height: 20px; }
/* Over the article, at the top of the window, clear of the text being picked. */
.notes-reader-attach {
  position: fixed;
  top: 12px;
  left: 50%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: calc(100vw - 24px);
  padding: 8px 10px 8px 14px;
  transform: translateX(-50%);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-full);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
}

.notes-reader-attach button {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--sunken);
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
}

.notes-reader-attach button:hover { color: var(--ink); }
.notes-reader-attach button:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }

/* The row whose passage is being picked, so a wide screen says which note the banner is about. */
.notes-reader-entry.is-attaching { background: var(--norte-soft); }
.notes-reader-retry { margin-left: var(--space-2); border: 0; background: none; color: var(--norte); cursor: pointer; font-family: var(--font-display); font-size: 12px; font-weight: 550; }
</style>
