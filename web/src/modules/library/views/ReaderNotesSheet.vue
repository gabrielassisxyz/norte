<script setup lang="ts">
/**
 * The panel a phone reader opens from the bottom: the chrome only, with
 * whatever fills the reader's `notes` slot inside it.
 *
 * It is hidden with `v-show` rather than `v-if` on purpose. What it holds marks
 * the highlighted passages in the article and holds the drafts being typed, and
 * both of those are lost by an unmount — closing the sheet would silently undo
 * the marking in the text behind it.
 */
defineProps<{ open: boolean }>()

defineEmits<{ close: [] }>()
</script>

<template>
  <section
    v-show="open"
    class="reader-sheet"
    role="dialog"
    aria-label="Notas desta leitura"
    data-reader-sheet
  >
    <header class="reader-sheet-top">
      <span class="reader-sheet-grip" aria-hidden="true" />
      <button
        type="button"
        class="reader-sheet-close"
        data-action="fechar-notas"
        aria-label="Fechar notas"
        @click="$emit('close')"
      >
        Fechar
      </button>
    </header>
    <div class="reader-sheet-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.reader-sheet {
  position: fixed;
  left: 0;
  right: 0;
  /* Clear of the action bar, which stays reachable while the sheet is open. */
  bottom: 62px;
  z-index: 45;
  display: flex;
  flex-direction: column;
  max-height: 72vh;
  border-top: 1px solid var(--line-strong);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.reader-sheet-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 8px 12px 4px;
}

.reader-sheet-grip {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--line-strong);
}

.reader-sheet-close {
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.reader-sheet-close:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.reader-sheet-body {
  min-height: 0;
  overflow-y: auto;
  padding: 0 16px 16px;
}
</style>
