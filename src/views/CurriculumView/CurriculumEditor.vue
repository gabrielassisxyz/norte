<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'
import type { CurriculumDraft, EditableModule } from './curriculum'

const props = defineProps<{
  mode: 'new' | 'edit'
  title: string
  goal: string
  modules: EditableModule[]
}>()

const emit = defineEmits<{ save: [draft: CurriculumDraft]; cancel: [] }>()

const draftTitle = ref(props.title)
const draftGoal = ref(props.goal)
const draftModules = ref<EditableModule[]>(props.modules.map((module) => ({ ...module })))

const heading = computed(() => (props.mode === 'new' ? 'Novo currículo' : 'Editar currículo'))
const saveLabel = computed(() => (props.mode === 'new' ? 'Criar currículo' : 'Salvar'))
const cannotSave = computed(() => draftTitle.value.trim().length === 0 || draftGoal.value.trim().length === 0)

function save(): void {
  if (cannotSave.value) return
  emit('save', {
    title: draftTitle.value.trim(),
    goal: draftGoal.value.trim(),
    modules: draftModules.value.map((module) => ({ id: module.id, title: module.title.trim() })).filter((module) => module.title.length > 0)
  })
}
</script>

<template>
  <form class="editor" @submit.prevent="save">
    <h1 class="editor-heading">{{ heading }}</h1>
    <TextField
      v-model="draftTitle"
      label="Título"
      placeholder="O assunto, como você o chama"
    />
    <TextField
      v-model="draftGoal"
      label="Objetivo"
      multiline
      :rows="2"
      placeholder="Conseguir… (uma capacidade, não um tópico)"
    />
    <div v-if="draftModules.length > 0" class="editor-modules">
      <TextField
        v-for="(module, index) in draftModules"
        :key="module.id"
        v-model="draftModules[index].title"
        :label="`Módulo ${index + 1}`"
      />
    </div>
    <p class="editor-hint">
      Materiais e exercícios são adicionados depois, na própria página. Um currículo novo nasce com
      um módulo vazio.
    </p>
    <div class="editor-actions">
      <Button variant="primary" :disabled="cannotSave" @click="save">{{ saveLabel }}</Button>
      <Button variant="secondary" @click="$emit('cancel')">Cancelar</Button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 20px;
  max-width: 600px;
}

.editor-heading {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 44px;
}

.editor-modules {
  display: grid;
  gap: var(--space-3);
}

.editor-hint {
  margin: 0;
  max-width: 60ch;
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}

.editor-actions {
  display: flex;
  gap: var(--space-3);
}
</style>
