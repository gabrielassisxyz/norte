<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * The frame the reader's side drawers share: a scrim, and a panel on one
 * vertical edge, 86 % of the screen wide.
 *
 * Not the design system's `SidePanel`, which is a docked 380 px aside with no
 * overlay; that does not fit a phone. The panel takes focus when it opens and
 * hands it back to whatever held it before, which is the button that opened
 * it, so a keyboard or switch user is not left at the top of the page.
 *
 * Escape is heard on the window rather than on the panel, because focus may be
 * anywhere when it is pressed.
 */
defineProps<{ kind: string; side: 'left' | 'right'; labelledby: string }>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement>()
let opener: HTMLElement | null = null

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  panel.value?.focus()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (opener?.isConnected) opener.focus()
})
</script>

<template>
  <div class="reader-drawer-scrim" :data-side="side" @click.self="$emit('close')">
    <section
      ref="panel"
      class="reader-drawer"
      role="dialog"
      tabindex="-1"
      :aria-labelledby="labelledby"
      :data-reader-drawer="kind"
      :data-side="side"
    >
      <slot />
    </section>
  </div>
</template>

<style scoped>
.reader-drawer-scrim {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  background: rgb(13 17 23 / 32%);
}

.reader-drawer-scrim[data-side='right'] { justify-content: flex-end; }

.reader-drawer {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 86%;
  height: 100%;
  padding: calc(14px + env(safe-area-inset-top, 0px)) 8px calc(12px + env(safe-area-inset-bottom, 0px));
  background: var(--surface);
  box-shadow: var(--shadow-pop);
  overflow-y: auto;
}

.reader-drawer:focus { outline: none; }
</style>
