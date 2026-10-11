<script setup lang="ts">
import Button from '@/components/ds/Button.vue'
import type { MaterialKind } from '@/mock/types'

import type { LibraryItemRecord } from '../../data/source'

const props = defineProps<{
  kind: MaterialKind
  material: LibraryItemRecord
  answer: string
  submitted: boolean
}>()

const emit = defineEmits<{
  'update:answer': [value: string]
  submit: []
}>()

const baseDone = props.kind === 'book' ? 0 : 1
</script>

<template>
  <section class="material-exercises" aria-labelledby="material-exercises-title">
    <div class="exercise-column">
      <div class="exercise-heading">
        <h1 id="material-exercises-title">Exercises</h1>
        <span class="material-mono">{{ baseDone + (submitted ? 1 : 0) }}/3 done</span>
      </div>
      <p class="exercise-intro">
        <span class="exercise-material-title">{{ material.title }}</span> · The
        {{ kind === 'book' ? 'book' : kind === 'paper' ? 'paper' : 'text' }} and your annotations stay out of sight here.
        Answer from memory; then compare with the original.
      </p>

      <div class="exercise-list">
        <article class="exercise-item" :class="{ 'is-done': baseDone > 0 }">
          <span class="exercise-number material-mono">{{ baseDone > 0 ? '✓' : '01' }}</span>
          <div>
            <div class="exercise-kind">Explain without looking</div>
            <p class="exercise-prompt">
              {{ kind === 'paper' ? 'Explain the central idea of the paper in three sentences.' : kind === 'book' ? 'What is the difference between recognizing an idea and being able to recall it?' : 'Describe the path from an observation to a testable hypothesis.' }}
            </p>
            <p v-if="baseDone > 0" class="exercise-reference">
              A short answer should name what was observed, what was predicted, and how to compare the two.
            </p>
            <div v-if="baseDone > 0" class="exercise-meta"><span>Done</span><span class="material-mono">just now</span></div>
          </div>
        </article>

        <article class="exercise-item" :class="{ 'is-done': submitted }">
          <span class="exercise-number material-mono">{{ submitted ? '✓' : '02' }}</span>
          <div class="exercise-main">
            <div class="exercise-kind">Apply</div>
            <p class="exercise-prompt">
              Write down a situation from your week where a prediction could have been compared with the outcome.
            </p>
            <label class="visually-hidden" for="material-answer">Answer</label>
            <textarea
              id="material-answer"
              class="exercise-field"
              :value="answer"
              :disabled="submitted"
              placeholder="Answer without looking at the material…"
              @input="emit('update:answer', ($event.target as HTMLTextAreaElement).value)"
            />
            <div v-if="submitted" class="exercise-meta"><span>Done</span><span class="material-mono">just now</span></div>
            <div v-else class="exercise-actions">
              <a href="/notas?tab=anotacoes">Open the annotations</a>
              <Button size="sm" variant="primary" :disabled="answer.trim().length < 10" @click="emit('submit')">Send the answer</Button>
            </div>
            <p v-if="!submitted && answer.trim().length > 0 && answer.trim().length < 10" class="exercise-hint">
              Write at least 10 characters to send.
            </p>
          </div>
        </article>

        <article class="exercise-item">
          <span class="exercise-number material-mono">03</span>
          <div>
            <div class="exercise-kind">Connect</div>
            <p class="exercise-prompt">Pick a recent note and write down what next test it suggests.</p>
            <a class="exercise-link" href="/notas?tab=anotacoes">Open the annotations</a>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.material-exercises {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.exercise-column {
  max-width: 680px;
  margin: 0 auto;
  padding: 56px 32px 112px;
}

.exercise-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.exercise-heading h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 40px;
  line-height: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.exercise-heading > span {
  color: var(--muted);
  font-size: 13px;
}

.exercise-intro {
  max-width: 60ch;
  margin: 12px 0 0;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 26px;
}

.exercise-material-title {
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 600;
}

.exercise-list {
  margin-top: 28px;
  border-top: 1px solid var(--line);
}

.exercise-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 16px;
  padding: 28px 0;
  border-bottom: 1px solid var(--line);
}

.exercise-number {
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}

.exercise-item.is-done .exercise-number,
.exercise-meta span:first-child {
  color: var(--success);
}

.exercise-kind {
  color: var(--norte);
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
}

.exercise-prompt {
  margin: 6px 0 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.exercise-reference {
  margin: 10px 0 0;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 24px;
}

.exercise-main {
  min-width: 0;
}

.exercise-field {
  display: block;
  width: 100%;
  min-height: 120px;
  margin-top: 14px;
  padding: 10px 12px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--ground);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
}

.exercise-field::placeholder {
  color: var(--muted);
}

.exercise-field:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.exercise-field:disabled {
  color: var(--ink-2);
  opacity: 0.8;
}

.exercise-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.exercise-actions a,
.exercise-link {
  color: var(--link);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
}

.exercise-actions a:hover,
.exercise-link:hover {
  text-decoration: underline;
}

.exercise-link {
  display: inline-flex;
  margin-top: 14px;
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.exercise-meta {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.exercise-hint {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 16px;
}

.material-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 860px) {
  .material-exercises {
    overflow: visible;
  }

  .exercise-column {
    padding: 32px 16px 72px;
  }

  .exercise-heading h1 {
    font-size: 32px;
    line-height: 36px;
  }
}
</style>
