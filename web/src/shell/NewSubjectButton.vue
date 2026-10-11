<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { subjectsChanged } from './data/revision'

/**
 * Create a subject from wherever subjects are shown.
 *
 * It is one component rather than a dialog per screen because the Estudo home
 * and the subject page both offer it, and a second copy of the "the slug is
 * already taken" handling is a second place for it to be wrong.
 */
withDefaults(defineProps<{ label?: string }>(), { label: 'Novo assunto' })

const router = useRouter()
const { core } = useSources()
const creating = useAsyncAction()
const open = ref(false)
const name = ref('')
const failure = ref('')

function openDialog(): void {
  failure.value = ''
  name.value = ''
  open.value = true
}

function closeDialog(): void {
  open.value = false
  failure.value = ''
}

/**
 * On success the screen goes to the new subject, because the next thing a
 * person does with a subject they just named is put something in it.
 */
async function create(): Promise<void> {
  const typed = name.value.trim()
  if (!typed) {
    failure.value = 'Dê um nome ao assunto.'
    return
  }
  const created = await creating.run(() => core.createSubject(typed))
  if (!created) {
    failure.value = `Não foi possível criar: ${creating.error.value ?? 'erro desconhecido'}`
    return
  }
  open.value = false
  subjectsChanged()
  await router.push({ name: 'subject', params: { slug: created.slug } })
}
</script>

<template>
  <Button variant="secondary" icon="plus" @click="openDialog">{{ label }}</Button>

  <div v-if="open" class="new-subject-backdrop" @mousedown.self="closeDialog">
    <form class="new-subject-dialog" role="dialog" aria-labelledby="new-subject-title" @submit.prevent="create">
      <h2 id="new-subject-title">Novo assunto</h2>
      <TextField v-model="name" label="Nome" placeholder="Kubernetes, Escrita…" />
      <p v-if="failure" class="new-subject-error" role="alert">{{ failure }}</p>
      <div class="new-subject-buttons">
        <Button variant="secondary" @click="closeDialog">Cancelar</Button>
        <Button variant="primary" type="submit" :disabled="!name.trim() || creating.pending.value">Criar</Button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.new-subject-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
  background: rgb(13 17 23 / 32%);
}
.new-subject-dialog {
  display: grid;
  width: min(460px, calc(100vw - 32px));
  gap: var(--space-4);
  padding: 28px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}
.new-subject-dialog h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 650;
  line-height: 28px;
}
.new-subject-error {
  margin: 0;
  color: var(--danger);
  font-size: 14px;
  line-height: 22px;
}
.new-subject-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
