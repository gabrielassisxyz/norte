<script setup lang="ts">
import { computed, ref } from 'vue'

import PageTitle from '@/components/ds/PageTitle.vue'
import { formatLongWeekdayDate, todayIsoDate } from '@/lib/clock'

import { homeBlocks } from './composition'
import './home.css'

const searchQuery = ref('')
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
