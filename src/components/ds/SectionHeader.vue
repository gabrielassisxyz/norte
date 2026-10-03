<script setup lang="ts">
import { computed } from 'vue'

import type { SectionHeaderProps } from './types'

const props = withDefaults(defineProps<SectionHeaderProps>(), { level: 2, actionHref: '#' })
const headingTag = computed(() => `h${props.level}`)
</script>

<template>
  <div class="nt-sechead">
    <div class="nt-sechead-main">
      <component :is="headingTag" :id="id" class="nt-sechead-title">
        <slot name="title">{{ title }}</slot>
      </component>
      <a v-if="actionLabel" class="nt-sechead-link" :href="actionHref">{{ actionLabel }}</a>
    </div>
    <div v-if="trailing !== undefined || $slots.trailing" class="nt-sechead-trailing">
      <slot name="trailing">{{ trailing }}</slot>
    </div>
  </div>
</template>

<style scoped>
.nt-sechead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.nt-sechead-main {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
}

.nt-sechead-title {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.nt-sechead-link {
  border-radius: var(--radius-xs);
  color: var(--link);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
  text-decoration: none;
  white-space: nowrap;
}

.nt-sechead-link:hover {
  text-decoration: underline;
}

.nt-sechead-link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
