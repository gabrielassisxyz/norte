<script setup lang="ts">
import type { ModuleView } from './curriculum'

defineProps<{ modules: ModuleView[] }>()
defineEmits<{ open: [id: string] }>()
</script>

<template>
  <div class="ruler">
    <button
      v-for="module in modules"
      :key="module.id"
      type="button"
      class="ruler-step"
      :class="`is-${module.status}`"
      @click="$emit('open', module.id)"
    >
      <span class="ruler-num">{{ module.label }}</span>
      <span class="ruler-name">{{ module.short }}</span>
      <span class="ruler-duration">{{ module.duration }}</span>
    </button>
  </div>
</template>

<style scoped>
/* auto-fit keeps the rail one row of equal steps whatever the module count is. */
.ruler {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: var(--space-4);
}

.ruler-step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-3) 0 0;
  border: 0;
  border-top: 3px solid var(--line);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.ruler-step.is-done {
  border-top-color: var(--norte);
}

.ruler-step.is-current {
  border-top-color: var(--streak-2);
}

.ruler-step:hover .ruler-name {
  color: var(--norte);
}

.ruler-step:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.ruler-num {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}

.ruler-name {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
}

.ruler-duration {
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}
</style>
