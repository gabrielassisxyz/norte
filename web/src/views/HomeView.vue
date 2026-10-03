<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Carousel from '@/components/ds/Carousel.vue'
import Icon from '@/components/ds/Icon.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import TextField from '@/components/ds/TextField.vue'
import { store } from '@/mock/store'
import type { LibraryItem, LibraryKind, MaterialKind } from '@/mock/types'

const TODAY = '2026-10-03'
const MATERIAL_KINDS = new Set<MaterialKind>(['post', 'livro', 'paper'])
const PORTUGUESE_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Artigo',
  livro: 'Livro',
  paper: 'PDF',
  video: 'Vídeo',
  podcast: 'Podcast',
  curso: 'Curso'
}

const route = useRoute()
const searchQuery = ref('')
const saveOpen = ref(false)
const saveUrl = ref('')
const saveWhy = ref('')
const saveError = ref('')

function calendarTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return timestamp
}

function formatRelativeDate(savedAt: string, now: string): string {
  const savedTimestamp = calendarTimestamp(savedAt)
  const nowTimestamp = calendarTimestamp(now)
  if (savedTimestamp === null || nowTimestamp === null) return savedAt

  const daysAgo = Math.floor((nowTimestamp - savedTimestamp) / DAY_IN_MILLISECONDS)
  if (daysAgo <= 0) return 'hoje'
  if (daysAgo === 1) return 'ontem'

  const day = savedAt.slice(8, 10).replace(/^0/, '')
  const month = Number(savedAt.slice(5, 7))
  return `${day} ${PORTUGUESE_MONTHS[month - 1] ?? savedAt.slice(5, 7)}`
}

const dueCount = computed(() => store.reviewCards.filter((card) => card.dueAt <= TODAY).length)

