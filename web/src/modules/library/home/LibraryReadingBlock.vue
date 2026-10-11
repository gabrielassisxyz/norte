<script setup lang="ts">
import { computed } from 'vue'

import Carousel from '@/components/ds/Carousel.vue'
import Icon from '@/components/ds/Icon.vue'

import { useLibraryItems } from '../data/composables'
import { minutesRemainingFor, progressPercentOf, readerHref, siteOf, sourceOf } from './items'

/**
 * What was opened most recently, which is what "continue reading" means. The
 * order is the server's: `last_opened_desc` lists only items that have been
 * opened at all, so an untouched inbox never fills this block.
 */
const { data: page, loading, error } = useLibraryItems({ view: 'all', sort: 'last_opened_desc', limit: 6 })

const firstLoad = computed(() => loading.value && page.value === null)

const readingItems = computed(() =>
  (page.value?.items ?? []).slice(0, 6).map((item) => ({
    id: item.id,
    title: item.title,
    href: readerHref(item),
    site: siteOf(item),
    author: sourceOf(item),
    minutesRemaining: minutesRemainingFor(item),
    progressPercent: progressPercentOf(item)
  }))
)
</script>

<template>
  <section aria-labelledby="continue-reading" class="home-section">
    <div class="home-section-head home-reading-head">
      <h2 id="continue-reading">Continue reading</h2>
      <span>Started in the last week</span>
    </div>
    <p v-if="firstLoad" class="home-reading-state" role="status">Loading the readings…</p>
    <p v-else-if="error" class="home-reading-state" role="alert">The readings could not be loaded: {{ error }}</p>
    <p v-else-if="readingItems.length === 0" class="home-reading-state">Nothing started yet.</p>
    <Carousel v-else label="Continue reading">
      <RouterLink v-for="item in readingItems" :key="item.id" :to="item.href" class="home-reading-card">
        <span class="home-reading-cover">
          <Icon name="image" :size="20" />
          <span>Article image</span>
          <span
            class="home-reading-progress"
            role="progressbar"
            :aria-label="`Reading progress for ${item.title}`"
            :aria-valuenow="item.progressPercent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span class="home-reading-progress-fill" :style="{ width: `${item.progressPercent}%` }" />
          </span>
        </span>
        <span class="home-reading-info">
          <span class="home-reading-domain home-mono">{{ item.site }}</span>
          <span class="home-reading-title">{{ item.title }}</span>
          <span v-if="item.author || item.minutesRemaining !== null" class="home-reading-meta"><template v-if="item.author">{{ item.author }}<template v-if="item.minutesRemaining !== null"> · </template></template><span v-if="item.minutesRemaining !== null" class="home-mono">{{ item.minutesRemaining }} min left</span></span>
        </span>
      </RouterLink>
    </Carousel>
  </section>
</template>

<style scoped>
.home-reading-head { margin-bottom: var(--space-6); }
.home-reading-state { margin: 0; color: var(--muted); font-size: 14px; line-height: 22px; }
.home-reading-head span { color: var(--muted); font-size: 14px; line-height: 20px; }
.home-reading-card { display: flex; flex-direction: column; gap: var(--space-3); color: var(--ink); text-decoration: none; border-radius: var(--radius-md); }
.home-reading-cover { position: relative; box-sizing: border-box; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--sunken); color: var(--muted); font-size: 12px; line-height: 16px; transition: border-color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-reading-card:hover .home-reading-cover { border-color: var(--line-strong); }
.home-reading-card:hover .home-reading-title { color: var(--norte); }
.home-reading-card:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.home-reading-progress { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; background: var(--line); }
.home-reading-progress-fill { display: block; height: 100%; background: var(--norte); }
.home-reading-info { display: grid; gap: 4px; }
.home-reading-domain { overflow: hidden; color: var(--muted); font-size: 12px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.home-reading-title { display: -webkit-box; overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: -0.005em; -webkit-box-orient: vertical; -webkit-line-clamp: 2; transition: color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-reading-meta { overflow: hidden; color: var(--muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
</style>
