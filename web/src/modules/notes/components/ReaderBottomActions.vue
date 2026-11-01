<script setup lang="ts">
import { computed } from 'vue'

import Icon from '@/components/ds/Icon.vue'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'

/**
 * The three ways into the reader's notes sheet on a phone: a note, a question,
 * and the notebook as a whole.
 *
 * They are icons in the reader's bottom strip, so each carries its name as an
 * `aria-label` and a `title` instead of text. It renders nothing on a wide
 * screen, where the panel these would open is already on the page -- a button
 * that reveals something visible is worse than no button. The section names are
 * this module's own; the reader carries them to the panel without reading them.
 */
const props = defineProps<ReaderSlotProps>()

const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))
</script>

<template>
  <div v-if="allowed && phone" class="notes-bottom-actions">
    <button
      type="button"
      class="notes-strip-button"
      data-action="annotate-open"
      aria-label="Annotate"
      title="Annotate"
      @click="props.openNotes('annotations')"
    >
      <Icon name="pencil" :size="20" />
    </button>
    <button
      type="button"
      class="notes-strip-button"
      data-action="question-open"
      aria-label="Ask a question"
      title="Ask a question"
      @click="props.openNotes('question')"
    >
      <Icon name="question" :size="20" />
    </button>
    <button
      type="button"
      class="notes-strip-button"
      data-action="notebook-open"
      aria-label="Notebook"
      title="Notebook"
      @click="props.openNotes()"
    >
      <Icon name="notebook" :size="20" />
    </button>
  </div>
</template>

<style scoped>
.notes-bottom-actions {
  display: flex;
  flex: 1;
  min-width: 0;
}

/* A thumb target as tall as the strip, which the design system's own sm button is too short to be. */
.notes-strip-button {
  flex: 1;
  min-width: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.notes-strip-button:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