const studies = computed(() =>
  store.curricula
    .filter((curriculum) => curriculum.status === 'active')
    .map((curriculum, index) => {
      const materialCount = curriculum.modules.flatMap((module) => module.materials).length
      const completed = curriculum.modules.flatMap((module) => module.exercises).filter((exercise) => exercise.completed).length
      const progress = curriculum.progress ?? Math.min(1, (completed + index + 1) / Math.max(1, materialCount + curriculum.modules.length))
      const totalItems = curriculum.totalItems ?? Math.max(1, materialCount)
      const currentItem = Math.min(totalItems, curriculum.currentItem ?? Math.max(1, index + 1))
      return {
        ...curriculum,
        module: curriculum.currentModule ?? `Módulo ${Math.min(curriculum.modules.length, index + 1)}`,
        lesson: curriculum.currentLesson ?? curriculum.modules[0]?.title ?? 'Primeira lição',
        item: `item ${currentItem}/${totalItems}`,
        percent: Math.round(progress * 100),
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
    .map((item, index) => {
      const progress = Math.max(0, Math.min(1, item.readProgress ?? 0.18 + index * 0.12))
      return {
        ...item,
        domain: item.domain ?? domainFor(item),
        minutesRemaining: item.minutes ?? 8 + index * 6,
        progressPercent: Math.round(progress * 100)
      }
    })
)

const recentItems = computed(() => store.libraryItems.filter((item) => item.status === 'inbox').slice(0, 5))

function materialHref(item: LibraryItem & { kind: MaterialKind }): string {
  return `/material/${item.kind}/${item.id}`
}

function domainFor(item: LibraryItem): string {
  if (item.domain) return item.domain
  try {
    return new URL(item.url).hostname.replace(/^www\./, '')
  } catch {
    return 'fonte desconhecida'
  }
}

function minutesFor(item: LibraryItem): number {
  return item.minutes ?? 8
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
        <label class="home-search-label" for="home-search">Buscar</label>
        <input
          id="home-search"
          v-model="searchQuery"
          class="home-search"
          type="search"
          placeholder="Buscar artigos, notas, cursos…"
        />
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
          <RouterLink
            v-for="study in studies"
            :key="study.slug"
            :to="`/curriculos/${study.slug}`"
            class="home-study-row"
          >
            <span class="home-study-main">
              <span class="home-study-title">{{ study.title }}</span>
              <span class="home-study-sub">
                <span>{{ study.module }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ study.lesson }}</span>
                <span aria-hidden="true">·</span>
                <span class="home-mono">{{ study.item }}</span>
              </span>
            </span>
            <span
              class="home-study-progress"
              role="progressbar"
              :aria-label="`Progresso de ${study.title}`"
              :aria-valuenow="study.percent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="home-study-track"><span class="home-study-fill" :style="{ width: `${study.percent}%` }" /></span>
              <span class="home-mono home-study-percent">{{ study.percent }}%</span>
            </span>
            <span class="home-study-continue">Continuar</span>
          </RouterLink>
        </div>
      </section>

      <section aria-labelledby="continue-reading" class="home-section">
        <div class="home-section-head home-reading-head">
          <h2 id="continue-reading">Continuar lendo</h2>
          <span>Começados na última semana</span>
        </div>
        <Carousel label="Continuar lendo">
          <RouterLink
            v-for="item in readingItems"
            :key="item.id"
            :to="materialHref(item)"
            class="home-reading-card"
          >
            <span class="home-reading-cover">
              <Icon name="image" :size="20" />
              <span>Imagem do artigo</span>
              <span
                class="home-reading-progress"
                role="progressbar"
                :aria-label="`Progresso de leitura de ${item.title}`"
                :aria-valuenow="item.progressPercent"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span class="home-reading-progress-fill" :style="{ width: `${item.progressPercent}%` }" />
              </span>
            </span>
            <span class="home-reading-info">
              <span class="home-reading-domain home-mono">{{ item.domain }}</span>
              <span class="home-reading-title">{{ item.title }}</span>
              <span class="home-reading-meta">{{ item.author }} · <span class="home-mono">{{ item.minutesRemaining }} min restantes</span></span>
            </span>
          </RouterLink>
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
              <span class="home-save-meta">
                <span>{{ domainFor(item) }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ item.author }}</span>
                <span aria-hidden="true">·</span>
                <span class="home-mono home-save-minutes">{{ minutesFor(item) }} min</span>
                <span aria-hidden="true">·</span>
                <span>{{ KIND_LABELS[item.kind] }}</span>
              </span>
            </span>
            <span class="home-save-date">{{ formatRelativeDate(item.savedAt, TODAY) }}</span>
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
.home-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); }
.home-search-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.home-search { width: 300px; height: 36px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 14px; }
.home-search::placeholder { color: var(--muted); }
.home-search:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.home-review { display: inline-flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-4); border-radius: var(--radius-sm); background: var(--norte); color: var(--on-norte); font-family: var(--font-display); font-size: 14px; font-weight: 550; text-decoration: none; }
.home-title { padding-top: var(--space-16); }
.home-section { margin-top: 64px; }
.home-study { margin-top: 56px; }
.home-section-head { display: flex; align-items: baseline; gap: var(--space-4); margin-bottom: var(--space-2); }
.home-section-head h2 { margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 30px; font-weight: 650; letter-spacing: -0.015em; }
.home-see-all { font-family: var(--font-display); font-size: 14px; font-weight: 550; text-decoration: none; }
.home-see-all:hover { text-decoration: underline; }
.home-list, .home-saves { border-top: 1px solid var(--line); }
.home-study-row { display: grid; grid-template-columns: minmax(0, 1fr) 200px 120px; gap: var(--space-6); align-items: center; padding: 14px 12px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; transition: background-color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-study-row:hover { background: var(--surface); }
.home-study-row:hover .home-study-title { color: var(--norte); }
.home-study-row:focus-visible, .home-reading-card:focus-visible, .home-save:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.home-study-main { min-width: 0; display: grid; }
.home-study-title { overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: -0.005em; text-overflow: ellipsis; white-space: nowrap; transition: color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-study-sub { display: flex; gap: 10px; align-items: center; overflow: hidden; color: var(--muted); font-size: 14px; line-height: 22px; white-space: nowrap; }
.home-study-sub > span:first-child, .home-study-sub > span:nth-child(3) { overflow: hidden; text-overflow: ellipsis; }
.home-study-sub > span:not(:first-child) { flex: none; }
.home-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.home-study-progress { display: grid; gap: 6px; min-width: 0; }
.home-study-track { height: 6px; overflow: hidden; border-radius: var(--radius-full); background: var(--sunken); box-shadow: inset 0 0 0 1px var(--line); }
.home-study-fill { display: block; height: 100%; border-radius: inherit; background: var(--norte); }
.home-study-percent { color: var(--muted); font-size: 12px; line-height: 16px; }
.home-study-continue { justify-self: end; display: inline-flex; align-items: center; height: 30px; padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-display); font-size: 13px; font-weight: 550; }
.home-reading-head { margin-bottom: var(--space-6); }
.home-reading-head span { color: var(--muted); font-size: 14px; line-height: 20px; }
.home-reading-card { display: flex; flex-direction: column; gap: var(--space-3); color: var(--ink); text-decoration: none; border-radius: var(--radius-md); }
.home-reading-cover { position: relative; box-sizing: border-box; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--sunken); color: var(--muted); font-size: 12px; line-height: 16px; transition: border-color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-reading-card:hover .home-reading-cover { border-color: var(--line-strong); }
.home-reading-card:hover .home-reading-title { color: var(--norte); }
.home-reading-progress { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; background: var(--line); }
.home-reading-progress-fill { display: block; height: 100%; background: var(--norte); }
.home-reading-info { display: grid; gap: 4px; }
.home-reading-domain { overflow: hidden; color: var(--muted); font-size: 12px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.home-reading-title { display: -webkit-box; overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: -0.005em; -webkit-box-orient: vertical; -webkit-line-clamp: 2; transition: color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-reading-meta { overflow: hidden; color: var(--muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.home-save { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: var(--space-6); padding: var(--space-3); border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.home-save:hover { background: var(--surface); }
.home-save-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sunken); color: var(--muted); }
.home-save-main { min-width: 0; display: grid; gap: 2px; }
.home-save-title { overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 16px; font-weight: 600; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.home-save:hover .home-save-title { color: var(--norte); }
.home-save-meta { display: flex; align-items: center; gap: 10px; overflow: hidden; color: var(--muted); font-size: 13px; line-height: 20px; white-space: nowrap; }
.home-save-meta > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.home-save-meta > span:not(:first-child) { flex: none; }
.home-save-date { color: var(--muted); font-size: 12px; line-height: 16px; }
.home-save-date { font-family: var(--font-mono); font-size: 12px; }
.save-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: rgb(13 17 23 / 32%); }
.save-dialog { display: grid; width: min(520px, calc(100vw - 32px)); gap: 20px; padding: 28px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.save-dialog h2 { margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 30px; font-weight: 650; }
.save-dialog p { margin: 4px 0 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.save-error { color: var(--danger) !important; }
.save-buttons { display: flex; justify-content: flex-end; gap: var(--space-3); }
@media (max-width: 1180px) { .home-study-row { grid-template-columns: minmax(0, 1fr) 120px; } .home-study-progress { display: none; } }
@media (max-width: 900px) { .home-actions { flex-wrap: wrap; } .home-search { width: 100%; } }
@media (max-width: 560px) { .home-study-row { grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); } .home-save { grid-template-columns: 40px minmax(0, 1fr); gap: var(--space-3); } .home-save-icon { width: 40px; height: 40px; } .home-save-date { display: none; } .home-section-head { align-items: flex-start; flex-direction: column; gap: var(--space-1); } }
</style>
