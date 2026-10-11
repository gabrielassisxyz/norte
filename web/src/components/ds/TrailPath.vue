<script setup lang="ts">
import Icon from './Icon.vue'

export type TrailStatus = 'done' | 'current' | 'next' | 'locked'
export interface TrailStep {
  title: string
  meta?: string
  status?: TrailStatus
}

defineProps<{ steps: TrailStep[] }>()

const STATUS_TEXT: Record<TrailStatus, string> = {
  done: 'Done',
  current: 'Now',
  next: '',
  locked: 'Locked'
}
</script>

<template>
  <ol class="nt-trail">
    <li
      v-for="(step, index) in steps"
      :key="index"
      class="nt-trail-step"
      :class="`is-${step.status ?? 'next'}`"
      :aria-current="step.status === 'current' ? 'step' : undefined"
    >
      <span class="nt-trail-node" aria-hidden="true">
        <Icon v-if="step.status === 'done'" name="check" :size="12" />
        <Icon v-else-if="step.status === 'locked'" name="lock" :size="12" />
        <span v-else class="nt-trail-index">{{ index + 1 }}</span>
      </span>
      <div class="nt-trail-body">
        <div class="nt-trail-title">
          {{ step.title }}
          <span v-if="STATUS_TEXT[step.status ?? 'next']" class="nt-trail-status">
            {{ STATUS_TEXT[step.status ?? 'next'] }}
          </span>
        </div>
        <div v-if="step.meta" class="nt-trail-meta">{{ step.meta }}</div>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.nt-trail {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 65ch;
}
.nt-trail-step {
  position: relative;
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: var(--space-4);
  padding-bottom: var(--space-6);
}
/* The thread is drawn by the step above it, so only a finished step paints it accent. */
.nt-trail-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 11.5px;
  top: 28px;
  bottom: 4px;
  width: 1px;
  background: var(--line);
}
.nt-trail-step.is-done:not(:last-child)::before {
  background: var(--norte);
}
.nt-trail-node {
  width: 24px;
  height: 24px;
  box-sizing: border-box;
  border-radius: var(--radius-full);
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  color: var(--muted);
  background: var(--ground);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.is-done .nt-trail-node {
  background: var(--norte);
  border-color: var(--norte);
  color: var(--on-norte);
}
.is-current .nt-trail-node {
  border: 2px solid var(--norte);
  color: var(--norte);
  font-weight: 700;
}
.is-locked .nt-trail-node {
  border-style: dashed;
}
.nt-trail-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}
.is-locked .nt-trail-title {
  color: var(--muted);
}
.nt-trail-status {
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
  color: var(--muted);
}
.is-current .nt-trail-status {
  color: var(--norte);
}
.nt-trail-meta {
  margin-top: 2px;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
}
</style>
