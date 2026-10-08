<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { coreLinksChanged } from '@/shell/data/revision'
import type { Subject } from '@/shell/data/source'
import SubjectPicker from '@/shell/SubjectPicker.vue'
import { useSources } from '@/sources'

import { libraryGainedItem } from '../data/revision'
import type { LibraryItemRecord, LibraryStatus } from '../data/source'
import { readerHref } from './items'

const route = useRoute()
const { library } = useSources()
const saving = useAsyncAction()
const saveOpen = ref(false)
const saveUrl = ref('')
const saveWhy = ref('')
const saveError = ref('')
const savedItem = ref<LibraryItemRecord | null>(null)
const savedDuplicate = ref(false)

/**
 * Where the saved item sits, in the dialog's own words.
 *
 * A new save always lands in the inbox; a duplicate keeps the shelf the
 * existing item is on, so the message names that shelf instead of claiming
 * the inbox.
 */
const SHELF_PHRASE: Record<LibraryStatus, string> = {
  inbox: 'na inbox',
  depois: 'em Depois',
  arquivo: 'no arquivo'
}

const savedShelfPhrase = computed(() =>
  savedItem.value ? (SHELF_PHRASE[savedItem.value.status] ?? savedItem.value.status) : ''
)
/**
 * The subjects the link is about, chosen before it is saved.
 *
 * They travel with the save as `link_to` rather than as a second call, so the
 * item and its links land in one transaction: a save that linked afterwards
 * would leave an unlinked item behind whenever that second call failed.
 */
const chosen = ref<Subject[]>([])
const chosenIds = computed(() => chosen.value.map((subject) => subject.id))

function openSave(): void {
  saveError.value = ''
  savedItem.value = null
  savedDuplicate.value = false
  chosen.value = []
  saveOpen.value = true
}

function closeSave(): void {
  saveOpen.value = false
  saveError.value = ''
}

function chooseSubject(subject: Subject): void {
  if (!chosen.value.some((candidate) => candidate.id === subject.id)) chosen.value.push(subject)
}

function dropSubject(id: string): void {
  chosen.value = chosen.value.filter((subject) => subject.id !== id)
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
  const linkTo = chosenIds.value
  const saved = await saving.run(() =>
    library.saveLink({
      url: url.toString(),
      ...(why ? { why } : {}),
      ...(linkTo.length ? { link_to: linkTo } : {})
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
  // The save created the links too, so every subject count on screen moved.
  if (linkTo.length > 0) coreLinksChanged()
  savedItem.value = saved.record
  savedDuplicate.value = saved.duplicate
  saveUrl.value = ''
  saveWhy.value = ''
  chosen.value = []
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
        <p v-if="savedDuplicate" class="save-done" role="status">
          Já estava salvo {{ savedShelfPhrase }}:
          <RouterLink :to="readerHref(savedItem)">{{ savedItem.title }}</RouterLink>
        </p>
        <p v-else class="save-done" role="status">
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
        <div class="save-subjects">
          <ul v-if="chosen.length > 0" class="save-chosen" aria-label="Assuntos escolhidos">
            <li v-for="subject in chosen" :key="subject.id">
              <button type="button" class="save-chip" @click="dropSubject(subject.id)">
                {{ subject.name }}
                <span aria-hidden="true">×</span>
                <span class="save-chip-hint">remover</span>
              </button>
            </li>
          </ul>
          <SubjectPicker label="Sobre qual assunto (opcional)" :chosen="chosenIds" @select="chooseSubject" />
        </div>
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
.save-subjects { display: grid; gap: var(--space-3); }
.save-chosen { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.save-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--sunken); color: var(--ink-2); cursor: pointer; font-family: var(--font-display); font-size: 13px; font-weight: 550; }
.save-chip:hover { border-color: var(--norte); color: var(--norte); }
.save-chip-hint { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
