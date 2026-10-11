<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Button from '@/components/ds/Button.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { useItemNote, useItemNotes } from '../data/composables'
import { notesGainedNote } from '../data/revision'

/**
 * Everything a reading leaves behind, under the article: the notes in the
 * margin, the one note for the whole text, the passages that are no longer in
 * the text, and the question the reading raised.
 *
 * It renders through the reader's slot, so the library never names this module
 * and a reader with notes switched off renders none of it. On a phone that slot
 * is the bottom sheet, and the reader hands over the section whoever opened the
 * sheet asked for — `anotacoes`, `nota` or `pergunta`, names this module chose
 * and the reader passes along without reading.
 */
const props = defineProps<ReaderSlotProps>()

type PanelTab = 'margem' | 'nota'

const { notes } = useSources()
const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))

const tab = ref<PanelTab>('margem')
const annotationDraft = ref('')
const annotationTarget = ref('')
const noteDraft = ref('')
const questionDraft = ref('')
const questionAnnotation = ref('')
const questionError = ref('')
const questionField = ref<HTMLTextAreaElement>()

const writing = useAsyncAction()

const {
  data: itemNotes,
  applyAnnotation,
  refresh: refreshItemNotes
} = useItemNotes(
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

/**
 * The margin, as one list: a highlighted passage with the note that hangs on
 * it, then the notes that hang on nothing.
 *
 * A passage with no note is still a row, because it is the thing the person
 * marked and the row is where its note gets written.
 */
const marginRows = computed(() => {
  const noted = new Set<string>()
  const rows = highlights.value
    .filter((highlight) => highlight.status === 'anchored')
    .map((highlight) => {
      const note = annotations.value.find((candidate) => candidate.highlight_id === highlight.id)
      if (note) noted.add(note.id)
      return {
        id: note?.id ?? highlight.id,
        highlightId: highlight.id,
        quote: highlight.exact,
        note: note?.text
      }
    })
  const loose = annotations.value
    .filter((annotation) => !noted.has(annotation.id) && !annotation.highlight_id)
    .map((annotation) => ({ id: annotation.id, highlightId: '', quote: undefined, note: annotation.text }))
  return [...rows, ...loose]
})

const tabs = computed(() => [
  { value: 'margem', label: 'Anotações', count: marginRows.value.length },
  { value: 'nota', label: 'Nota' }
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
  if (value === 'margem' || value === 'nota') tab.value = value
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
    if (request.section === 'anotacoes') tab.value = 'margem'
    // `note` is the section the reader's own `?notes=note` deep link carries,
    // and the note search entry on the server builds that address. The other
    // section names are still this module's and are translated with it.
    if (request.section === 'note') tab.value = 'nota'
    if (request.section !== 'pergunta') return
    await nextTick()
    questionField.value?.scrollIntoView({ block: 'nearest' })
    questionField.value?.focus()
  }
)

/** Open the margin box against one passage, which is a note on that highlight. */
function annotate(highlightId: string): void {
  annotationTarget.value = highlightId
  tab.value = 'margem'
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
 * "Virar pergunta" at the end of a reading.
 *
 * The trailing "?" is the same rule the Notas screen applies, because it is the
 * same thing being written: a question is a question wherever it is typed.
 */
async function turnIntoQuestion(): Promise<void> {
  const text = questionDraft.value.trim()
  if (!text.endsWith('?')) {
    questionError.value = 'A pergunta precisa terminar com “?”.'
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
    questionError.value = `Não foi possível salvar: ${writing.error.value ?? 'erro desconhecido'}`
    return
  }
  notesGainedNote()
  questionDraft.value = ''
  questionAnnotation.value = ''
  questionError.value = ''
}

async function retry(): Promise<void> {
  writing.clear()
  await refreshItemNotes()
}
</script>

<template>
  <section v-if="allowed" class="notes-reader" aria-labelledby="notes-reader-title">
    <h2 id="notes-reader-title" class="notes-reader-title">O que esta leitura deixou</h2>
    <SegmentedControl :model-value="tab" :options="tabs" label="Notas desta leitura" @change="selectTab" />

    <div v-if="tab === 'margem'" class="notes-reader-margin">
      <form class="notes-reader-form" @submit.prevent="saveAnnotation">
        <label for="notes-reader-annotation">
          {{ annotationTarget ? 'Anotar o trecho escolhido' : 'Anotação livre' }}
        </label>
        <textarea
          id="notes-reader-annotation"
          v-model="annotationDraft"
          rows="2"
          placeholder="O que este trecho muda?"
        />
        <div class="notes-reader-submit">
          <Button
            data-action="anotar"
            variant="primary"
            size="sm"
            type="submit"
            :disabled="!annotationDraft.trim() || writing.pending.value"
          >
            Anotar
          </Button>
        </div>
      </form>

      <p v-if="marginRows.length === 0" class="notes-reader-empty">
        Nada na margem ainda. O que você destacar nesta leitura aparece aqui.
      </p>
      <AnnotationItem
        v-for="row in marginRows"
        :key="row.id"
        :quote="row.quote"
        :note="row.note"
        @add-note="annotate(row.highlightId)"
      />
    </div>

    <form v-else class="notes-reader-form" @submit.prevent="saveNote">
      <label for="notes-reader-note">Nota deste material</label>
      <textarea
        id="notes-reader-note"
        v-model="noteDraft"
        rows="5"
        placeholder="Uma nota sobre o texto inteiro."
      />
      <div class="notes-reader-submit">
        <Button data-action="salvar-nota" variant="primary" size="sm" type="submit" :disabled="writing.pending.value">
          Salvar nota
        </Button>
      </div>
    </form>

    <section v-if="orphaned.length > 0" class="notes-reader-orphans" aria-labelledby="notes-orphans-title">
      <h3 id="notes-orphans-title">Trechos que não foram encontrados neste texto</h3>
      <!--
        The reason is not claimed, because the reader cannot know it: `ambiguous`
        travels on the create response and is never stored, so a passage listed
        here may be one the text no longer holds or one it holds twice over.
      -->
      <p class="notes-reader-empty">
        Podem estar repetidos no texto ou não estar mais nele. Eles continuam guardados.
      </p>
      <blockquote v-for="highlight in orphaned" :key="highlight.id" class="notes-reader-orphan">
        {{ highlight.exact }}
      </blockquote>
    </section>

    <form class="notes-reader-form" @submit.prevent="turnIntoQuestion">
      <label for="notes-reader-question">Virar pergunta</label>
      <select v-if="annotations.length > 0" v-model="questionAnnotation" aria-label="Anotação de origem">
        <option value="">Sem anotação de origem</option>
        <option v-for="annotation in annotations" :key="annotation.id" :value="annotation.id">
          {{ annotation.text }}
        </option>
      </select>
      <textarea
        id="notes-reader-question"
        ref="questionField"
        v-model="questionDraft"
        rows="2"
        placeholder="Termina com “?”."
        aria-describedby="notes-reader-question-error"
        @input="questionError = ''"
      />
      <p v-if="questionError" id="notes-reader-question-error" class="notes-reader-error" role="alert">
        {{ questionError }}
      </p>
      <div class="notes-reader-submit">
        <Button
          data-action="virar-pergunta"
          variant="secondary"
          size="sm"
          type="submit"
          :disabled="writing.pending.value"
        >
          Virar pergunta
        </Button>
      </div>
    </form>

    <p v-if="writing.error.value && !questionError" class="notes-reader-error" role="alert">
      Não foi possível salvar: {{ writing.error.value }}
      <button type="button" class="notes-reader-retry" @click="retry">Tentar de novo</button>
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
  resize: vertical;
}
.notes-reader-form textarea:focus-visible,
.notes-reader-form select:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.notes-reader-submit { display: flex; justify-content: flex-end; }
.notes-reader-empty { margin: 0; color: var(--muted); font-size: 14px; line-height: 22px; }
.notes-reader-orphans { display: grid; gap: var(--space-2); }
.notes-reader-orphans h3 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 15px; font-weight: 600; }
.notes-reader-orphan { margin: 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--line-strong); color: var(--ink-2); font-size: 14px; line-height: 22px; }
.notes-reader-error { margin: 0; color: var(--danger); font-size: 13px; line-height: 20px; }
.notes-reader-retry { margin-left: var(--space-2); border: 0; background: none; color: var(--norte); cursor: pointer; font-family: var(--font-display); font-size: 12px; font-weight: 550; }
</style>
