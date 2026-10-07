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
import type { MaterialKind, QuestionKind } from '@/mock/types'
import { useSources } from '@/sources'

import { useNotes } from '../data/composables'
import type { NoteRecord, NoteSourceRef, NoteTab } from '../data/source'

const TABS: NoteTab[] = ['highlights', 'anotacoes', 'perguntas']
const TAB_LABELS: Record<NoteTab, string> = {
  highlights: 'Highlights',
  anotacoes: 'Anotações',
  perguntas: 'Perguntas'
}
const QUESTION_KINDS: Array<{ value: QuestionKind; label: string }> = [
  { value: 'what', label: 'O quê' },
  { value: 'why', label: 'Por quê' },
  { value: 'who', label: 'Quem' },
  { value: 'when', label: 'Quando' },
  { value: 'where', label: 'Onde' },
  { value: 'how', label: 'Como' }
]
/** Which decision a material's notes feed, as the prototype wires them. */
const DECISION_BY_MATERIAL: Record<string, string | undefined> = {
  'post-compilation': 'decision-parser-shape',
  'book-garden': 'decision-garden-layout',
  'paper-reading': 'decision-budget-period'
}
const READABLE_KINDS: MaterialKind[] = ['post', 'livro', 'paper']

const route = useRoute()
const router = useRouter()
const { notes: notesSource } = useSources()

const tab = ref<NoteTab>('highlights')
const filter = ref('')
const questionKind = ref<QuestionKind>('why')
const questionText = ref('')
const questionError = ref('')

function isNotesTab(value: unknown): value is NoteTab {
  return typeof value === 'string' && TABS.includes(value as NoteTab)
}

/** The list is read per tab and per filter, so the source does the filtering. */
const query = computed(() => ({ tab: tab.value, search: filter.value.trim() }))
const { data: page, loading, error, refresh, prependNote } = useNotes(query)
const writing = useAsyncAction()

const rows = computed<NoteRecord[]>(() => page.value?.items ?? [])
const firstLoad = computed(() => loading.value && page.value === null)

const counts = computed(() => page.value?.counts ?? { highlights: 0, anotacoes: 0, perguntas: 0 })

const options = computed(() => TABS.map((value) => ({ value, label: TAB_LABELS[value], count: counts.value[value] })))

const heading = computed(() => TAB_LABELS[tab.value])
const shownCount = computed(() => rows.value.length)

const emptyText = computed(() => {
  if (filter.value.trim()) return `Nada encontrado para “${filter.value.trim()}”.`
  if (tab.value === 'highlights') return 'Nenhum highlight ainda. O que você marcar na leitura aparece aqui.'
  if (tab.value === 'anotacoes') return 'Nenhuma anotação ainda.'
  return 'Nenhuma pergunta ainda.'
})

function materialPath(source: NoteSourceRef): string | undefined {
  if (!READABLE_KINDS.includes(source.kind as MaterialKind)) return undefined
  return `/material/${source.kind}/${source.id}`
}

