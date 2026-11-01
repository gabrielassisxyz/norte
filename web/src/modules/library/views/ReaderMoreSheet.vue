<script setup lang="ts">
import { ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'

import ReaderActionSheet from './ReaderActionSheet.vue'

/**
 * What else can be done with the item: open the page it came from, or delete it.
 *
 * Deleting is permanent and there is no undo, so the row only asks; the item is
 * deleted by the owner once this has been confirmed, with the wording the
 * Library's own confirmation uses. Cancelling leaves the sheet as it was.
 */
defineProps<{ url: string; title: string; busy: boolean }>()

defineEmits<{ delete: []; close: [] }>()

const confirming = ref(false)
</script>

<template>
  <ReaderActionSheet kind="more" label="More actions" @close="$emit('close')">
    <a class="reader-sheet-row" :href="url" target="_blank" rel="noopener noreferrer" @click="$emit('close')">
      <Icon name="external" :size="18" />
      <span class="reader-sheet-row-label">Open the original</span>
    </a>
    <button
      type="button"
      class="reader-sheet-row reader-sheet-danger"
      data-action="delete"
      :disabled="busy"
      @click="confirming = true"
    >
      <Icon name="trash" :size="18" />
      <span class="reader-sheet-row-label">Delete</span>
    </button>
  </ReaderActionSheet>
  <div v-if="confirming" class="reader-confirm-backdrop" @click.self="confirming = false">
    <div class="reader-confirm" role="dialog" aria-labelledby="reader-delete-title">
      <h2 id="reader-delete-title">Delete “{{ title }}”?</h2>
      <p>
        This deletes the saved link and the highlights, margin notes and note written on it.
        Questions written from it are kept. There is no undo.
      </p>
      <div class="reader-confirm-buttons">
        <Button variant="secondary" data-action="cancel-delete" @click="confirming = false">Cancel</Button>
        <Button variant="primary" data-action="confirm-delete" :disabled="busy" @click="$emit('delete')">
          Delete the item
        </Button>
      </div>
    </div>
  </div>
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
  text-decoration: none;
  cursor: pointer;
}

.reader-sheet-danger { color: var(--danger); }
.reader-sheet-row:disabled { opacity: 0.6; }
.reader-sheet-row-label { flex: 1; }

.reader-sheet-row:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

/* The same question the Library asks, so it is dressed the same. */
.reader-confirm-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: rgb(13 17 23 / 32%); }
.reader-confirm { display: grid; width: min(480px, calc(100vw - 32px)); gap: var(--space-4); padding: 28px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.reader-confirm h2 { margin: 0; font-family: var(--font-display); font-size: 22px; font-weight: 650; line-height: 28px; }
.reader-confirm p { margin: 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.reader-confirm-buttons { display: flex; justify-content: flex-end; gap: var(--space-3); }
</style>
