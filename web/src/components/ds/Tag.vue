<script setup lang="ts">
import type { TagProps } from './types'

withDefaults(defineProps<TagProps>(), { kind: 'tag' })
const emit = defineEmits<{ (event: 'click'): void }>()

function handleClick(): void {
  emit('click')
}
</script>

<template>
  <button
    v-if="onClick"
    type="button"
    :class="['nt-tag', `nt-tag-${kind}`, { 'is-active': active }, className]"
    :aria-pressed="active"
    @click="handleClick"
  >
    <span v-if="kind === 'tag'" class="nt-tag-hash" aria-hidden="true">#</span>
    <slot />
    <span v-if="count !== undefined" class="nt-tag-count">{{ count }}</span>
  </button>
  <span v-else :class="['nt-tag', `nt-tag-${kind}`, { 'is-active': active }, className]">
    <span v-if="kind === 'tag'" class="nt-tag-hash" aria-hidden="true">#</span>
    <slot />
    <span v-if="count !== undefined" class="nt-tag-count">{{ count }}</span>
  </span>
</template>

<style scoped>
.nt-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  letter-spacing: 0.01em;
  line-height: 16px;
}

button.nt-tag {
  cursor: pointer;
}

.nt-tag-topic {
  background: var(--sunken);
  color: var(--ink);
}

.nt-tag-tag {
  padding: 0 var(--space-1);
  color: var(--muted);
}

.nt-tag-tag:hover {
  color: var(--ink);
}

.nt-tag-hash {
  color: var(--muted);
}

.nt-tag.is-active {
  background: var(--norte-soft);
  color: var(--norte);
}

.nt-tag.is-active .nt-tag-hash,
.nt-tag.is-active .nt-tag-count {
  color: var(--norte);
}

.nt-tag-count {
  margin-left: var(--space-1);
  color: var(--muted);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.nt-tag:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