function decisionPath(source: NoteSourceRef): string | undefined {
  const decisionId = DECISION_BY_MATERIAL[source.id]
  return decisionId ? `/decisoes/${decisionId}` : undefined
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
    notesSource.addQuestion({ kind: questionKind.value, text, materialId: 'post-compilation' })
  )
  if (!created) {
    questionError.value = `Não foi possível salvar: ${writing.error.value ?? 'erro desconhecido'}`
    return
  }

  prependNote(created)
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
        <label class="notes-filter-label" for="notes-filter">Filtrar</label>
        <input id="notes-filter" v-model="filter" class="notes-filter" type="search" placeholder="Filtrar por texto ou fonte…" />
      </header>

      <p v-if="firstLoad" class="notes-state" role="status">Carregando as notas…</p>

      <div v-else-if="error" class="notes-state" role="alert">
        <p>Não foi possível carregar as notas: {{ error }}</p>
        <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
      </div>

      <section v-else-if="tab === 'highlights'" aria-label="Lista de highlights" class="notes-highlights">
        <p v-if="rows.length === 0" class="notes-state">{{ emptyText }}</p>
        <article v-for="highlight in rows" :key="highlight.id" class="notes-highlight">
          <Highlight
            :quote="highlight.text"
            :source="highlight.source?.title ?? 'Material sem fonte'"
            :timestamp="formatShortDate(highlight.createdAt)"
            :href="highlight.source ? materialPath(highlight.source) : undefined"
          />
          <div v-if="highlight.source" class="notes-links">
            <RouterLink v-if="materialPath(highlight.source)" :to="materialPath(highlight.source)!">Abrir fonte</RouterLink>
            <RouterLink v-if="decisionPath(highlight.source)" :to="decisionPath(highlight.source)!">Ver decisão</RouterLink>
          </div>
        </article>
      </section>

      <section v-else-if="tab === 'anotacoes'" aria-label="Lista de anotações" class="notes-annotations">
        <p v-if="rows.length === 0" class="notes-state">{{ emptyText }}</p>
        <article v-for="annotation in rows" :key="annotation.id" class="notes-annotation">
          <AnnotationItem
            :kind="annotation.quote ? 'linked' : 'loose'"
            :quote="annotation.quote"
            :note="annotation.text"
            :location="annotation.source?.title"
            :time="formatShortDate(annotation.createdAt)"
          />
          <div v-if="annotation.source" class="notes-links">
            <RouterLink v-if="materialPath(annotation.source)" :to="materialPath(annotation.source)!">Abrir fonte</RouterLink>
            <RouterLink v-if="decisionPath(annotation.source)" :to="decisionPath(annotation.source)!">Ver decisão</RouterLink>
          </div>
        </article>
      </section>

      <section v-else aria-labelledby="new-question-title" class="notes-questions">
        <form class="notes-question-form" @submit.prevent="addQuestion">
          <label id="new-question-title" for="new-question">Nova pergunta</label>
          <div class="notes-kind-list" aria-label="Tipo de pergunta">
            <button
              v-for="kind in QUESTION_KINDS"
              :key="kind.value"
              type="button"
              :class="['notes-kind', { 'is-active': questionKind === kind.value }]"
              :aria-pressed="questionKind === kind.value"
              @click="questionKind = kind.value"
            >
              {{ kind.label }}
            </button>
          </div>
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
          <p v-if="rows.length === 0" class="notes-state">{{ emptyText }}</p>
          <article v-for="question in rows" :key="question.id" class="notes-question">
            <QuestionItem
              :kind="question.questionKind ?? 'what'"
              :question="question.text"
              :status="question.answer ? 'answered' : 'open'"
              :answer="question.answer"
              :topic="question.source?.title"
              :age="formatDayAge(question.createdAt, todayIsoDate())"
            />
            <div v-if="question.source" class="notes-links">
              <RouterLink v-if="materialPath(question.source)" :to="materialPath(question.source)!">Abrir fonte</RouterLink>
              <RouterLink v-if="decisionPath(question.source)" :to="decisionPath(question.source)!">Ver decisão</RouterLink>
            </div>
          </article>
        </div>
      </section>

      <p v-if="!firstLoad && !error" class="notes-count">
        {{ shownCount }} {{ shownCount === 1 ? 'item' : 'itens' }}<template v-if="filter.trim()"> para “{{ filter.trim() }}”</template>
      </p>
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
.notes-filter-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.notes-filter { width: 280px; height: 36px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 14px; }
.notes-filter::placeholder, .notes-question-form textarea::placeholder { color: var(--muted); }
.notes-filter:focus-visible, .notes-question-form textarea:focus-visible, .notes-kind:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.notes-highlights { display: grid; gap: var(--space-9); margin-top: 32px; }
.notes-highlight { display: grid; gap: var(--space-2); }
.notes-annotations { margin-top: var(--space-6); border-top: 1px solid var(--line); }
.notes-annotation { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-4); }
.notes-annotation :deep(.nt-ann) { border-bottom: 0; }
.notes-questions { margin-top: 32px; }
.notes-question-form { display: grid; max-width: 720px; gap: var(--space-2); }
.notes-question-form > label { font-family: var(--font-display); font-size: 14px; font-weight: 550; }
.notes-kind-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.notes-kind { height: 32px; padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); cursor: pointer; font-family: var(--font-display); font-size: 13px; font-weight: 550; }
.notes-kind.is-active { border-color: var(--norte); background: var(--norte-soft); color: var(--norte); }
.notes-question-form textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 15px; line-height: 24px; resize: vertical; }
.notes-question-error { margin: 0; color: var(--danger); font-size: 13px; line-height: 20px; }
.notes-submit { display: flex; justify-content: flex-end; }
.notes-question-list { margin-top: var(--space-6); }
.notes-question { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-4); max-width: 840px; }
.notes-question :deep(.nt-q) { border-bottom: 0; }
.notes-question + .notes-question { border-top: 1px solid var(--line); }
.notes-links { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); padding-bottom: var(--space-4); font-family: var(--font-display); font-size: 12px; font-weight: 550; white-space: nowrap; }
.notes-links a { text-decoration: none; }
.notes-links a:hover { text-decoration: underline; }
.notes-count { margin: var(--space-6) 0 0; color: var(--muted); font-family: var(--font-mono); font-size: 12px; line-height: 16px; text-align: right; }
@media (max-width: 900px) { .notes-annotation, .notes-question { grid-template-columns: minmax(0, 1fr); gap: 0; } .notes-links { justify-content: flex-start; } }
@media (max-width: 560px) { .notes-tabs { gap: var(--space-4); } .notes-filter { width: 100%; } }
</style>
