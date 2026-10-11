<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', payload: { did: string; stuck: string; next: string }): void
}>()

const did = ref('')
const stuck = ref('')
const next = ref('')

const canSave = computed(() => did.value.trim().length > 0 && next.value.trim().length > 0)

function save(): void {
  if (!canSave.value) return
  emit('save', { did: did.value.trim(), stuck: stuck.value.trim(), next: next.value.trim() })
}
</script>

<template>
  <div class="dlg-backdrop" @mousedown.self="emit('close')">
    <div role="dialog" aria-labelledby="project-session-title" class="dlg" @mousedown.stop="">
      <div class="dlg-head">
        <h2 id="project-session-title" class="dlg-title">Log session</h2>
        <p class="dlg-sub">
          Thirty seconds at the end of the day. The last line becomes the next step at the top of the project.
        </p>
      </div>
      <TextField label="What I did" placeholder="One line" v-model="did" />
      <TextField label="What got stuck (optional)" placeholder="Pending decision, bug, question" v-model="stuck" />
      <TextField label="Next step" placeholder="The first thing of the next session" v-model="next" />
      <div class="dlg-actions">
        <Button variant="secondary" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :disabled="!canSave" @click="save">Log</Button>
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
