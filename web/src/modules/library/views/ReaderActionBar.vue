<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import type { LibraryStatus } from '../data/source'

/**
 * The reader's actions on a phone, in a bar across the bottom of the screen.
 *
 * The library's own actions — read, and which shelf the item is on — are
 * rendered here; whatever another module adds to the reader's `bottom-actions`
 * slot arrives through the default slot and sits beside them, so the bar names
 * no module.
 */
defineProps<{
  status: LibraryStatus
  unread: boolean
  statuses: ReadonlyArray<{ status: LibraryStatus; label: string }>
  busy: boolean
}>()

defineEmits<{
  'toggle-read': []
  move: [LibraryStatus]
}>()

/**
 * The bar's own height, published so the notes sheet can sit on top of it.
 *
 * It is measured rather than written down because nothing here knows it: the
 * bar is two rows, one of them filled by whatever another module puts in the
 * slot, and the bottom padding grows by the device's safe-area inset. The
 * number that was written down was 62px against a bar that measures 103, which
 * is how the sheet came to cover the status buttons it was placed to clear.
 *
 * The property goes on the document root because the sheet is a sibling under
 * a different fixed container, so there is no shared box to scope it to. The
 * bar is a singleton -- one reader, one bar -- and it takes the property back
 * on the way out so a screen without a bar cannot read a stale height.
 */
const LIBRARY_READER_BAR_HEIGHT = '--norte-library-reader-bar-height'
const bar = ref<HTMLElement>()
let observer: ResizeObserver | null = null

function publishHeight(): void {
  const height = bar.value?.getBoundingClientRect().height
  if (height === undefined) return
  document.documentElement.style.setProperty(LIBRARY_READER_BAR_HEIGHT, `${Math.round(height)}px`)
}

onMounted(() => {
  publishHeight()
  if (typeof ResizeObserver === 'undefined' || !bar.value) return
  observer = new ResizeObserver(publishHeight)
  observer.observe(bar.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  document.documentElement.style.removeProperty(LIBRARY_READER_BAR_HEIGHT)
})
</script>

<template>
  <nav ref="bar" class="reader-bar" aria-label="Ações da leitura">
    <div class="reader-bar-row">
      <button
        v-for="action in statuses"
        :key="action.status"
        type="button"
        class="reader-bar-chip"
        :class="{ 'is-current': status === action.status }"
        :data-action="`status-${action.status}`"
        :aria-pressed="status === action.status"
        :disabled="busy"
        @click="$emit('move', action.status)"
      >
        {{ action.label }}
      </button>
      <button
        type="button"
        class="reader-bar-chip reader-bar-read"
        data-action="read"
        :class="{ 'is-current': !unread }"
        :aria-pressed="!unread"
        :disabled="busy"
        @click="$emit('toggle-read')"
      >
        {{ unread ? 'Lido' : 'Não lido' }}
      </button>
    </div>
    <div class="reader-bar-row reader-bar-module">
      <slot />
    </div>
  </nav>
</template>

<style scoped>
.reader-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: grid;
  gap: 6px;
  padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.reader-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* The module's own actions stretch, because they are the ones a thumb aims at. */
.reader-bar-module :deep(> *) {
  flex: 1;
  min-width: 0;
}

.reader-bar-chip {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.reader-bar-chip.is-current {
  border-color: var(--norte);
  background: var(--norte-soft);
  color: var(--norte);
}

.reader-bar-chip:disabled {
  opacity: 0.6;
}

.reader-bar-chip:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
