<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import QuestionItem from '@/components/ds/QuestionItem.vue'
import { formatDayAge, formatShortDate, todayIsoDate } from '@/lib/clock'

import { useNotesQuestionSet } from '../data/composables'
import { QUESTION_KIND_LABELS } from '../data/source'

/** One question set: its topic, and the questions the person actually wrote. */
const route = useRoute()

const setId = computed(() => (Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) ?? '')
const { data: set, loading, error, refresh } = useNotesQuestionSet(setId)

const firstLoad = computed(() => loading.value && set.value === null)
const questions = computed(() => set.value?.questions ?? [])
</script>

<template>
  <main v-if="firstLoad" class="set-view set-state" role="status">
    <p>Carregando o conjunto…</p>
  </main>

  <main v-else-if="error" class="set-view set-state" role="alert">
    <p>Não foi possível carregar o conjunto: {{ error }}</p>
    <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
  </main>

  <main v-else-if="!set" class="set-view set-state">
    <p>Este conjunto não existe.</p>
    <RouterLink :to="{ name: 'notas-conjuntos' }">Voltar para os conjuntos</RouterLink>
  </main>

  <main v-else class="set-view">
    <div class="set-inner">
      <header class="set-head">
        <h1>{{ set.topic }}</h1>
        <RouterLink class="set-back" :to="{ name: 'notas-conjuntos' }">Conjuntos</RouterLink>
      </header>
      <p class="set-meta">
        <span class="set-mono">{{ set.question_count === 1 ? '1 pergunta' : `${set.question_count} perguntas` }}</span>
        <span class="set-mono">{{ formatShortDate(set.created_at) }}</span>
      </p>

      <p v-if="questions.length === 0" class="set-state">
        Este conjunto foi aberto sem perguntas. Nada foi guardado além do tema.
      </p>

      <article v-for="question in questions" :key="question.id" class="set-question">
        <span v-if="question.kind" class="set-kind">{{ QUESTION_KIND_LABELS[question.kind] }}</span>
        <QuestionItem
          :kind="question.kind ?? 'what'"
          :question="question.text"
          :status="question.status === 'answered' ? 'answered' : 'open'"
          :answer="question.answer"
          :age="formatDayAge(question.created_at, todayIsoDate())"
        />
      </article>
    </div>
  </main>
</template>

<style scoped>
.set-view { min-width: 0; }
.set-inner { max-width: 760px; margin: 0 auto; padding-top: 28px; }
.set-state { display: grid; gap: var(--space-4); justify-items: start; max-width: 48ch; padding: 48px 24px; color: var(--muted); font-size: 15px; line-height: 24px; }
.set-state p { margin: 0; }
.set-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
.set-head h1 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.03em; line-height: 36px; }
.set-back { font-family: var(--font-display); font-size: 13px; font-weight: 550; text-decoration: none; }
.set-back:hover { text-decoration: underline; }
.set-meta { display: flex; gap: var(--space-4); margin: var(--space-2) 0 32px; }
.set-mono { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }
.set-question { display: grid; gap: var(--space-1); }
.set-kind { color: var(--muted); font-family: var(--font-display); font-size: 12px; font-weight: 550; }
</style>
