<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { libraryGainedItem } from '../data/revision'

const route = useRoute()
const { library } = useSources()
const saving = useAsyncAction()
const saveOpen = ref(false)
const saveUrl = ref('')
const saveWhy = ref('')
const saveError = ref('')

function openSave(): void {
  saveError.value = ''
  saveOpen.value = true
}

function closeSave(): void {
  saveOpen.value = false
  saveError.value = ''
}

function linkTitle(url: URL): string {
  const path = url.pathname.split('/').filter(Boolean).pop()
  if (!path) return url.hostname
  return path.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').replace(/^./, (letter) => letter.toUpperCase())
}

async function saveLink(): Promise<void> {
  const value = saveUrl.value.trim()
  if (!value) {
    saveError.value = 'Informe uma URL para salvar.'
    return
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    saveError.value = 'Informe uma URL válida.'
    return
  }

  const saved = await saving.run(() =>
    library.saveLink({
      kind: 'post',
      title: linkTitle(url),
      author: saveWhy.value.trim() || url.hostname,
      url: url.toString()
    })
  )

  // A failed save keeps the dialog, the typed URL and the reason it failed.
  if (!saved) {
    saveError.value = `Não foi possível salvar: ${saving.error.value ?? 'erro desconhecido'}`
    return
  }

  // Nothing else on this screen can be handed the new item, so the lists that
  // are open ask again.
  libraryGainedItem()
  saveUrl.value = ''
  saveWhy.value = ''
  closeSave()
}

watch(
  () => route.query.save,
  (save) => {
    if (save === '1') openSave()
  },
  { immediate: true }
)
</script>

<template>
  <Button variant="secondary" icon="plus" @click="openSave">Salvar link</Button>

  <div v-if="saveOpen" class="save-backdrop" @mousedown.self="closeSave">
    <form class="save-dialog" role="dialog" aria-labelledby="save-title" @submit.prevent="saveLink">
      <div>
        <h2 id="save-title">Salvar link</h2>
        <p>Vai para a inbox para você retomar quando fizer sentido.</p>
      </div>
      <TextField v-model="saveUrl" label="URL" placeholder="https://…" type="url" />
      <TextField v-model="saveWhy" label="Por que salvar (opcional)" placeholder="Uma linha para o eu de daqui a um mês" :multiline="true" :rows="2" />
      <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
      <div class="save-buttons">
        <Button variant="secondary" @click="closeSave">Cancelar</Button>
        <Button variant="primary" type="submit" :disabled="!saveUrl.trim()">Salvar na inbox</Button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.save-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: rgb(13 17 23 / 32%); }
.save-dialog { display: grid; width: min(520px, calc(100vw - 32px)); gap: 20px; padding: 28px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.save-dialog h2 { margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 30px; font-weight: 650; }
.save-dialog p { margin: 4px 0 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.save-error { color: var(--danger) !important; }
.save-buttons { display: flex; justify-content: flex-end; gap: var(--space-3); }
</style>
