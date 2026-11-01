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
  image: 'M2.5 3.5h11v9h-11zM13.5 10.5l-3-3-6.5 5M6 7.25h.01',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  info: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 7.5V11M8 5.25h.01',
  notebook: 'M5 2.5h7.5v11H5zM3 5h2M3 8h2M3 11h2M7.5 5.5h3',
  tray: 'M2.5 9.5l1.7-5.5h7.6l1.7 5.5v3h-11zM2.5 9.5h3.2a2.3 2.3 0 0 0 4.6 0h3.2',
  chevronUpDown: 'M5 6l3-3 3 3M5 10l3 3 3-3',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  question: 'M6 6.25a2 2 0 1 1 3.2 1.6C8.5 8.4 8 8.8 8 9.75M8 12.25h.01',
  close: 'M4 4l8 8M12 4l-8 8',
  skipForward: 'M4 3.5l6 4.5-6 4.5zM12.5 3.5v9',
  clock: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 5v3.25l2 1.25',
  archive: 'M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3',
  cube: 'M8 2l5 2.75v6.5L8 14l-5-2.75v-6.5zM3 4.75l5 2.75 5-2.75M8 7.5V14',
  pencil: 'M10.5 3l2.5 2.5L6 12.5l-3 .5.5-3zM9 4.5L11.5 7',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M7 7v3.5M9 7v3.5'
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
