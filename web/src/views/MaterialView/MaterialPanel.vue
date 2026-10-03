<script setup lang="ts">
import { ref } from 'vue'

import AnnotationItem from '../../components/ds/AnnotationItem.vue'
import Button from '../../components/ds/Button.vue'
import SidePanel from '../../components/ds/SidePanel.vue'
import type { TabItem } from '../../components/ds/types'
import type { MaterialKind } from '../../mock/types'

interface PanelAnnotation {
  id: string
  quote?: string
  note?: string
  n?: number
  location?: string
  time?: string
}

defineProps<{
  kind: MaterialKind
  tabs: TabItem[]
  annotations: PanelAnnotation[]
  modelValue: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:collapsed': [value: boolean]
  addAnnotation: [value: string]
}>()

const draft = ref('')

function submitAnnotation(): void {
  const value = draft.value.trim()
  if (!value) return
  emit('addAnnotation', value)
  draft.value = ''
}

function prepareHighlightNote(quote?: string): void {
  if (quote) draft.value = `Revisar: ${quote}`
}
</script>

<template>
  <SidePanel
    :tabs="tabs"
    :model-value="modelValue"
    :collapsed="collapsed"
    label="Nota e anotações"
    @update:model-value="emit('update:modelValue', $event)"
    @update:collapsed="emit('update:collapsed', $event)"
  >
    <template #panel-note>
      <div class="panel-note-tools" role="toolbar" aria-label="Formatação da nota">
        <button type="button" aria-label="Título">H</button>
        <button type="button" aria-label="Negrito">B</button>
        <button type="button" aria-label="Lista">•</button>
        <span class="material-mono">salvo agora</span>
      </div>
      <div class="panel-note-document">
        <h3>Ideia central</h3>
        <p>Uma leitura fica mais útil quando deixa uma pergunta e um próximo experimento.</p>
        <h3>O que quero lembrar</h3>
        <ul>
          <li>Descrever antes de interpretar.</li>
          <li>Separar familiaridade de recuperação.</li>
          <li>Escrever previsões que possam falhar.</li>
        </ul>
        <h3>Próximo passo</h3>
        <p>Retomar uma anotação durante a próxima sessão e comparar o que mudou.</p>
      </div>
    </template>

    <template #panel-annotations>
      <div class="panel-annotation-compose">
        <label for="new-material-annotation">Nova anotação</label>
        <textarea
          id="new-material-annotation"
          v-model="draft"
          placeholder="Uma ideia sobre o material, ou selecione um trecho para anotar…"
        />
        <div class="panel-compose-actions">
          <span v-if="kind === 'paper'" class="panel-compose-hint">Registre a evidência que quer rever.</span>
          <Button size="sm" :disabled="!draft.trim()" @click="submitAnnotation">Anotar</Button>
        </div>
      </div>

      <div class="panel-annotation-list">
        <AnnotationItem
          v-for="annotation in annotations"
          :key="annotation.id"
          :kind="annotation.quote ? (annotation.note ? 'linked' : 'highlight') : 'loose'"
          :quote="annotation.quote"
          :note="annotation.note"
          :n="annotation.n"
          :location="annotation.location"
          :time="annotation.time"
          @add-note="prepareHighlightNote(annotation.quote)"
        />
        <p v-if="annotations.length === 0" class="panel-empty">Ainda não há anotações neste material.</p>
      </div>
    </template>
  </SidePanel>
</template>

<style scoped>
.panel-note-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.panel-note-tools button {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
}

.panel-note-tools button:hover {
  background: var(--sunken);
  color: var(--ink);
}

.panel-note-tools button:focus-visible,
.panel-annotation-compose textarea:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.panel-note-tools .material-mono {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}

.panel-note-document h3 {
  margin: 20px 0 6px;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 650;
}

.panel-note-document p,
.panel-note-document li {
  color: var(--ink-2);
  font-size: 15px;
  line-height: 24px;
}

.panel-note-document p {
  margin: 0;
}

.panel-note-document ul {
  margin: 0;
  padding-left: 18px;
}

.panel-annotation-compose {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.panel-annotation-compose label {
  display: block;
  margin-bottom: 8px;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
}

.panel-annotation-compose textarea {
  display: block;
  width: 100%;
  min-height: 84px;
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

.panel-annotation-compose textarea::placeholder {
  color: var(--muted);
}

.panel-compose-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.panel-compose-hint {
  margin-right: auto;
  color: var(--muted);
  font-size: 11px;
  line-height: 16px;
}

.panel-annotation-list {
  margin-top: 12px;
}

.panel-empty {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}

.material-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
