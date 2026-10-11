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

const TABS: NoteTab[] = ['highlights', 'annotations', 'questions']
const TAB_LABELS: Record<NoteTab, string> = {
  highlights: 'Highlights',
  annotations: 'Annotations',
  questions: 'Questions'
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
const annotations = useNotesAnnotations(query, () => tab.value === 'annotations')
const questions = useNotesQuestions(query, () => tab.value === 'questions')
const { data: counts } = useNotesSummary()
const writing = useAsyncAction()

const active = computed(() => {
  if (tab.value === 'highlights') return highlights
  if (tab.value === 'annotations') return annotations
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
 * notes on, which the registry gave us with each row. "No material" is the
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
  return [...byId.values()].sort((first, second) => first.title.localeCompare(second.title, 'en'))
})

const emptyText = computed(() => {
  if (filter.value.trim()) return `Nothing found for “${filter.value.trim()}”.`
  if (tab.value === 'highlights') return 'No highlights yet. Whatever you mark while reading shows up here.'
  if (tab.value === 'annotations') return 'No annotations yet.'
  return 'No questions yet.'
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
  return `/library/${source.id}`
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
  await router.replace({ name: 'notes', query: { ...route.query, tab: value } })
}

async function addQuestion(): Promise<void> {
  const text = questionText.value.trim()
  if (!text.endsWith('?')) {
    questionError.value = 'A question has to end with “?”.'
    return
  }

  const created = await writing.run(() =>
    notesSource.addQuestion({ text, ...(questionItem.value ? { item_id: questionItem.value } : {}) })
  )
  if (!created) {
    questionError.value = `Could not save: ${writing.error.value ?? 'unknown error'}`
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
          <SegmentedControl :model-value="tab" :options="options" label="Kind of note" @change="selectTab" />
        </div>
        <RouterLink class="notes-sets-link" :to="{ name: 'notes-question-sets' }">Question sets</RouterLink>
        <label class="notes-filter-label" for="notes-filter">Filter</label>
        <input
          id="notes-filter"
          v-model="filter"
          class="notes-filter"
          type="search"
          placeholder="Filter by text or source…"
        />
      </header>

      <p v-if="firstLoad" class="notes-state" role="status">Loading the notes…</p>

      <div v-else-if="error" class="notes-state" role="alert">
        <p>The notes could not be loaded: {{ error }}</p>
        <Button variant="secondary" @click="active.refresh()">Try again</Button>
      </div>

      <section v-else-if="tab === 'highlights'" aria-label="Highlights list" class="notes-highlights">
        <p v-if="shownCount === 0" class="notes-state">{{ emptyText }}</p>
        <article v-for="highlight in highlights.data.value?.items ?? []" :key="highlight.id" class="notes-highlight">
          <Highlight
            :quote="highlight.exact"
            :source="highlight.source?.title ?? 'Unknown source'"
            :timestamp="formatShortDate(highlight.created_at)"
            :href="sourcePath(highlight.source)"
          />
          <p v-if="highlight.status === 'orphaned'" class="notes-orphaned">
            This passage is no longer in the extracted text.
          </p>
          <div v-if="sourcePath(highlight.source)" class="notes-links">
            <RouterLink :to="sourcePath(highlight.source)!">Open the source</RouterLink>
          </div>
        </article>
      </section>

      <section v-else-if="tab === 'annotations'" aria-label="Annotations list" class="notes-annotations">
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
            <RouterLink :to="sourcePath(annotation.source)!">Open the source</RouterLink>
          </div>
        </article>
      </section>

      <section v-else aria-labelledby="new-question-title" class="notes-questions">
        <form class="notes-question-form" @submit.prevent="addQuestion">
          <label id="new-question-title" for="new-question">New question</label>
          <label class="notes-filter-label" for="new-question-item">Source material</label>
          <select id="new-question-item" v-model="questionItem">
            <option value="">No material</option>
            <option v-for="item in questionItems" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
          <textarea
            id="new-question"
            v-model="questionText"
            rows="2"
            placeholder="Ends with “?”. E.g.: Why is the forgetting curve exponential?"
            aria-describedby="question-error"
            @input="questionError = ''"
          />
          <p v-if="questionError" id="question-error" class="notes-question-error" role="alert">{{ questionError }}</p>
          <div class="notes-submit"><Button variant="primary" type="submit">Add to the list</Button></div>
        </form>

        <div class="notes-question-list" aria-label="Questions list">
          <p v-if="shownCount === 0" class="notes-state">{{ emptyText }}</p>
          <article v-for="question in questions.data.value?.items ?? []" :key="question.id" class="notes-question">
            <QuestionItem
              :kind="question.kind"
              :question="question.text"
              :status="question.status"
              :answer="question.answer"
              :topic="question.source?.title"
              :age="formatDayAge(question.created_at, todayIsoDate())"
            />
            <div v-if="sourcePath(question.source)" class="notes-links">
              <RouterLink :to="sourcePath(question.source)!">Open the source</RouterLink>
            </div>
          </article>
        </div>
      </section>

      <div v-if="!firstLoad && !error" class="notes-foot">
        <p v-if="active.loadMoreError.value" class="notes-question-error" role="alert">
          Could not load more: {{ active.loadMoreError.value }}
        </p>
        <Button
          v-if="active.hasMore.value"
          data-action="load-more"
          variant="secondary"
          :disabled="active.loadingMore.value"
          @click="active.loadMore()"
        >
          Load more
        </Button>
        <p class="notes-count">
          {{ shownCount }} {{ shownCount === 1 ? 'item' : 'items'
          }}<template v-if="filter.trim()"> for “{{ filter.trim() }}”</template>
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
