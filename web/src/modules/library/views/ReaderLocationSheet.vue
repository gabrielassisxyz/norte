<script setup lang="ts">
import Icon from '@/components/ds/Icon.vue'
import type { IconName } from '@/components/ds/types'

import type { LibraryLocation } from '../data/source'
import ReaderActionSheet from './ReaderActionSheet.vue'

/**
 * Where the item is, and the other places it can go.
 *
 * Choosing a row is the whole interaction, so it asks for the move and for the
 * sheet to close in the same tap; the current row is ticked and asking for it
 * again is the reader's to ignore.
 */
defineProps<{
  location: LibraryLocation
  locations: ReadonlyArray<{ location: LibraryLocation; label: string }>
  busy: boolean
}>()

const emit = defineEmits<{ move: [LibraryLocation]; close: [] }>()

const ICONS: Record<LibraryLocation, IconName> = {
  inbox: 'tray',
  up_next: 'skipForward',
  later: 'clock',
  archive: 'archive',
  stash: 'cube'
}

function choose(target: LibraryLocation): void {
  emit('move', target)
  emit('close')
}
</script>

<template>
  <ReaderActionSheet kind="location" label="Move this item" @close="emit('close')">
    <button
      v-for="action in locations"
      :key="action.location"
      type="button"
      class="reader-sheet-row"
      :data-action="`location-${action.location}`"
      :aria-pressed="location === action.location"
      :disabled="busy"
      @click="choose(action.location)"
    >
      <Icon :name="ICONS[action.location]" :size="18" />
      <span class="reader-sheet-row-label">{{ action.label }}</span>
      <Icon v-if="location === action.location" name="check" :size="18" />
    </button>
  </ReaderActionSheet>
</template>

<style scoped>
.reader-sheet-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.reader-sheet-row[aria-pressed='true'] { background: var(--norte-soft); color: var(--norte); }
.reader-sheet-row:disabled { opacity: 0.6; }
.reader-sheet-row-label { flex: 1; }

.reader-sheet-row:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
