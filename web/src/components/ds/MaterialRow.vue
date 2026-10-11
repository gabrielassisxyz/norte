<script setup lang="ts">
import Icon from './Icon.vue'

export type MaterialStatus = 'done' | 'current' | 'next' | 'skipped'

withDefaults(
  defineProps<{
    n: number
    title: string
    by?: string
    type: string
    optional?: boolean
    status?: MaterialStatus
    description?: string
    href?: string
    url?: string
  }>(),
  { status: 'next', optional: false, href: '#' }
)

const STATE_TEXT: Partial<Record<MaterialStatus, string>> = {
  current: 'Reading now',
  skipped: 'Skipped'
}
</script>

<template>
  <div class="nt-mat" :class="`is-${status}`">
    <span class="nt-mat-node" :title="status === 'done' ? 'Done' : undefined">
      <Icon v-if="status === 'done'" name="check" :size="12" />
      <template v-else>{{ n }}</template>
      <span v-if="status === 'done'" class="nt-vh">Done</span>
    </span>
    <div class="nt-mat-main">
      <div class="nt-mat-line">
        <a class="nt-mat-title" :href="href">{{ title }}</a>
        <span v-if="by" class="nt-mat-by">{{ by }}</span>
        <span v-if="STATE_TEXT[status]" class="nt-mat-state">{{ STATE_TEXT[status] }}</span>
      </div>
      <p v-if="description" class="nt-mat-desc">{{ description }}</p>
    </div>
    <span class="nt-mat-type">{{ optional ? `${type} · optional` : type }}</span>
    <a v-if="url" class="nt-mat-ext" :href="url" aria-label="Open the original material">
      <Icon name="external" />
    </a>
    <span v-else />
  </div>
</template>

<style scoped>
.nt-mat {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 120px 32px;
  gap: var(--space-4);
  align-items: start;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.nt-mat-main {
  min-width: 0;
}
.nt-mat-node {
  width: 24px;
  height: 24px;
  box-sizing: border-box;
  border-radius: var(--radius-full);
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.nt-mat.is-done .nt-mat-node {
  background: var(--norte);
  border-color: var(--norte);
  color: var(--on-norte);
}
.nt-mat.is-current .nt-mat-node {
  border: 2px solid var(--norte);
  color: var(--norte);
  font-weight: 700;
}
.nt-mat.is-skipped .nt-mat-node {
  border-style: dashed;
}
.nt-mat-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}
.nt-mat-title {
  font-family: var(--font-display);
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
  border-radius: var(--radius-xs);
}
.nt-mat-title:hover {
  color: var(--norte);
}
.nt-mat.is-skipped .nt-mat-title {
  color: var(--muted);
}
.nt-mat-by {
  font-size: 14px;
  line-height: 22px;
  color: var(--muted);
}
.nt-mat-state {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  color: var(--muted);
}
.nt-mat.is-current .nt-mat-state {
  color: var(--norte);
}
.nt-mat-desc {
  margin: 4px 0 0;
  max-width: 65ch;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
}
.nt-mat-type {
  font-size: 13px;
  line-height: 22px;
  color: var(--muted);
  text-align: right;
}
.nt-mat-ext {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted);
}
.nt-mat-ext:hover {
  background: var(--sunken);
  color: var(--ink);
}
.nt-mat-title:focus-visible,
.nt-mat-ext:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-vh {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 600px) {
  .nt-mat {
    grid-template-columns: 28px minmax(0, 1fr) 32px;
  }
  .nt-mat-type {
    display: none;
  }
}
</style>
