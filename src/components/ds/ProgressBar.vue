<script setup lang="ts">
import { computed } from 'vue'

import type { ProgressBarProps } from './types'

const props = withDefaults(defineProps<ProgressBarProps>(), { max: 1 })

const percent = computed(() => {
  if (props.max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((props.value / props.max) * 100)))
})
</script>

<template>
  <div :class="['nt-progress', className]">
    <div v-if="label" class="nt-progress-head">
      <span class="nt-progress-label">{{ label }}</span>
      <span class="nt-progress-value">{{ valueText || `${percent}%` }}</span>
    </div>
    <div
      class="nt-progress-track"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label"
    >
      <div class="nt-progress-fill" :style="{ width: `${percent}%` }" />
    </div>
  </div>
</template>

<style scoped>
.nt-progress {
  display: grid;
  gap: var(--space-2);
  min-width: 160px;
}

.nt-progress-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.nt-progress-label {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
}

.nt-progress-value {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}

.nt-progress-track {
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--sunken);
  box-shadow: inset 0 0 0 1px var(--line);
}

.nt-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--norte);
}
</style>
