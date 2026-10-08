<script setup lang="ts">
import { computed, ref } from 'vue'

import PageTitle from '@/components/ds/PageTitle.vue'
import { formatLongWeekdayDate, todayIsoDate } from '@/lib/clock'

import { homeBlocks } from './composition'
import { requestPaletteSearch } from './paletteRequest'
import './home.css'

const searchQuery = ref('')

/**
 * The box hands what was typed to the command palette rather than searching
 * on its own. There is one search in Norte -- every module plus the subjects,
 * merged and ranked by the server -- and a second one living on this screen
 * would be a second place for the ranking, the keyboard handling and the
 * routes to be wrong in.
 *
 * The first keystroke is the handover, and the text goes with it, so the
 * palette opens already answering rather than empty. It reads the value off
 * the event rather than off `searchQuery`, because both this listener and
 * `v-model`'s are `input` listeners and nothing promises which runs first.
 * The box is then emptied: the palette owns the query from here, and a copy
 * left behind would still be showing the last search the next time Início is
 * opened.
 */
function openPaletteWith(typed: string): void {
  requestPaletteSearch(typed)
  searchQuery.value = ''
}

/** The day the server is on, which is the only day this screen is about. */
const title = computed(() => formatLongWeekdayDate(todayIsoDate()))
const actionBlocks = computed(() => homeBlocks('actions'))
const mainBlocks = computed(() => homeBlocks('main'))
</script>

<template>
  <main class="home-view">
    <div class="home-inner">
      <div class="home-actions">
        <label class="home-search-label" for="home-search">Buscar</label>
        <input
          id="home-search"
          v-model="searchQuery"
          class="home-search"
          type="search"
          placeholder="Buscar artigos, notas, cursos…"
          @input="openPaletteWith(($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="openPaletteWith(searchQuery)"
        />
        <component :is="block.component" v-for="block in actionBlocks" :key="block.id" />
      </div>

      <PageTitle
        class="home-title"
        :title="title"
        objective="Escolha uma coisa importante para estudar e reserve um espaço para continuar lendo."
      />

      <component :is="block.component" v-for="block in mainBlocks" :key="block.id" />
    </div>
  </main>
</template>

<style scoped>
.home-view { min-width: 0; }
.home-inner { max-width: 1120px; margin: 0 auto; }
.home-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); }
.home-search-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.home-search { width: 300px; height: 36px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 14px; }
.home-search::placeholder { color: var(--muted); }
.home-search:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.home-title { padding-top: var(--space-16); }
@media (max-width: 900px) { .home-actions { flex-wrap: wrap; } .home-search { width: 100%; } }
</style>
