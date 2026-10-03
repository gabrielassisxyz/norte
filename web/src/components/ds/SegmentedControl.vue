<script setup lang="ts">
import { computed, ref } from 'vue'

import type { SegmentedControlProps } from './types'

const props = defineProps<SegmentedControlProps>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'change', value: string): void
}>()

const internalValue = ref(props.defaultValue ?? props.options[0]?.value ?? '')
const selectedValue = computed(() => props.modelValue ?? props.value ?? internalValue.value)

function select(value: string): void {
  internalValue.value = value
  emit('update:modelValue', value)
  emit('change', value)
  props.onChange?.(value)
}
</script>

<template>
  <div class="nt-seg" role="tablist" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="option.value === selectedValue"
      :class="['nt-seg-btn', { 'is-active': option.value === selectedValue }]"
      @click="select(option.value)"
    >
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="nt-seg-count">{{ option.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.nt-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--sunken);
}

.nt-seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  transition: color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.nt-seg-btn:hover {
  color: var(--ink);
}

.nt-seg-btn.is-active {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--ink);
}

.nt-seg-count {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.nt-seg-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
