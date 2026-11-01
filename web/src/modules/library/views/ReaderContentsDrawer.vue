<script setup lang="ts">
import { computed } from 'vue'

import type { LibraryHeading } from '../data/source'

import ReaderDrawer from './ReaderDrawer.vue'

/**
 * The article's headings, in document order, on the left edge.
 *
 * Each level below the shallowest one present steps in by 16 px, so an article
 * that starts at an h2 is not indented for a level it never uses. A heading the
 * sanitizer dropped from the text is listed but cannot be chosen: hiding it
 * would make the list disagree with the article's own outline.
 */
const props = defineProps<{ headings: LibraryHeading[]; current: string | undefined; missing: string[] }>()

const emit = defineEmits<{ select: [anchor: string]; close: [] }>()

const shallowest = computed(() => Math.min(...props.headings.map((heading) => heading.level)))

function isMissing(anchor: string): boolean {
  return props.missing.includes(anchor)
}

function choose(anchor: string): void {
  if (isMissing(anchor)) return
  emit('select', anchor)
}
</script>

<template>
  <ReaderDrawer kind="contents" side="left" labelledby="reader-contents-title" @close="$emit('close')">
    <h2 id="reader-contents-title" class="reader-contents-title">Contents</h2>
    <ul class="reader-contents-list">
      <li v-for="heading in headings" :key="heading.anchor">
        <button
          type="button"
          class="reader-contents-row"
          :data-anchor="heading.anchor"
          :data-level="heading.level"
          :style="{ paddingLeft: `${12 + (heading.level - shallowest) * 16}px` }"
          :aria-current="heading.anchor === current ? 'true' : undefined"
          :aria-disabled="isMissing(heading.anchor) ? 'true' : undefined"
          @click="choose(heading.anchor)"
        >
          {{ heading.text }}
        </button>
      </li>
    </ul>
  </ReaderDrawer>
</template>

<style scoped>
.reader-contents-title {
  margin: 0 0 8px;
  padding: 0 12px;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 650;
  line-height: 28px;
  color: var(--ink);
}

.reader-contents-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }

.reader-contents-row {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}

.reader-contents-row[aria-current='true'] { color: var(--norte); font-weight: 600; }
.reader-contents-row[aria-disabled='true'] { color: var(--muted); cursor: default; }

.reader-contents-row:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
