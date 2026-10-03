<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'
import type { Bucket, Priority } from '@/mock/types'

export interface NewProjectTask {
  title: string
  why: string
  what: string
  done: string
  priority: Priority
  bucket: Bucket
}

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', payload: NewProjectTask): void
}>()

const title = ref('')
const why = ref('')
const what = ref('')
const done = ref('')
const priority = ref<Priority>('P2')
const bucket = ref<Bucket>('next')

const priorities: Priority[] = ['P1', 'P2', 'P3']
const buckets: Array<{ value: Bucket; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'next', label: 'A seguir' },
  { value: 'later', label: 'Mais tarde' },
  { value: 'someday', label: 'Algum dia' }
]

const canSave = computed(
  () => title.value.trim().length > 0 && why.value.trim().length > 0 && done.value.trim().length > 0
)

function save(): void {
  if (!canSave.value) return
  emit('save', {
    title: title.value.trim(),
    why: why.value.trim(),
    what: what.value.trim(),
    done: done.value.trim(),
    priority: priority.value,
    bucket: bucket.value
  })
}
</script>

<template>
  <div class="dlg-backdrop" @mousedown.self="emit('close')">
    <div role="dialog" aria-labelledby="project-task-title" class="dlg" @mousedown.stop="">
      <div class="dlg-head">
        <h2 id="project-task-title" class="dlg-title">Nova tarefa</h2>
        <p class="dlg-sub">Sem por quê e critério de pronto, não salva. A fricção é de propósito.</p>
      </div>
      <TextField label="Título" placeholder="Começa com verbo" v-model="title" />
      <TextField
        label="Por quê"
        placeholder="O que esta tarefa resolve e por que agora"
        :multiline="true"
        :rows="2"
        v-model="why"
      />
      <TextField
        label="O que fazer"
        placeholder="Passos concretos"
        :multiline="true"
        :rows="2"
        v-model="what"
      />
      <TextField label="Pronto quando" placeholder="Um teste observável" v-model="done" />
      <div class="dlg-picks">
        <div class="dlg-pick">
          <span class="dlg-pick-label">Prioridade</span>
          <div class="dlg-pick-row">
            <button
              v-for="option in priorities"
              :key="option"
              type="button"
              :aria-pressed="priority === option"
              :class="['dlg-pick-btn', 'mono', { 'is-on': priority === option }]"
              @click="priority = option"
            >
              {{ option }}
            </button>
          </div>
        </div>
        <div class="dlg-pick">
          <span class="dlg-pick-label">Domínio</span>
          <div class="dlg-pick-row">
            <button
              v-for="option in buckets"
              :key="option.value"
              type="button"
              :aria-pressed="bucket === option.value"
              :class="['dlg-pick-btn', { 'is-on': bucket === option.value }]"
              @click="bucket = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>
      <div class="dlg-actions">
        <Button variant="secondary" @click="emit('close')">Cancelar</Button>
        <Button variant="primary" :disabled="!canSave" @click="save">Criar tarefa</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 8vh;
  overflow: auto;
  background: rgb(13 17 23 / 32%);
}

.dlg {
  width: min(600px, calc(100vw - 32px));
  box-sizing: border-box;
  display: grid;
  gap: 20px;
  padding: 28px;
  margin-bottom: 48px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
}

.dlg-head {
  display: grid;
  gap: 4px;
}

.dlg-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--ink);
}

.dlg-sub {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
}

.dlg-picks {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.dlg-pick {
  display: grid;
  gap: 8px;
}

.dlg-pick-label {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  color: var(--ink);
}

.dlg-pick-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dlg-pick-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.dlg-pick-btn.mono {
  font-family: var(--font-mono);
}

.dlg-pick-btn.is-on {
  border-color: var(--norte);
  background: var(--norte-soft);
  color: var(--norte);
}

.dlg-pick-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
