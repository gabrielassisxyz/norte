<script setup lang="ts">
withDefaults(defineProps<{ actions?: string[] }>(), {
  actions: () => ['Highlight', 'Annotate', 'Turn into a question', 'Create a card']
})

defineEmits<{ action: [action: string] }>()
</script>

<template>
  <div class="nt-seltool" role="toolbar" aria-label="Actions for the selected passage">
    <button
      v-for="(action, i) in actions"
      :key="action"
      type="button"
      class="nt-seltool-btn"
      @click="$emit('action', action)"
    >
      <span v-if="i === 0" class="nt-swatch" aria-hidden="true" />
      {{ action }}
    </button>
  </div>
</template>

<style scoped>
.nt-seltool {
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  white-space: nowrap;
}
.nt-seltool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}
.nt-seltool-btn:hover {
  background: var(--sunken);
}
.nt-seltool-btn:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-swatch {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-xs);
  background: var(--lime);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 15%, transparent);
}
</style>
