<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { notesGainedNote } from '../data/revision'

/**
 * "Virar highlight" on the passage captured when the link was saved.
 *
 * It renders inside the reader's selection box, through the slot the library
 * exposes, so the library never names this module. With notes switched off
 * nothing registers for that slot and the box shows the passage alone — which
 * is what it did before notes existed.
 */
const props = defineProps<ReaderSlotProps>()

const { notes } = useSources()
const writing = useAsyncAction()
const stored = ref(false)

const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))
const selection = computed(() => {
  const exact = props.savedSelection?.exact?.trim()
  return exact ? props.savedSelection : null
})

/**
 * The saved selection's own three fields go to the server, not just its text.
 *
 * The extension captured the words around the passage at save time, and those
 * are what tell two occurrences of the same sentence apart; sending the passage
 * alone would make every repeated sentence ambiguous on arrival.
 */
async function turnIntoHighlight(): Promise<void> {
  const captured = selection.value
  if (!captured?.exact) return
  const created = await writing.run(() =>
    notes.addHighlight({
      item_id: props.itemId,
      exact: captured.exact ?? '',
      ...(captured.prefix ? { prefix: captured.prefix } : {}),
      ...(captured.suffix ? { suffix: captured.suffix } : {})
    })
  )
  if (!created) return
  stored.value = true
  notesGainedNote()
}
</script>

<template>
  <div v-if="allowed && selection" class="notes-selection-action">
    <Button
      v-if="!stored"
      data-action="virar-highlight"
      variant="secondary"
      size="sm"
      :disabled="writing.pending.value"
      @click="turnIntoHighlight"
    >
      Virar highlight
    </Button>
    <p v-else class="notes-selection-done" role="status">Trecho guardado nos highlights.</p>
    <p v-if="writing.error.value" class="notes-selection-error" role="alert">
      Não foi possível guardar: {{ writing.error.value }}
    </p>
  </div>
</template>

<style scoped>
.notes-selection-action { margin-top: var(--space-3); }
.notes-selection-done { margin: 0; color: var(--muted); font-size: 13px; line-height: 20px; }
.notes-selection-error { margin: var(--space-2) 0 0; color: var(--danger); font-size: 13px; line-height: 20px; }
</style>
