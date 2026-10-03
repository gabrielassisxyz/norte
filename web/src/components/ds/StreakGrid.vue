<script setup lang="ts">
import { computed } from 'vue'

import type { StreakGridProps } from './types'

const props = defineProps<StreakGridProps>()

const cells = computed(() =>
  props.days.map((level) => {
    const normalized = Number.isFinite(level) ? Math.trunc(level) : 0
    return Math.max(0, Math.min(4, normalized))
  })
)
</script>

<template>
  <figure class="nt-streak">
    <div class="nt-streak-grid" role="img" :aria-label="label || 'Histórico de estudo'">
      <span v-for="(level, index) in cells" :key="index" class="nt-streak-cell" :data-level="level" />
    </div>
    <figcaption class="nt-streak-legend">
      <span>{{ caption || '' }}</span>
      <span class="nt-streak-scale" aria-hidden="true">
        menos
        <span v-for="level in 5" :key="level" class="nt-streak-cell" :data-level="level - 1" />
        mais
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
.nt-streak {
  display: inline-grid;
  gap: var(--space-2);
  margin: 0;
}

.nt-streak-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 12px;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
}

.nt-streak-cell {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: var(--radius-xs);
  background: var(--streak-0);
}

.nt-streak-cell[data-level='1'] {
  background: var(--streak-1);
}

.nt-streak-cell[data-level='2'] {
  background: var(--streak-2);
}

.nt-streak-cell[data-level='3'] {
  background: var(--streak-3);
}

.nt-streak-cell[data-level='4'] {
  background: var(--streak-4);
}

.nt-streak-legend {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.nt-streak-scale {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.nt-streak-scale .nt-streak-cell {
  width: 10px;
  height: 10px;
}
</style>
