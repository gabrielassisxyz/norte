<script setup lang="ts">
/**
 * The frame the reader's two short sheets share: a scrim, and a panel on the
 * bottom edge that sits over the action strip.
 *
 * Over it rather than above it, unlike the notes sheet: these hold a handful
 * of rows that are each a decision, so nothing under them needs to stay
 * reachable, and a tap on the scrim is the way out.
 */
defineProps<{ kind: string; label: string }>()

defineEmits<{ close: [] }>()
</script>

<template>
  <div class="reader-action-scrim" @click.self="$emit('close')">
    <section class="reader-action-sheet" role="dialog" :aria-label="label" :data-reader-sheet="kind">
      <span class="reader-action-grip" aria-hidden="true" />
      <slot />
    </section>
  </div>
</template>

<style scoped>
.reader-action-scrim {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: flex-end;
  background: rgb(13 17 23 / 32%);
}

.reader-action-sheet {
  display: grid;
  width: 100%;
  gap: 2px;
  padding: 8px 8px calc(12px + env(safe-area-inset-bottom, 0px));
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.reader-action-grip {
  justify-self: center;
  width: 36px;
  height: 4px;
  margin-bottom: 6px;
  border-radius: var(--radius-full);
  background: var(--line-strong);
}
</style>
