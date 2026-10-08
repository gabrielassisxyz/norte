<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Button from '@/components/ds/Button.vue'
import Highlight from '@/components/ds/Highlight.vue'
import QuestionItem from '@/components/ds/QuestionItem.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatDayAge, formatShortDate, todayIsoDate } from '@/lib/clock'
import { isModuleMounted } from '@/modules/mounting'
import { useSources } from '@/sources'

import {
  useNotesAnnotations,
  useNotesHighlights,
  useNotesQuestions,
  useNotesSummary
} from '../data/composables'
import { noteChanged } from '../data/revision'
import type { NoteSourceRef, NoteTab } from '../data/source'

const TABS: NoteTab[] = ['highlights', 'anotacoes', 'perguntas']
const TAB_LABELS: Record<NoteTab, string> = {
  highlights: 'Highlights',
  anotacoes: 'Anotações',
  perguntas: 'Perguntas'
}

const route = useRoute()
const router = useRouter()
const { notes: notesSource } = useSources()

const tab = ref<NoteTab>('highlights')
const filter = ref('')
const questionText = ref('')
const questionItem = ref('')
const questionError = ref('')

function isNotesTab(value: unknown): value is NoteTab {
  return typeof value === 'string' && TABS.includes(value as NoteTab)
}

/** The narrowing is the server's: a page filtered here is one page of fifty. */
const query = computed(() => ({ q: filter.value.trim() }))

/**
 * One resource per tab, each read only while its tab is the one shown.
 *
 * Three lists rather than one: they are three different records with three
 * different endpoints, and a single list would have to invent a common shape
 * for a highlight, a note and a question — which is what the mock used to do,
 * and what made the question's kind and answer fields optional on a highlight.
 */
const highlights = useNotesHighlights(query, () => tab.value === 'highlights')
const annotations = useNotesAnnotations(query, () => tab.value === 'anotacoes')
const questions = useNotesQuestions(query, () => tab.value === 'perguntas')
const { data: counts } = useNotesSummary()
const writing = useAsyncAction()

const active = computed(() => {
  if (tab.value === 'highlights') return highlights
  if (tab.value === 'anotacoes') return annotations
  return questions
})

const firstLoad = computed(() => active.value.loading.value && active.value.data.value === null)
const error = computed(() => active.value.error.value)
const shownCount = computed(() => active.value.data.value?.items.length ?? 0)

const options = computed(() =>
  TABS.map((value) => ({
    value,
    label: TAB_LABELS[value],
    count: counts.value?.[value] ?? 0
  }))
)

const heading = computed(() => TAB_LABELS[tab.value])

/**
 * The items a new question can be attached to.
 *
 * Notes cannot read the library's catalogue — it has to keep working with the
 * library switched off — so what is offered is the items the person already has
 * notes on, which the registry gave us with each row. "Sem material" is the
 * default, because a question raised while thinking is not about a text.
 */
const questionItems = computed<NoteSourceRef[]>(() => {
  const byId = new Map<string, NoteSourceRef>()
  for (const row of [
    ...(highlights.data.value?.items ?? []),
    ...(annotations.data.value?.items ?? []),
    ...(questions.data.value?.items ?? [])
  ]) {
    if (row.source) byId.set(row.source.id, row.source)
  }
  return [...byId.values()].sort((first, second) => first.title.localeCompare(second.title, 'pt-BR'))
})

const emptyText = computed(() => {
  if (filter.value.trim()) return `Nada encontrado para “${filter.value.trim()}”.`
  if (tab.value === 'highlights') return 'Nenhum highlight ainda. O que você marcar na leitura aparece aqui.'
  if (tab.value === 'anotacoes') return 'Nenhuma anotação ainda.'
  return 'Nenhuma pergunta ainda.'
})

/**
 * The reader is the library's screen, so a row links to it only while the
 * library is mounted: with notes alone the row still shows where it came from,
 * read from the registry, but there is nowhere to open it.
 */
const canOpenSource = computed(() => isModuleMounted('library'))

function sourcePath(source: NoteSourceRef | undefined): string | undefined {
  if (!source || !canOpenSource.value) return undefined
  if (source.module !== 'library') return undefined
  return `/biblioteca/${source.id}`
}

watch(
  () => route.query.tab,
  (value) => {
    tab.value = isNotesTab(value) ? value : 'highlights'
  },
  { immediate: true }
)

