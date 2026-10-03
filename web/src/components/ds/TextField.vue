<script setup lang="ts">
import { computed, ref, useId } from 'vue'

import type { TextFieldProps } from './types'

const props = withDefaults(defineProps<TextFieldProps>(), {
  hideLabel: false,
  multiline: false,
  rows: 4,
  mono: false,
  inline: false,
  type: 'text'
})
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const inputId = props.id ?? useId()
const internalValue = ref(props.defaultValue ?? '')
const currentValue = computed(() => props.modelValue ?? props.value ?? internalValue.value)
const inputStyle = computed(() => {
  if (props.width === undefined) return undefined
  return { width: typeof props.width === 'number' ? `${props.width}px` : props.width }
})

function handleInput(event: Event): void {
  const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  internalValue.value = value
  emit('update:modelValue', value)
  props.onChange?.(value)
}
</script>

<template>
  <div :class="['nt-field', { 'nt-field-inline': inline }, className]">
    <label :for="inputId" :class="['nt-field-label', { 'nt-vh': hideLabel }]">{{ label }}</label>
    <textarea
      v-if="multiline"
      :id="inputId"
      :value="currentValue"
      :rows="rows"
      :placeholder="placeholder"
      :class="['nt-input', 'nt-input-multi', { 'nt-input-mono': mono }]"
      :aria-describedby="hint ? `${inputId}-hint` : undefined"
      @input="handleInput"
    />
    <input
      v-else
      :id="inputId"
      :value="currentValue"
      :type="type"
      :placeholder="placeholder"
      :style="inputStyle"
      :class="['nt-input', { 'nt-input-mono': mono }]"
      :aria-describedby="hint ? `${inputId}-hint` : undefined"
      @input="handleInput"
    />
    <p v-if="hint" :id="`${inputId}-hint`" class="nt-field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.nt-field {
  display: grid;
  gap: var(--space-2);
}

.nt-field-inline {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.nt-field-label {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.nt-vh {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.nt-input {
  display: block;
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 22px;
}

.nt-input-multi {
  min-height: 96px;
  height: auto;
  padding: 10px 12px;
  resize: vertical;
}

.nt-input-mono {
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.nt-input::placeholder {
  color: var(--muted);
}

.nt-input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.nt-field-hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.nt-field-inline .nt-field-hint {
  white-space: nowrap;
}
</style>
