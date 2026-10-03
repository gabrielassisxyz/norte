<script setup lang="ts">
import { computed, useAttrs } from 'vue'

import Icon from './Icon.vue'
import type { ButtonProps } from './types'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'secondary',
  size: 'md',
  disabled: false,
  type: 'button'
})

const attrs = useAttrs()
const buttonType = computed<ButtonProps['type']>(() => {
  return typeof attrs.type === 'string' && ['button', 'submit', 'reset'].includes(attrs.type)
    ? (attrs.type as ButtonProps['type'])
    : props.type
})
const forwardedAttrs = computed(() => {
  const { class: _class, type: _type, ...rest } = attrs
  return rest
})
</script>

<template>
  <button
    v-bind="forwardedAttrs"
    :type="buttonType"
    :disabled="disabled"
    :class="['nt-btn', `nt-btn-${variant}`, `nt-btn-${size}`, className, attrs.class]"
  >
    <Icon v-if="icon" :name="icon" />
    <slot />
  </button>
</template>

<style scoped>
.nt-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
  white-space: nowrap;
  transition:
    background-color 120ms cubic-bezier(0.2, 0, 0, 1),
    border-color 120ms cubic-bezier(0.2, 0, 0, 1),
    color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.nt-btn-md {
  height: 36px;
  padding: 0 var(--space-4);
}

.nt-btn-sm {
  height: 30px;
  padding: 0 var(--space-3);
  font-size: 13px;
}

.nt-btn-primary {
  background: var(--norte);
  color: var(--on-norte);
}

.nt-btn-primary:hover {
  background: var(--norte-hover);
}

.nt-btn-secondary {
  background: var(--surface);
  border-color: var(--line-strong);
  color: var(--ink);
}

.nt-btn-secondary:hover {
  background: var(--sunken);
}

.nt-btn-ghost {
  background: transparent;
  color: var(--ink-2);
}

.nt-btn-ghost:hover {
  background: var(--sunken);
  color: var(--ink);
}

.nt-btn:disabled {
  background: var(--sunken);
  border-color: var(--line);
  color: var(--muted);
  cursor: not-allowed;
}

.nt-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
