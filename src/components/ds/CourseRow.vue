<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    topic?: string
    source?: string
    progress?: number
    lessons?: string
    lastStudied?: string
    href?: string
  }>(),
  { progress: 0, href: '#' }
)

const percent = computed(() => Math.max(0, Math.min(100, Math.round(props.progress * 100))))
</script>

<template>
  <a :href="href" class="nt-course">
    <div class="nt-course-main">
      <div class="nt-course-title">{{ title }}</div>
      <div class="nt-course-sub">
        <span v-if="topic">{{ topic }}</span>
        <span v-if="source">{{ source }}</span>
      </div>
    </div>
    <div class="nt-course-progress">
      <div class="nt-progress-track">
        <div class="nt-progress-fill" :style="{ width: `${percent}%` }" />
      </div>
    </div>
    <span class="nt-course-num">{{ lessons ?? `${percent}%` }}</span>
    <span class="nt-course-num nt-course-last">{{ lastStudied ?? '—' }}</span>
  </a>
</template>

<style scoped>
.nt-course {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px 56px 72px;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid var(--line);
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-course:hover {
  background: var(--surface);
}
.nt-course:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
/* Without this the nowrap title sets the row's min-content width and the columns overflow. */
.nt-course-main {
  min-width: 0;
}
.nt-course-title {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nt-course-sub {
  display: flex;
  gap: var(--space-3);
  font-size: 14px;
  line-height: 22px;
  color: var(--muted);
}
.nt-course-num {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
  text-align: right;
}
.nt-course-last {
  color: var(--muted);
}
.nt-progress-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--line);
}
.nt-progress-fill {
  height: 100%;
  background: var(--norte);
  border-radius: inherit;
}
@media (max-width: 560px) {
  .nt-course {
    grid-template-columns: minmax(0, 1fr) 56px;
  }
  .nt-course-progress,
  .nt-course-last {
    display: none;
  }
}
</style>
