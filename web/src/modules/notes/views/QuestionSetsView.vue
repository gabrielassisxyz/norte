<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatShortDate } from '@/lib/clock'
import { useSources } from '@/sources'

import { useNotesQuestionSets } from '../data/composables'
import { notesGainedNote } from '../data/revision'
import { QUESTION_KINDS, QUESTION_KIND_LABELS, type QuestionKind } from '../data/source'

/**
 * A question set: one topic, the six prompts, and the sets already opened.
 *
 * Only the prompts the person wrote into are stored. Six empty boxes are six
 * questions nobody asked, and a set full of them would turn the Questions list
 * into a list of the form rather than of what the person wondered about.
 */
const router = useRouter()
const { notes } = useSources()

const topic = ref('')
const drafts = reactive<Record<QuestionKind, string>>({
  what: '',
  why: '',
  who: '',
  when: '',
  where: '',
  how: ''
})
const formError = ref('')

const sets = useNotesQuestionSets()
const writing = useAsyncAction()

const rows = computed(() => sets.data.value?.items ?? [])
const firstLoad = computed(() => sets.loading.value && sets.data.value === null)
const written = computed(() => QUESTION_KINDS.filter((kind) => drafts[kind].trim() !== ''))

async function createSet(): Promise<void> {
  const subject = topic.value.trim()
  if (!subject) {
    formError.value = 'A set needs a topic.'
    return
  }
  const created = await writing.run(() =>
    notes.addQuestionSet({
      topic: subject,
      questions: written.value.map((kind) => ({ kind, text: drafts[kind].trim() }))
    })
  )
  if (!created) {
    formError.value = `Could not save: ${writing.error.value ?? 'unknown error'}`
    return
  }
  notesGainedNote()
  formError.value = ''
  topic.value = ''
  for (const kind of QUESTION_KINDS) drafts[kind] = ''
  await router.push({ name: 'notes-question-set', params: { id: created.id } })
}
</script>

<template>
  <main class="sets-view">
    <div class="sets-inner">
      <header class="sets-head">
        <h1>Question sets</h1>
        <RouterLink class="sets-back" :to="{ name: 'notes', query: { tab: 'questions' } }">Questions</RouterLink>
      </header>

      <form class="sets-form" @submit.prevent="createSet">
        <label for="set-topic">Topic</label>
        <input id="set-topic" v-model="topic" type="text" placeholder="E.g.: Kubernetes" @input="formError = ''" />

        <p class="sets-hint">
          Write down only the questions you actually have. A blank field stores no question.
        </p>

        <div v-for="kind in QUESTION_KINDS" :key="kind" class="sets-prompt">
          <label :for="`set-prompt-${kind}`">{{ QUESTION_KIND_LABELS[kind] }}</label>
          <textarea :id="`set-prompt-${kind}`" v-model="drafts[kind]" rows="2" />
        </div>

        <p v-if="formError" class="sets-error" role="alert">{{ formError }}</p>
        <div class="sets-submit">
          <span class="sets-counter">{{ written.length }} of 6 filled in</span>
          <Button data-action="create-set" variant="primary" type="submit" :disabled="writing.pending.value">
            Open set
          </Button>
        </div>
      </form>

      <section class="sets-list" aria-label="Sets already opened">
        <p v-if="firstLoad" class="sets-state" role="status">Loading the sets…</p>
        <div v-else-if="sets.error.value" class="sets-state" role="alert">
          <p>Could not load the sets: {{ sets.error.value }}</p>
          <Button variant="secondary" @click="sets.refresh()">Try again</Button>
        </div>
        <template v-else>
          <p v-if="rows.length === 0" class="sets-state">No sets yet.</p>
          <article v-for="set in rows" :key="set.id" class="sets-row">
            <RouterLink :to="{ name: 'notes-question-set', params: { id: set.id } }">{{ set.topic }}</RouterLink>
            <span class="sets-mono">{{ set.question_count === 1 ? '1 question' : `${set.question_count} questions` }}</span>
            <span class="sets-mono">{{ formatShortDate(set.created_at) }}</span>
          </article>
          <Button
            v-if="sets.hasMore.value"
            data-action="load-more"
            variant="secondary"
            :disabled="sets.loadingMore.value"
            @click="sets.loadMore()"
          >
            Load more
          </Button>
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped>
.sets-view { min-width: 0; }
.sets-inner { max-width: 760px; margin: 0 auto; padding-top: 28px; }
.sets-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
.sets-head h1 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.03em; line-height: 36px; }
.sets-back { font-family: var(--font-display); font-size: 13px; font-weight: 550; text-decoration: none; }
.sets-back:hover { text-decoration: underline; }
.sets-form { display: grid; gap: var(--space-3); margin-top: 32px; }
.sets-form label { font-family: var(--font-display); font-size: 14px; font-weight: 550; }
.sets-form input, .sets-form textarea {
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
.sets-form textarea { resize: vertical; }
.sets-form input:focus-visible, .sets-form textarea:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.sets-hint { margin: 0; color: var(--muted); font-size: 13px; line-height: 20px; }
.sets-prompt { display: grid; gap: var(--space-1); }
.sets-error { margin: 0; color: var(--danger); font-size: 13px; line-height: 20px; }
.sets-submit { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-4); }
.sets-counter { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
.sets-list { display: grid; gap: var(--space-3); margin-top: 48px; padding-top: var(--space-4); border-top: 1px solid var(--line); }
.sets-state { margin: 0; color: var(--muted); font-size: 15px; line-height: 24px; }
.sets-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
.sets-row a { font-family: var(--font-display); font-size: 15px; font-weight: 550; text-decoration: none; }
.sets-row a:hover { text-decoration: underline; }
.sets-mono { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
</style>
