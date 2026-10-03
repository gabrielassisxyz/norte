<script setup lang="ts">
import type { IconName } from './types'

withDefaults(defineProps<{ name: IconName; size?: number; className?: string }>(), {
  size: 16,
  className: undefined
})

const paths: Record<IconName, string> = {
  check: 'M4 8.5l2.5 2.5L12 5.5',
  play: 'M5.5 3.5v9l7-4.5z',
  plus: 'M8 3.5v9M3.5 8h9',
  lock: 'M5 7V5.5a3 3 0 0 1 6 0V7M4 7h8v5.5H4z',
  arrow: 'M3.5 8h9M9 4.5L12.5 8 9 11.5',
  arrowLeft: 'M12.5 8h-9M7 4.5L3.5 8 7 11.5',
  chevronDown: 'M4.5 6.5L8 10l3.5-3.5',
  collapse: 'M4 4l4 4-4 4M9 4l4 4-4 4',
  expand: 'M12 4L8 8l4 4M7 4L3 8l4 4',
  external: 'M9.5 3.5h3v3M12.5 3.5L7 9M11 9.5v3H3.5V5h3',
  note: 'M4 2.5h5.5L12 5v8.5H4zM6 8h4M6 10.5h4',
  comment: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  image: 'M2.5 3.5h11v9h-11zM13.5 10.5l-3-3-6.5 5M6 7.25h.01'
}
</script>

<template>
  <svg
    :class="['nt-icon', className]"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>

<style scoped>
.nt-icon {
  display: block;
  flex: none;
}
</style>
