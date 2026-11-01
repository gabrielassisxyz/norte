<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import Icon from '@/components/ds/Icon.vue'

/**
 * The reader's actions on a phone: a thin translucent strip of icons along the
 * bottom edge.
 *
 * What the notes module adds to the reader's `bottom-actions` slot arrives
 * through the default slot and fills the strip from the left; the two the
 * library owns -- where the item is, and everything else -- close it on the
 * right, so the strip names no module.
 *
 * It leaves by moving down the screen through `bottom`, not through a
 * transform. A transformed ancestor turns every `position: fixed` descendant
 * into one positioned against itself, and the selection toolbar the notes
 * module renders into that slot is fixed against the window: under a transform
 * it would land inside the strip, and open on a hidden strip off the screen.
 * For the same reason the strip carries no backdrop blur.
 */
defineProps<{ hidden: boolean }>()

defineEmits<{
  'open-location': []
  'open-more': []
}>()

/**
 * The strip's own height, published so the notes sheet can sit on top of it.
 *
 * It is measured rather than written down because nothing here knows it: the
 * strip grows by the device's safe-area inset, and a number that was written
 * down once was 62px against a bar that measured 103, which is how the sheet
 * came to cover the buttons it was placed to clear. It is published whether
 * the strip is showing or has slid away, so the sheet and the selection
 * toolbar keep one floor to compute against and do not jump when it moves.
 *
 * The property goes on the document root because the sheet is a sibling under
 * a different fixed container, so there is no shared box to scope it to. The
 * strip is a singleton -- one reader, one strip -- and it takes the property back
 * on the way out so a screen without a strip cannot read a stale height.
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
  <nav
    ref="bar"
    class="reader-strip"
    aria-label="Reading actions"
    :data-hidden="hidden ? 'true' : 'false'"
  >
    <div class="reader-strip-module">
      <slot />
    </div>
    <button
      type="button"
      class="reader-strip-button"
      data-action="location-open"
      aria-label="Move this item"
      title="Move this item"
      @click="$emit('open-location')"
    >
      <Icon name="tray" :size="20" />
    </button>
    <button
      type="button"
      class="reader-strip-button"
      data-action="more-open"
      aria-label="More actions"
      title="More actions"
      @click="$emit('open-more')"
    >
      <Icon name="more" :size="20" />
    </button>
  </nav>
</template>

<style scoped>
.reader-strip {
  --reader-strip-height: calc(48px + env(safe-area-inset-bottom, 0px));
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  height: var(--reader-strip-height);
  padding: 0 8px env(safe-area-inset-bottom, 0px);
  border: 0;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  transition: bottom 200ms cubic-bezier(0.2, 0, 0, 1);
}

.reader-strip[data-hidden='true'] {
  bottom: calc(-1 * var(--reader-strip-height));
}

/* Three of the five columns, so the notes module's buttons and the two here share the strip evenly. */
.reader-strip-module {
  display: flex;
  flex: 3;
  min-width: 0;
}

.reader-strip-button {
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

.reader-strip-button:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
