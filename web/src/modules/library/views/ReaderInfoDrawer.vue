<script setup lang="ts">
import { computed } from 'vue'

import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { formatShortDate } from '@/lib/clock'

import type { LibraryItemRecord } from '../data/source'

import ReaderDrawer from './ReaderDrawer.vue'

/**
 * What the reader knows about the item, and the notebook it left behind, on the
 * right edge.
 *
 * The default slot is the notebook. It is hidden with `v-show` and never
 * unmounted, so the panel inside it keeps marking the highlighted passages in
 * the article and keeps the drafts being typed while the drawer is shut or on
 * the Info tab. A row with no value is not rendered, so an item with no author
 * has no empty "Author" line to explain.
 */
const props = defineProps<{
  open: boolean
  tab: 'info' | 'notebook'
  item: LibraryItemRecord
  notebookCount: number
}>()

const emit = defineEmits<{ close: []; 'update:tab': [tab: 'info' | 'notebook'] }>()

const tabs = computed(() => [
  { value: 'info', label: 'Info' },
  { value: 'notebook', label: 'Notebook', ...(props.notebookCount > 0 ? { count: props.notebookCount } : {}) }
])

function year(timestamp: string): string {
  return timestamp.slice(0, 4)
}

function dated(timestamp: string): string {
  return `${formatShortDate(timestamp)} ${year(timestamp)}`
}

function withoutScheme(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
}

function selectTab(value: string): void {
  if (value === 'info' || value === 'notebook') emit('update:tab', value)
}
</script>

<template>
  <ReaderDrawer
    kind="info"
    side="right"
    labelledby="reader-info-title"
    :open="open"
    data-reader-sheet
    @close="$emit('close')"
  >
    <header class="reader-info-head">
      <SegmentedControl :model-value="tab" :options="tabs" label="About this item" @update:model-value="selectTab" />
      <button
        type="button"
        class="reader-info-close"
        data-action="close-notes"
        aria-label="Close"
        @click="$emit('close')"
      >
        Close
      </button>
    </header>

    <div v-show="tab === 'info'" class="reader-info" data-reader-info>
      <h2 id="reader-info-title" class="reader-info-title">{{ item.title }}</h2>
      <dl class="reader-info-rows">
        <div v-if="item.author" class="reader-info-row" data-info-row="author">
          <dt>Author</dt>
          <dd>{{ item.author }}</dd>
        </div>
        <div v-if="item.site" class="reader-info-row" data-info-row="site">
          <dt>Site</dt>
          <dd>{{ item.site }}</dd>
        </div>
        <div v-if="item.url" class="reader-info-row" data-info-row="url">
          <dt>URL</dt>
          <dd>
            <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ withoutScheme(item.canonical_url ?? item.url) }}</a>
          </dd>
        </div>
        <div v-if="item.published_at" class="reader-info-row" data-info-row="published">
          <dt>Published</dt>
          <dd>{{ dated(item.published_at) }}</dd>
        </div>
        <div v-if="item.minutes" class="reader-info-row" data-info-row="length">
          <dt>Length</dt>
          <dd>{{ item.minutes }} min</dd>
        </div>
        <div class="reader-info-row" data-info-row="saved">
          <dt>Saved</dt>
          <dd>{{ dated(item.saved_at) }} · {{ item.source }}</dd>
        </div>
        <div v-if="item.tags && item.tags.length > 0" class="reader-info-row" data-info-row="tags">
          <dt>Tags</dt>
          <dd>
            <ul class="reader-info-tags">
              <li v-for="tag in item.tags" :key="tag">{{ tag }}</li>
            </ul>
          </dd>
        </div>
      </dl>
    </div>

    <div v-show="tab === 'notebook'" class="reader-info-notebook">
      <slot />
    </div>
  </ReaderDrawer>
</template>

<style scoped>
.reader-info-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 4px 12px;
}

.reader-info-close {
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.reader-info-close:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.reader-info-title {
  margin: 0 0 12px;
  padding: 0 4px;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 650;
  line-height: 26px;
  color: var(--ink);
}

.reader-info-rows { display: grid; margin: 0; padding: 0 4px; }

.reader-info-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: var(--space-3);
  padding: 10px 0;
  border-top: 1px solid var(--line);
  font-size: 14px;
  line-height: 20px;
}

.reader-info-row dt { color: var(--muted); }
.reader-info-row dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.reader-info-row a { color: var(--norte); }

.reader-info-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }

.reader-info-tags li {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-full);
  background: var(--sunken);
  color: var(--ink-2);
  font-size: 12px;
  line-height: 18px;
}

.reader-info-notebook { min-height: 0; padding: 0 4px; }
</style>
