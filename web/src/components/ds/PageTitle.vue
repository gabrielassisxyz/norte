<script setup lang="ts">
import { computed, useSlots } from 'vue'

import type { PageTitleProps } from './types'

const props = defineProps<PageTitleProps>()
const slots = useSlots()
const hasMeta = computed(() => props.meta !== undefined || Boolean(slots.meta))
const hasActions = computed(() => props.actions !== undefined || Boolean(slots.actions))
</script>

<template>
  <header :class="['nt-pagetitle', className]">
    <h1 class="nt-pagetitle-title"><slot name="title">{{ title }}</slot></h1>
    <p v-if="objective !== undefined || $slots.objective" class="nt-pagetitle-objective">
      <slot name="objective">{{ objective }}</slot>
    </p>
    <div v-if="hasMeta || hasActions" class="nt-pagetitle-bar">
      <div v-if="hasMeta" class="nt-pagetitle-meta">
        <slot name="meta">{{ meta }}</slot>
      </div>
      <span v-else />
      <div v-if="hasActions" class="nt-pagetitle-actions">
        <slot name="actions">{{ actions }}</slot>
      </div>
    </div>
  </header>
</template>

<style scoped>
.nt-pagetitle {
  max-width: 960px;
}

.nt-pagetitle-title {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 64px;
  font-weight: 750;
  letter-spacing: -0.035em;
  line-height: 64px;
  text-wrap: balance;
}

.nt-pagetitle-objective {
  max-width: 60ch;
  margin: var(--space-4) 0 0;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 30px;
  text-wrap: pretty;
}

.nt-pagetitle-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-top: var(--space-6);
}

.nt-pagetitle-meta,
.nt-pagetitle-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

@media (max-width: 640px) {
  .nt-pagetitle-title {
    font-size: 40px;
    letter-spacing: -0.03em;
    line-height: 44px;
  }
}
</style>
