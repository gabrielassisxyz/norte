<script setup lang="ts">
import type { CurriculumInstrument } from '@/mock/types'

defineProps<{ instrument: CurriculumInstrument }>()
</script>

<template>
  <section class="instrument">
    <h4 class="instrument-name">{{ instrument.name }}</h4>
    <div class="instrument-table">
      <template v-for="row in instrument.rows" :key="row.key">
        <span class="instrument-key">{{ row.key }}</span>
        <span class="instrument-value">{{ row.value }}</span>
      </template>
    </div>
    <p v-if="instrument.note" class="instrument-note">{{ instrument.note }}</p>
  </section>
</template>

<style scoped>
.instrument {
  margin: 0;
}

.instrument-name {
  margin: var(--space-9) 0 var(--space-3);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 650;
  line-height: 20px;
}

.instrument-table {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  max-width: 720px;
}

.instrument-key,
.instrument-value {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
  line-height: 22px;
}

.instrument-key {
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 600;
}

.instrument-value {
  color: var(--ink-2);
}

.instrument-note {
  margin: var(--space-3) 0 0;
  max-width: 65ch;
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}

@media (max-width: 600px) {
  .instrument-table {
    grid-template-columns: minmax(0, 1fr);
  }

  .instrument-key {
    border-bottom: 0;
    padding-bottom: 0;
  }
}
</style>
