<script setup lang="ts">
import { computed, ref } from 'vue'

import Icon from './Icon.vue'

export type ModuleStatus = 'done' | 'current' | 'next'

const props = withDefaults(
  defineProps<{
    label: string
    title: string
    meta?: string
    status?: ModuleStatus
    statusText?: string
    open?: boolean
    defaultOpen?: boolean
  }>(),
  // Vue casts an absent boolean prop to false, which would make every item look controlled.
  { status: 'next', defaultOpen: false, open: undefined }
)

const emit = defineEmits<{ toggle: [open: boolean] }>()

const internalOpen = ref(props.defaultOpen)
// `open` turns the accordion into a controlled component; without it the item owns its state.
const isOpen = computed(() => props.open ?? internalOpen.value)

function toggle(): void {
  const next = !isOpen.value
  internalOpen.value = next
  emit('toggle', next)
}
</script>

<template>
  <section class="nt-mod" :class="`is-${status}`">
    <button type="button" class="nt-mod-head" :aria-expanded="isOpen" @click="toggle">
      <span class="nt-mod-num">{{ label }}</span>
      <span class="nt-mod-text">
        <span class="nt-mod-title">{{ title }}</span>
        <span v-if="meta" class="nt-mod-meta">{{ meta }}</span>
      </span>
      <span class="nt-mod-status">{{ statusText ?? (status === 'done' ? 'Concluído' : '') }}</span>
      <Icon name="chevronDown" :size="20" class="nt-mod-chev" :class="{ 'is-open': isOpen }" />
    </button>
    <div v-if="isOpen" class="nt-mod-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.nt-mod {
  border-top: 1px solid var(--line);
}
.nt-mod:last-child {
  border-bottom: 1px solid var(--line);
}
.nt-mod-head {
  width: 100%;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto 20px;
  gap: var(--space-4);
  align-items: center;
  padding: 22px 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.nt-mod-head:hover .nt-mod-title {
  color: var(--norte);
}
.nt-mod-head:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-mod-num {
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.nt-mod-text {
  min-width: 0;
}
.nt-mod-title {
  display: block;
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 28px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--ink);
  text-wrap: balance;
}
.nt-mod-meta {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}
.nt-mod-status {
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 20px;
  font-weight: 550;
  white-space: nowrap;
  color: var(--norte);
}
.nt-mod.is-done .nt-mod-status {
  color: var(--success);
}
.nt-mod-chev {
  color: var(--muted);
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-mod-chev.is-open {
  transform: rotate(180deg);
}
.nt-mod-body {
  padding: 0 0 40px 80px;
}
@media (max-width: 720px) {
  .nt-mod-head {
    grid-template-columns: 40px minmax(0, 1fr) 20px;
  }
  .nt-mod-status {
    display: none;
  }
  .nt-mod-body {
    padding-left: 0;
  }
}
</style>