async function selectTab(value: string): Promise<void> {
  if (!isNotesTab(value)) return
  tab.value = value
  await router.replace({ name: 'notas', query: { ...route.query, tab: value } })
}

async function addQuestion(): Promise<void> {
  const text = questionText.value.trim()
  if (!text.endsWith('?')) {
    questionError.value = 'A pergunta precisa terminar com “?”.'
    return
  }

  const created = await writing.run(() =>
    notesSource.addQuestion({ text, ...(questionItem.value ? { item_id: questionItem.value } : {}) })
  )
  if (!created) {
    questionError.value = `Não foi possível salvar: ${writing.error.value ?? 'erro desconhecido'}`
    return
  }

  // The row the server answered with, never the one that was sent: a question
  // comes back with the id, the status and the source title it now has.
  //
  // Only the counts are re-read. Re-reading the list would throw away every
  // page loaded after the first, and would drop the row just placed back out
  // of the page it belongs at the top of.
  questions.prepend(created)
  noteChanged()
  questionText.value = ''
  questionError.value = ''
}
</script>

<template>
  <main class="notes-view">
    <div class="notes-inner">
      <header class="notes-head">
        <div class="notes-tabs">
          <h1>{{ heading }}</h1>
          <SegmentedControl :model-value="tab" :options="options" label="Tipo de nota" @change="selectTab" />
        </div>
        <RouterLink class="notes-sets-link" :to="{ name: 'notas-conjuntos' }">Conjuntos de perguntas</RouterLink>
        <label class="notes-filter-label" for="notes-filter">Filtrar</label>
        <input
          id="notes-filter"
          v-model="filter"
          class="notes-filter"
          type="search"
          placeholder="Filtrar por texto ou fonte…"
        />
      </header>

      <p v-if="firstLoad" class="notes-state" role="status">Carregando as notas…</p>

      <div v-else-if="error" class="notes-state" role="alert">
        <p>Não foi possível carregar as notas: {{ error }}</p>
        <Button variant="secondary" @click="active.refresh()">Tentar de novo</Button>
      </div>

      <section v-else-if="tab === 'highlights'" aria-label="Lista de highlights" class="notes-highlights">
        <p v-if="shownCount === 0" class="notes-state">{{ emptyText }}</p>
        <article v-for="highlight in highlights.data.value?.items ?? []" :key="highlight.id" class="notes-highlight">
          <Highlight
            :quote="highlight.exact"
            :source="highlight.source?.title ?? 'Material sem fonte'"
            :timestamp="formatShortDate(highlight.created_at)"
            :href="sourcePath(highlight.source)"
          />
          <p v-if="highlight.status === 'orphaned'" class="notes-orphaned">
            Este trecho não está mais no texto extraído.
          </p>
          <div v-if="sourcePath(highlight.source)" class="notes-links">
            <RouterLink :to="sourcePath(highlight.source)!">Abrir fonte</RouterLink>
          </div>
        </article>
      </section>

      <section v-else-if="tab === 'anotacoes'" aria-label="Lista de anotações" class="notes-annotations">
        <p v-if="shownCount === 0" class="notes-state">{{ emptyText }}</p>
        <article
          v-for="annotation in annotations.data.value?.items ?? []"
          :key="annotation.id"
          class="notes-annotation"
        >
          <AnnotationItem
            :quote="annotation.quote"
            :note="annotation.text"
            :location="annotation.source?.title"
            :time="formatShortDate(annotation.created_at)"
          />
          <div v-if="sourcePath(annotation.source)" class="notes-links">
            <RouterLink :to="sourcePath(annotation.source)!">Abrir fonte</RouterLink>
          </div>
        </article>
      </section>

      <section v-else aria-labelledby="new-question-title" class="notes-questions">
        <form class="notes-question-form" @submit.prevent="addQuestion">
          <label id="new-question-title" for="new-question">Nova pergunta</label>
          <label class="notes-filter-label" for="new-question-item">Material de origem</label>
          <select id="new-question-item" v-model="questionItem">
            <option value="">Sem material</option>
            <option v-for="item in questionItems" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
          <textarea
            id="new-question"
            v-model="questionText"
            rows="2"
            placeholder="Termina com “?”. Ex.: Por que a curva de esquecimento é exponencial?"
            aria-describedby="question-error"
            @input="questionError = ''"
          />
          <p v-if="questionError" id="question-error" class="notes-question-error" role="alert">{{ questionError }}</p>
          <div class="notes-submit"><Button variant="primary" type="submit">Adicionar à lista</Button></div>
        </form>

        <div class="notes-question-list" aria-label="Lista de perguntas">
          <p v-if="shownCount === 0" class="notes-state">{{ emptyText }}</p>
          <article v-for="question in questions.data.value?.items ?? []" :key="question.id" class="notes-question">
            <QuestionItem
              :kind="question.kind ?? 'what'"
              :question="question.text"
              :status="question.status === 'answered' ? 'answered' : 'open'"
              :answer="question.answer"
              :topic="question.source?.title"
              :age="formatDayAge(question.created_at, todayIsoDate())"
            />
            <div v-if="sourcePath(question.source)" class="notes-links">
              <RouterLink :to="sourcePath(question.source)!">Abrir fonte</RouterLink>
            </div>
          </article>
        </div>
      </section>

      <div v-if="!firstLoad && !error" class="notes-foot">
        <p v-if="active.loadMoreError.value" class="notes-question-error" role="alert">
          Não foi possível carregar mais: {{ active.loadMoreError.value }}
        </p>
        <Button
          v-if="active.hasMore.value"
          data-action="carregar-mais"
          variant="secondary"
          :disabled="active.loadingMore.value"
          @click="active.loadMore()"
        >
          Carregar mais
        </Button>
        <p class="notes-count">
          {{ shownCount }} {{ shownCount === 1 ? 'item' : 'itens'
          }}<template v-if="filter.trim()"> para “{{ filter.trim() }}”</template>
        </p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.notes-view { min-width: 0; }
