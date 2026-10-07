<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Button from '@/components/ds/Button.vue'
import Highlight from '@/components/ds/Highlight.vue'
import QuestionItem from '@/components/ds/QuestionItem.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { store } from '@/mock/store'
import type { LibraryItem, MaterialKind, QuestionKind } from '@/mock/types'

type NotesTab = 'highlights' | 'anotacoes' | 'perguntas'

interface NoteSource {
  material: LibraryItem & { kind: MaterialKind }
  decisionId?: string
}

const TABS: NotesTab[] = ['highlights', 'anotacoes', 'perguntas']
const QUESTION_KINDS: Array<{ value: QuestionKind; label: string }> = [
  { value: 'what', label: 'O quê' },
  { value: 'why', label: 'Por quê' },
  { value: 'who', label: 'Quem' },
  { value: 'when', label: 'Quando' },
  { value: 'where', label: 'Onde' },
  { value: 'how', label: 'Como' }
]
const DECISION_BY_MATERIAL: Record<string, string | undefined> = {
  'post-compilation': 'decision-parser-shape',
  'book-garden': 'decision-garden-layout',
  'paper-reading': 'decision-budget-period'
}
const AGE_BY_DATE: Record<string, string> = {
  '2026-09-19': '14 d',
  '2026-09-18': '15 d',
  '2026-09-17': '16 d',
  '2026-09-16': '17 d',
  '2026-09-15': '18 d',
  '2026-09-14': '19 d',
  '2026-09-13': '20 d',
  '2026-09-12': '21 d',
  '2026-09-11': '22 d',
  '2026-09-10': '23 d'
}

const route = useRoute()
const router = useRouter()
const tab = ref<NotesTab>('highlights')
const filter = ref('')
const questionKind = ref<QuestionKind>('why')
const questionText = ref('')
const questionError = ref('')

function isNotesTab(value: unknown): value is NotesTab {
  return typeof value === 'string' && TABS.includes(value as NotesTab)
}

function isMaterial(item: LibraryItem | undefined): item is LibraryItem & { kind: MaterialKind } {
  return item !== undefined && ['post', 'livro', 'paper'].includes(item.kind)
}

function sourceFor(materialId: string | undefined): NoteSource | undefined {
  const material = store.libraryItems.find((item) => item.id === materialId)
  if (!isMaterial(material)) return undefined
  return { material, decisionId: DECISION_BY_MATERIAL[material.id] }
}

function materialPath(source: NoteSource): string {
  return `/material/${source.material.kind}/${source.material.id}`
}

function matchesFilter(...values: Array<string | undefined>): boolean {
  const term = filter.value.trim().toLocaleLowerCase('pt-BR')
  return !term || values.filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(term)
}

const filteredHighlights = computed(() =>
  store.highlights.filter((highlight) => {
    const source = sourceFor(highlight.materialId)
    return matchesFilter(highlight.text, source?.material.title, source?.material.author)
  })
)

const filteredAnnotations = computed(() =>
  store.annotations.filter((annotation) => {
    const source = sourceFor(annotation.materialId)
    return matchesFilter(annotation.text, source?.material.title, source?.material.author)
  })
)

const filteredQuestions = computed(() =>
  store.questions.filter((question) => {
    const source = sourceFor(question.materialId)
    return matchesFilter(question.text, source?.material.title, source?.material.author)
  })
)

const counts = computed(() => ({
  highlights: store.highlights.length,
  anotacoes: store.annotations.length,
  perguntas: store.questions.length
}))

const options = computed(() => [
  { value: 'highlights', label: 'Highlights', count: counts.value.highlights },
  { value: 'anotacoes', label: 'Anotações', count: counts.value.anotacoes },
  { value: 'perguntas', label: 'Perguntas', count: counts.value.perguntas }
])

const heading = computed(() => options.value.find((option) => option.value === tab.value)?.label ?? 'Highlights')
const shownCount = computed(() => {
  if (tab.value === 'highlights') return filteredHighlights.value.length
  if (tab.value === 'anotacoes') return filteredAnnotations.value.length
  return filteredQuestions.value.length
})

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

function addQuestion(): void {
  const text = questionText.value.trim()
  if (!text.endsWith('?')) {
    questionError.value = 'A pergunta precisa terminar com “?”.'
    return
  }

  store.addQuestion({
    kind: questionKind.value,
    text,
    materialId: 'post-compilation'
  })
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

      <section v-if="tab === 'highlights'" aria-label="Lista de highlights" class="notes-highlights">
        <article v-for="highlight in filteredHighlights" :key="highlight.id" class="notes-highlight">
          <Highlight
            :quote="highlight.text"
            :source="sourceFor(highlight.materialId)?.material.title ?? 'Material sem fonte'"
            :timestamp="highlight.createdAt.slice(0, 10)"
            :href="sourceFor(highlight.materialId) ? materialPath(sourceFor(highlight.materialId)!) : undefined"
          />
          <div v-if="sourceFor(highlight.materialId)" class="notes-links">
            <RouterLink :to="materialPath(sourceFor(highlight.materialId)!)">Abrir fonte</RouterLink>
            <RouterLink v-if="sourceFor(highlight.materialId)?.decisionId" :to="`/decisoes/${sourceFor(highlight.materialId)?.decisionId}`">Ver decisão</RouterLink>
          </div>
        </article>
      </section>

      <section v-else-if="tab === 'anotacoes'" aria-label="Lista de anotações" class="notes-annotations">
        <article v-for="annotation in filteredAnnotations" :key="annotation.id" class="notes-annotation">
          <AnnotationItem
            :kind="annotation.highlightId ? 'linked' : 'loose'"
            :quote="annotation.highlightId ? store.highlights.find((highlight) => highlight.id === annotation.highlightId)?.text : undefined"
            :note="annotation.text"
            :location="sourceFor(annotation.materialId)?.material.title"
            :time="annotation.createdAt.slice(0, 10)"
          />
          <div v-if="sourceFor(annotation.materialId)" class="notes-links">
            <RouterLink :to="materialPath(sourceFor(annotation.materialId)!)">Abrir fonte</RouterLink>
            <RouterLink v-if="sourceFor(annotation.materialId)?.decisionId" :to="`/decisoes/${sourceFor(annotation.materialId)?.decisionId}`">Ver decisão</RouterLink>
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
          <article v-for="question in filteredQuestions" :key="question.id" class="notes-question">
            <QuestionItem
              :kind="question.kind"
              :question="question.text"
              :status="question.answer ? 'answered' : 'open'"
              :answer="question.answer"
              :topic="sourceFor(question.materialId)?.material.title"
              :age="AGE_BY_DATE[question.createdAt.slice(0, 10)] ?? 'agora'"
            />
            <div v-if="sourceFor(question.materialId)" class="notes-links">
              <RouterLink :to="materialPath(sourceFor(question.materialId)!)">Abrir fonte</RouterLink>
              <RouterLink v-if="sourceFor(question.materialId)?.decisionId" :to="`/decisoes/${sourceFor(question.materialId)?.decisionId}`">Ver decisão</RouterLink>
            </div>
          </article>
        </div>
      </section>

      <p class="notes-count">{{ shownCount }} {{ shownCount === 1 ? 'item' : 'itens' }}<template v-if="filter.trim()"> para “{{ filter.trim() }}”</template></p>
    </div>
  </main>
</template>

<style scoped>
.notes-view { min-width: 0; }
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
