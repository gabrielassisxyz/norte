<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/ds/Button.vue'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'

/**
 * The two ways into the reader's notes sheet on a phone: a note, and a
 * question.
 *
 * It renders nothing on a wide screen, where the panel these would open is
 * already on the page under the article — a button that reveals something
 * visible is worse than no button. The section names are this module's own; the
 * reader carries them to the panel without reading them.
 */
const props = defineProps<ReaderSlotProps>()

const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))
</script>

<template>
  <div v-if="allowed && phone" class="notes-bottom-actions">
    <Button data-action="annotate-open" variant="secondary" size="sm" @click="props.openNotes('annotations')">
      Annotate
    </Button>
    <Button data-action="question-open" variant="secondary" size="sm" @click="props.openNotes('question')">
      Question
    </Button>
  </div>
</template>

<style scoped>
.notes-bottom-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* A thumb target, which the design system's own sm button is too short to be. */
.notes-bottom-actions :deep(button) {
  flex: 1;
  min-width: 0;
  height: 40px;
  justify-content: center;
}
</style>