.notes-state { margin: 32px 0 0; color: var(--muted); font-size: 15px; line-height: 24px; }
.notes-state p { margin: 0 0 var(--space-2); }
.notes-inner { max-width: 1120px; margin: 0 auto; padding-top: 28px; }
.notes-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.notes-tabs { display: flex; align-items: center; gap: var(--space-6); flex-wrap: wrap; }
.notes-tabs h1 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.03em; line-height: 36px; }
.notes-sets-link { font-family: var(--font-display); font-size: 13px; font-weight: 550; text-decoration: none; }
.notes-sets-link:hover { text-decoration: underline; }
.notes-filter-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.notes-filter { width: 280px; height: 36px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 14px; }
.notes-filter::placeholder, .notes-question-form textarea::placeholder { color: var(--muted); }
.notes-filter:focus-visible, .notes-question-form textarea:focus-visible, .notes-question-form select:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.notes-highlights { display: grid; gap: var(--space-9); margin-top: 32px; }
.notes-highlight { display: grid; gap: var(--space-2); }
.notes-orphaned { margin: 0; color: var(--muted); font-size: 13px; line-height: 20px; }
.notes-annotations { margin-top: var(--space-6); border-top: 1px solid var(--line); }
.notes-annotation { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-4); }
.notes-annotation :deep(.nt-ann) { border-bottom: 0; }
.notes-questions { margin-top: 32px; }
.notes-question-form { display: grid; max-width: 720px; gap: var(--space-2); }
.notes-question-form > label { font-family: var(--font-display); font-size: 14px; font-weight: 550; }
.notes-question-form select, .notes-question-form textarea {
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
.notes-question-form textarea { resize: vertical; }
.notes-question-error { margin: 0; color: var(--danger); font-size: 13px; line-height: 20px; }
.notes-submit { display: flex; justify-content: flex-end; }
.notes-question-list { margin-top: var(--space-6); }
.notes-question { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-4); max-width: 840px; }
.notes-question :deep(.nt-q) { border-bottom: 0; }
.notes-question + .notes-question { border-top: 1px solid var(--line); }
.notes-links { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); padding-bottom: var(--space-4); font-family: var(--font-display); font-size: 12px; font-weight: 550; white-space: nowrap; }
.notes-links a { text-decoration: none; }
.notes-links a:hover { text-decoration: underline; }
.notes-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-6); flex-wrap: wrap; }
.notes-count { margin: 0; color: var(--muted); font-family: var(--font-mono); font-size: 12px; line-height: 16px; text-align: right; }
@media (max-width: 900px) { .notes-annotation, .notes-question { grid-template-columns: minmax(0, 1fr); gap: 0; } .notes-links { justify-content: flex-start; } }
@media (max-width: 560px) { .notes-tabs { gap: var(--space-4); } .notes-filter { width: 100%; } }
</style>
