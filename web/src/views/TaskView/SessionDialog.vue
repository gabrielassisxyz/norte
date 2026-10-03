<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', payload: { did: string; next: string }): void
}>()

const did = ref('')
const next = ref('')

const canSave = computed(() => did.value.trim().length > 0 && next.value.trim().length > 0)

function save(): void {
  if (!canSave.value) return
  emit('save', { did: did.value.trim(), next: next.value.trim() })
}
</script>

<template>
  <div class="dlg-backdrop" @mousedown.self="emit('close')">
    <div role="dialog" aria-labelledby="task-session-title" class="dlg" @mousedown.stop="">
      <div class="dlg-head">
        <h2 id="task-session-title" class="dlg-title">Registrar sessão</h2>
        <p class="dlg-sub">Nesta tarefa. A última linha vira o próximo passo do projeto.</p>
      </div>
      <TextField label="O que fiz" placeholder="Uma linha" v-model="did" />
      <TextField
        label="Próximo passo"
        placeholder="A primeira coisa da próxima sessão"
        v-model="next"
      />
      <div class="dlg-actions">
        <Button variant="secondary" @click="emit('close')">Cancelar</Button>
        <Button variant="primary" :disabled="!canSave" @click="save">Registrar</Button>
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
  padding-top: 12vh;
  overflow: auto;
  background: rgb(13 17 23 / 32%);
}

.dlg {
  width: min(560px, calc(100vw - 32px));
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

.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
