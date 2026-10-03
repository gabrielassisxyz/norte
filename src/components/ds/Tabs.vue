<script setup lang="ts">
import { computed, ref } from 'vue'

import type { TabsProps } from './types'

const props = defineProps<TabsProps>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'change', value: string): void
}>()

const internalValue = ref(props.defaultValue ?? props.items[0]?.value ?? '')
const selectedValue = computed(() => props.modelValue ?? props.value ?? internalValue.value)

function select(value: string): void {
  internalValue.value = value
  emit('update:modelValue', value)
  emit('change', value)
  props.onChange?.(value)
}
</script>

<template>
  <div class="nt-tabs" role="tablist" :aria-label="label">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      role="tab"
      :aria-selected="item.value === selectedValue"
      :class="['nt-tab', { 'is-active': item.value === selectedValue }]"
      @click="select(item.value)"
    >
      <span>{{ item.label }}</span>
      <span v-if="item.count !== undefined" class="nt-tab-count">{{ item.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.nt-tabs {
  display: flex;
  gap: var(--space-1);
}

.nt-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}

.nt-tab:hover {
  color: var(--ink);
}

.nt-tab.is-active {
  border-bottom-color: var(--norte);
  color: var(--ink);
}

.nt-tab-count {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.nt-tab:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
