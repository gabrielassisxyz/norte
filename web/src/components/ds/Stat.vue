<script setup lang="ts">
import type { StatProps } from './types'

defineProps<StatProps>()
</script>

<template>
  <div class="nt-stat">
    <div class="nt-stat-value">
      <slot name="value">{{ value }}</slot>
      <span v-if="unit" class="nt-stat-unit">{{ unit }}</span>
    </div>
    <div class="nt-stat-label">{{ label }}</div>
    <div v-if="delta" :class="['nt-stat-delta', { 'is-down': deltaTone === 'down' }]">
      {{ delta }}
    </div>
  </div>
</template>

<style scoped>
.nt-stat {
  display: grid;
  gap: var(--space-1);
  min-width: 120px;
}

.nt-stat-value {
  display: flex;
  align-items: baseline;
  height: 36px;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 32px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 36px;
}

.nt-stat-unit {
  margin-left: 6px;
  color: var(--muted);
  font-size: 14px;
  letter-spacing: 0;
}

.nt-stat-label {
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}

.nt-stat-delta {
  color: var(--success);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}

.nt-stat-delta.is-down {
  color: var(--danger);
}
</style>
