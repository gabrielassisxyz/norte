<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { libraryGainedItem } from '../data/revision'
import type { LibraryItemRecord } from '../data/source'
import { readerHref } from './items'

const route = useRoute()
const { library } = useSources()
const saving = useAsyncAction()
const saveOpen = ref(false)
const saveUrl = ref('')
const saveWhy = ref('')
const saveError = ref('')
const savedItem = ref<LibraryItemRecord | null>(null)

function openSave(): void {
  saveError.value = ''
  savedItem.value = null
  saveOpen.value = true
}

function closeSave(): void {
  saveOpen.value = false
  saveError.value = ''
}

/**
 * The dialog sends the address and the reason, and nothing else.
 *
 * The kind, the title, the author and the date are the server's to decide — it
 * reads them out of the page it fetches — so a dialog that guessed a title from
 * the URL would be overwritten by extraction seconds later, and would be the
 * title in the list until then.
 */
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

  const why = saveWhy.value.trim()
  const saved = await saving.run(() => library.saveLink({ url: url.toString(), ...(why ? { why } : {}) }))

  // A failed save keeps the dialog, the typed URL and the reason it failed.
  if (!saved) {
    saveError.value = `Não foi possível salvar: ${saving.error.value ?? 'erro desconhecido'}`
    return
  }

  // Nothing else on this screen can be handed the new item, so the lists that
  // are open ask again.
  libraryGainedItem()
  savedItem.value = saved
  saveUrl.value = ''
  saveWhy.value = ''
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
      <template v-if="savedItem">
        <p class="save-done" role="status">
          Salvo na inbox:
          <RouterLink :to="readerHref(savedItem)">{{ savedItem.title }}</RouterLink>
        </p>
        <div class="save-buttons">
          <Button variant="secondary" @click="closeSave">Fechar</Button>
          <Button variant="primary" @click="savedItem = null">Salvar outro</Button>
        </div>
      </template>
      <template v-else>
        <TextField v-model="saveUrl" label="URL" placeholder="https://…" type="url" />
        <TextField v-model="saveWhy" label="Por que salvar (opcional)" placeholder="Uma linha para o eu de daqui a um mês" :multiline="true" :rows="2" />
        <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
        <div class="save-buttons">
          <Button variant="secondary" @click="closeSave">Cancelar</Button>
          <Button variant="primary" type="submit" :disabled="!saveUrl.trim()">Salvar na inbox</Button>
        </div>
      </template>
    </form>
  </div>
</template>

<style scoped>
.save-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: rgb(13 17 23 / 32%); }
.save-dialog { display: grid; width: min(520px, calc(100vw - 32px)); gap: 20px; padding: 28px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.save-dialog h2 { margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 30px; font-weight: 650; }
.save-dialog p { margin: 4px 0 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.save-error { color: var(--danger) !important; }
.save-done { margin: 0; font-size: 14px; line-height: 22px; }
.save-done a { color: var(--norte); }
.save-buttons { display: flex; justify-content: flex-end; gap: var(--space-3); }
</style>
