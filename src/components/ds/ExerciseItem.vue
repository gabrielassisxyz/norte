<script setup lang="ts">
import { computed } from 'vue'

import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    n: number
    kind: string
    prompt: string
    done?: boolean
    answer?: string
    time?: string
  }>(),
  { done: false }
)

const number = computed(() => String(props.n).padStart(2, '0'))
</script>

<template>
  <div class="nt-ex" :class="{ 'is-done': done }">
    <span class="nt-ex-n">
      <Icon v-if="done" name="check" :size="14" />
      <template v-else>{{ number }}</template>
      <span v-if="done" class="nt-vh">Feito</span>
    </span>
    <div class="nt-ex-main">
      <div class="nt-ex-kind">{{ kind }}</div>
      <p class="nt-ex-prompt">{{ prompt }}</p>
      <p v-if="done && answer" class="nt-ex-answer">{{ answer }}</p>
      <div v-if="!done && $slots.default" class="nt-ex-work">
        <slot />
      </div>
      <div v-if="done" class="nt-ex-meta">
        <span class="nt-ex-ok">Feito</span>
        <span v-if="time" class="nt-mono">{{ time }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nt-ex {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: var(--space-4);
  padding: 28px 0;
  border-bottom: 1px solid var(--line);
  max-width: 680px;
}
.nt-ex-main {
  min-width: 0;
}
.nt-ex-n {
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 22px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.nt-ex.is-done .nt-ex-n {
  color: var(--success);
  padding-top: 4px;
}
.nt-ex-kind {
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  color: var(--norte);
}
.nt-ex-prompt {
  margin: 6px 0 0;
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}
.nt-ex-answer {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 24px;
  color: var(--ink-2);
}
.nt-ex-work {
  margin-top: 14px;
  display: grid;
  gap: 10px;
}
.nt-ex-meta {
  margin-top: var(--space-2);
  display: flex;
  gap: 10px;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}
.nt-ex-ok {
  color: var(--success);
}
.nt-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.nt-vh {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
