<script setup lang="ts">
import type { NavItemProps } from './types'

withDefaults(defineProps<NavItemProps>(), { href: '#' })
</script>

<template>
  <a :href="href" :class="['nt-nav', { 'is-active': active }]" :aria-current="active ? 'page' : undefined">
    <span class="nt-nav-label"><slot>{{ label }}</slot></span>
    <span v-if="count !== undefined" class="nt-nav-count">{{ count }}</span>
  </a>
</template>

<style scoped>
.nt-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 36px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
}

.nt-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nt-nav:hover {
  background: var(--surface);
  color: var(--ink);
}

.nt-nav.is-active {
  background: var(--norte-soft);
  color: var(--norte);
}

.nt-nav-count {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.nt-nav.is-active .nt-nav-count {
  color: var(--norte);
}

.nt-nav:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
