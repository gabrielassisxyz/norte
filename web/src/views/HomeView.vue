<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Carousel from '@/components/ds/Carousel.vue'
import CourseRow from '@/components/ds/CourseRow.vue'
import CoverCard from '@/components/ds/CoverCard.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import TextField from '@/components/ds/TextField.vue'
import { store } from '@/mock/store'
import type { LibraryItem, MaterialKind } from '@/mock/types'

const TODAY = '2026-10-03'
const MATERIAL_KINDS = new Set<MaterialKind>(['post', 'livro', 'paper'])
const KIND_LABELS: Record<MaterialKind, string> = {
  post: 'Post',
  livro: 'Livro',
  paper: 'Paper'
}

const route = useRoute()
const saveOpen = ref(false)
const saveUrl = ref('')
const saveWhy = ref('')
const saveError = ref('')

const dueCount = computed(() => store.reviewCards.filter((card) => card.dueAt <= TODAY).length)

const studies = computed(() =>
  store.curricula
    .filter((curriculum) => curriculum.status === 'active')
    .map((curriculum, index) => {
      const materialCount = curriculum.modules.flatMap((module) => module.materials).length
      const completed = curriculum.modules.flatMap((module) => module.exercises).filter((exercise) => exercise.completed).length
      const progress = Math.min(1, (completed + index + 1) / Math.max(1, materialCount + curriculum.modules.length))
      return {
        ...curriculum,
        topic: curriculum.modules[0]?.title ?? 'Primeiro módulo',
        lessons: `item ${Math.min(materialCount, index + 1)}/${Math.max(1, materialCount)}`,
        progress
      }
    })
)

function isMaterial(item: LibraryItem): item is LibraryItem & { kind: MaterialKind } {
  return MATERIAL_KINDS.has(item.kind as MaterialKind)
}

const readingItems = computed(() =>
  store.libraryItems
    .filter(isMaterial)
    .slice(0, 6)
    .map((item, index) => ({ ...item, minutes: `${8 + index * 6} min restantes` }))
)

const recentItems = computed(() => store.libraryItems.filter((item) => item.status === 'inbox').slice(0, 5))

function materialHref(item: LibraryItem & { kind: MaterialKind }): string {
  return `/material/${item.kind}/${item.id}`
}

function openSave(): void {
  saveError.value = ''
  saveOpen.value = true
}

function closeSave(): void {
  saveOpen.value = false
  saveError.value = ''
}

function linkTitle(url: URL): string {
  const path = url.pathname.split('/').filter(Boolean).pop()
  if (!path) return url.hostname
  return path.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').replace(/^./, (letter) => letter.toUpperCase())
}

function saveLink(): void {
  const value = saveUrl.value.trim()
  if (!value) {
    saveError.value = 'Informe uma URL para salvar.'
    return
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    saveError.value = 'Informe uma URL válida.'
    return
  }

  store.addSavedLink({
    kind: 'post',
    title: linkTitle(url),
    author: saveWhy.value.trim() || url.hostname,
    url: url.toString()
  })
  saveUrl.value = ''
  saveWhy.value = ''
  closeSave()
}

watch(
  () => route.query.save,
  (save) => {
    if (save === '1') openSave()
  },
  { immediate: true }
)
</script>

