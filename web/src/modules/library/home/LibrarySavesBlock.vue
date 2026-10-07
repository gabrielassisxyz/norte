<script setup lang="ts">
import { computed } from 'vue'

import { store } from '@/mock/store'

import { formatRelativeDay, todayIsoDate } from '@/lib/clock'

import { domainFor, isMaterial, LIBRARY_KIND_LABELS, materialHref, minutesFor } from './items'

const recentItems = computed(() => store.libraryItems.filter((item) => item.status === 'inbox').slice(0, 5))
</script>

<template>
  <section aria-labelledby="recent-saves" class="home-section">
    <div class="home-section-head">
      <h2 id="recent-saves">Salvos recentemente</h2>
      <RouterLink :to="{ name: 'biblioteca', query: { v: 'inbox' } }" class="home-see-all">Ver inbox</RouterLink>
    </div>
    <div class="home-saves">
      <RouterLink
        v-for="item in recentItems"
        :key="item.id"
        :to="isMaterial(item) ? materialHref(item) : { name: 'biblioteca', query: { v: 'inbox' } }"
        class="home-save"
      >
        <span class="home-save-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h5.5L12.5 5.5v8H4z" /><path d="M6 8h4M6 10.5h4" /></svg>
        </span>
        <span class="home-save-main">
          <span class="home-save-title">{{ item.title }}</span>
          <span class="home-save-meta">
            <span>{{ domainFor(item) }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ item.author }}</span>
            <span aria-hidden="true">·</span>
            <span class="home-mono home-save-minutes">{{ minutesFor(item) }} min</span>
            <span aria-hidden="true">·</span>
            <span>{{ LIBRARY_KIND_LABELS[item.kind] }}</span>
          </span>
        </span>
        <span class="home-save-date">{{ formatRelativeDay(item.savedAt, todayIsoDate()) }}</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.home-save { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: var(--space-6); padding: var(--space-3); border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.home-save:hover { background: var(--surface); }
.home-save:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.home-save-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sunken); color: var(--muted); }
.home-save-main { min-width: 0; display: grid; gap: 2px; }
.home-save-title { overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 16px; font-weight: 600; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.home-save:hover .home-save-title { color: var(--norte); }
.home-save-meta { display: flex; align-items: center; gap: 10px; overflow: hidden; color: var(--muted); font-size: 13px; line-height: 20px; white-space: nowrap; }
.home-save-meta > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.home-save-meta > span:not(:first-child) { flex: none; }
.home-save-date { color: var(--muted); font-family: var(--font-mono); font-size: 12px; line-height: 16px; }
@media (max-width: 560px) { .home-save { grid-template-columns: 40px minmax(0, 1fr); gap: var(--space-3); } .home-save-icon { width: 40px; height: 40px; } .home-save-date { display: none; } }
</style>
