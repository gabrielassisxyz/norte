<script setup lang="ts">
import { RouterLink } from 'vue-router'

import Icon from '@/components/ds/Icon.vue'

/**
 * The round buttons that float over the top of the article on a phone: back to
 * the Library on the left, and on the right whatever acts on the item.
 *
 * Mark read / unread is the library's own. The default slot sits in front of it
 * on the right, which is where a button another bead adds (the contents, the
 * item's facts) goes without this component's layout being edited.
 *
 * The cluster leaves through a transform, unlike the strip: nothing in it
 * renders a window-fixed layer, so there is no containing block to protect.
 */
defineProps<{ hidden: boolean; unread: boolean; busy: boolean }>()

defineEmits<{ 'toggle-read': [] }>()
</script>

<template>
  <div class="reader-cluster" :data-hidden="hidden ? 'true' : 'false'">
    <RouterLink
      class="reader-round"
      data-action="back"
      aria-label="Back to the Library"
      title="Back to the Library"
      :to="{ name: 'library', query: { v: 'all' } }"
    >
      <Icon name="arrowLeft" :size="18" />
    </RouterLink>
    <div class="reader-cluster-end">
      <slot />
      <button
        type="button"
        class="reader-round"
        data-action="read"
        :aria-label="unread ? 'Mark as read' : 'Mark as unread'"
        :title="unread ? 'Mark as read' : 'Mark as unread'"
        :aria-pressed="!unread"
        :disabled="busy"
        @click="$emit('toggle-read')"
      >
        <Icon name="check" :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.reader-cluster {
  position: fixed;
  top: calc(10px + env(safe-area-inset-top, 0px));
  left: 10px;
  right: 10px;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* The gap between the buttons is the article's, so a tap there must reach it. */
  pointer-events: none;
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
}

.reader-cluster[data-hidden='true'] {
  transform: translateY(calc(-100% - 10px - env(safe-area-inset-top, 0px)));
}

.reader-cluster-end { display: flex; align-items: center; gap: 8px; }

.reader-round {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  color: var(--ink-2);
  cursor: pointer;
  pointer-events: auto;
  backdrop-filter: blur(8px);
}

.reader-round[aria-pressed='true'] {
  background: var(--norte);
  color: var(--surface);
}

.reader-round:disabled { opacity: 0.6; }

.reader-round:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