<template>
  <main class="home-view">
    <div class="home-inner">
      <div class="home-actions">
        <Button variant="secondary" icon="plus" @click="openSave">Salvar link</Button>
        <RouterLink :to="{ name: 'revisao' }" class="home-review">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5.5 3.5v9l7-4.5z" />
          </svg>
          Revisar {{ dueCount }} cartões
        </RouterLink>
      </div>

      <PageTitle
        class="home-title"
        title="Sábado, 3 de outubro"
        objective="Escolha uma coisa importante para estudar e reserve um espaço para continuar lendo."
      />

      <section aria-labelledby="continue-study" class="home-section home-study">
        <div class="home-section-head">
          <h2 id="continue-study">Continuar estudando</h2>
          <RouterLink :to="{ name: 'estudo' }" class="home-see-all">Todos os currículos</RouterLink>
        </div>
        <div class="home-list">
          <CourseRow
            v-for="study in studies"
            :key="study.slug"
            :title="study.title"
            :topic="study.topic"
            :source="study.goal"
            :progress="study.progress"
            :lessons="study.lessons"
            :href="`/curriculos/${study.slug}`"
          />
        </div>
      </section>

      <section aria-labelledby="continue-reading" class="home-section">
        <div class="home-section-head home-reading-head">
          <h2 id="continue-reading">Continuar lendo</h2>
          <span>Começados na última semana</span>
        </div>
        <Carousel label="Continuar lendo">
          <CoverCard
            v-for="item in readingItems"
            :key="item.id"
            :title="item.title"
            :description="item.author"
            :meta="`${KIND_LABELS[item.kind]} · ${item.minutes}`"
            :href="materialHref(item)"
          />
        </Carousel>
      </section>

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
              <span class="home-save-meta">{{ item.author }} · {{ item.kind }}</span>
            </span>
            <span class="home-save-date">{{ item.savedAt === TODAY ? 'hoje' : item.savedAt }}</span>
          </RouterLink>
        </div>
      </section>
    </div>
  </main>

  <div v-if="saveOpen" class="save-backdrop" @mousedown.self="closeSave">
    <form class="save-dialog" role="dialog" aria-labelledby="save-title" @submit.prevent="saveLink">
      <div>
        <h2 id="save-title">Salvar link</h2>
        <p>Vai para a inbox para você retomar quando fizer sentido.</p>
      </div>
      <TextField v-model="saveUrl" label="URL" placeholder="https://…" type="url" />
      <TextField v-model="saveWhy" label="Por que salvar (opcional)" placeholder="Uma linha para o eu de daqui a um mês" :multiline="true" :rows="2" />
      <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
      <div class="save-buttons">
        <Button variant="secondary" @click="closeSave">Cancelar</Button>
        <Button variant="primary" type="submit" :disabled="!saveUrl.trim()">Salvar na inbox</Button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.home-view { min-width: 0; }
.home-inner { max-width: 1120px; margin: 0 auto; }
.home-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
.home-review { display: inline-flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-4); border-radius: var(--radius-sm); background: var(--norte); color: var(--on-norte); font-family: var(--font-display); font-size: 14px; font-weight: 550; text-decoration: none; }
.home-title { padding-top: var(--space-16); }
.home-section { margin-top: 64px; }
.home-study { margin-top: 56px; }
.home-section-head { display: flex; align-items: baseline; gap: var(--space-4); margin-bottom: var(--space-2); }
.home-section-head h2 { margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 30px; font-weight: 650; letter-spacing: -0.015em; }
.home-see-all { font-family: var(--font-display); font-size: 14px; font-weight: 550; text-decoration: none; }
.home-see-all:hover { text-decoration: underline; }
.home-list, .home-saves { border-top: 1px solid var(--line); }
.home-reading-head { margin-bottom: var(--space-6); }
.home-reading-head span { color: var(--muted); font-size: 14px; line-height: 20px; }
.home-save { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: var(--space-6); padding: var(--space-3); border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.home-save:hover { background: var(--surface); }
.home-save-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sunken); color: var(--muted); }
.home-save-main { min-width: 0; display: grid; gap: 2px; }
.home-save-title { overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 16px; font-weight: 600; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.home-save:hover .home-save-title { color: var(--norte); }
.home-save-meta, .home-save-date { color: var(--muted); font-size: 13px; line-height: 20px; }
.home-save-date { font-family: var(--font-mono); font-size: 12px; }
.save-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: rgb(13 17 23 / 32%); }
.save-dialog { display: grid; width: min(520px, calc(100vw - 32px)); gap: 20px; padding: 28px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.save-dialog h2 { margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 30px; font-weight: 650; }
.save-dialog p { margin: 4px 0 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.save-error { color: var(--danger) !important; }
.save-buttons { display: flex; justify-content: flex-end; gap: var(--space-3); }
@media (max-width: 900px) { .home-actions { flex-wrap: wrap; } }
@media (max-width: 560px) { .home-save { grid-template-columns: 40px minmax(0, 1fr); gap: var(--space-3); } .home-save-icon { width: 40px; height: 40px; } .home-save-date { display: none; } .home-section-head { align-items: flex-start; flex-direction: column; gap: var(--space-1); } }
</style>
