<script setup lang="ts">
import { computed } from 'vue'

import Icon from './Icon.vue'

export type QuestionKind = 'what' | 'why' | 'who' | 'when' | 'where' | 'how'

const props = withDefaults(
  defineProps<{
    kind: QuestionKind
    question: string
    status?: 'open' | 'answered'
    answer?: string
    topic?: string
    age?: string
  }>(),
  { status: 'open' }
)

const KIND_LABEL: Record<QuestionKind, string> = {
  what: 'O quê',
  why: 'Por quê',
  who: 'Quem',
  when: 'Quando',
  where: 'Onde',
  how: 'Como'
}

const answered = computed(() => props.status === 'answered')
</script>

<template>
  <article class="nt-q" :class="{ 'is-answered': answered }">
    <div class="nt-q-kind">{{ KIND_LABEL[kind] ?? kind }}</div>
    <div class="nt-q-body">
      <div class="nt-q-text">{{ question }}</div>
      <p v-if="answered && answer" class="nt-q-answer">{{ answer }}</p>
      <div class="nt-q-meta">
        <span v-if="answered" class="nt-q-state">
          <Icon name="check" :size="12" />
          Respondida
        </span>
        <span v-else>Aberta</span>
        <span v-if="topic">{{ topic }}</span>
        <span v-if="age" class="nt-q-age">{{ age }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.nt-q {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--line);
  max-width: 720px;
}
.nt-q-kind {
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 24px;
  font-weight: 600;
  color: var(--norte);
}
.nt-q-text {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  text-wrap: pretty;
}
.nt-q-answer {
  margin: var(--space-2) 0 0;
  font-size: 16px;
  line-height: 26px;
  color: var(--ink-2);
  max-width: 65ch;
}
.nt-q-meta {
  margin-top: var(--space-2);
  display: flex;
  gap: var(--space-3);
  align-items: center;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}
.nt-q-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--success);
  font-weight: 550;
}
.nt-q-age {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
