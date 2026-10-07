<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import Icon from '@/components/ds/Icon.vue'
import { store } from '@/mock/store'
import type { LibraryItem, LibraryKind } from '@/mock/types'
import { crossModuleActionAllowed } from '@/modules/mounting'

type LibraryView = 'inbox' | 'depois' | 'arquivo' | 'tudo'

const VIEWS: LibraryView[] = ['inbox', 'depois', 'arquivo', 'tudo']
const VIEW_LABELS: Record<LibraryView, string> = {
  inbox: 'Inbox',
  depois: 'Depois',
  arquivo: 'Arquivo',
  tudo: 'Tudo'
}

const KIND_BY_TYPE: Record<string, LibraryKind> = {
  artigo: 'post',
  artigos: 'post',
  post: 'post',
  posts: 'post',
  livro: 'livro',
  livros: 'livro',
  pdf: 'paper',
  pdfs: 'paper',
  paper: 'paper',
  papers: 'paper',
  video: 'video',
  videos: 'video',
  'vídeo': 'video',
  'vídeos': 'video',
  podcast: 'podcast',
  podcasts: 'podcast',
  curso: 'curso',
  cursos: 'curso'
}

const TYPE_TITLES: Record<LibraryKind, string> = {
  post: 'Artigos',
  livro: 'Livros',
  paper: 'PDFs',
  video: 'Vídeos',
  podcast: 'Podcasts',
  curso: 'Cursos'
}

const KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Artigo',
  livro: 'Livro',
  paper: 'PDF',
  video: 'Vídeo',
  podcast: 'Podcast',
  curso: 'Curso'
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function formatSavedAt(savedAt: string): string {
  const [year, month, day] = savedAt.split('-').map(Number)
  if (!year || !month || !day) return savedAt
  return `${day} ${MONTHS[month - 1]}`
}

const route = useRoute()
const router = useRouter()

const sort = ref<'data' | 'titulo'>('data')
const unreadOnly = ref(false)

const activeView = computed<LibraryView>(() => {
  const raw = route.query.v
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && (VIEWS as string[]).includes(value) ? (value as LibraryView) : 'inbox'
})

/** The requested type filter: a library kind, 'newsletter' (no mock items yet), or null for every kind. */
const activeKind = computed<LibraryKind | 'newsletter' | null>(() => {
  const raw = route.query.tipo
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value === '') return null
  const key = value.toLowerCase()
  if (key === 'newsletter' || key === 'newsletters') return 'newsletter'
  return KIND_BY_TYPE[key] ?? null
})

const title = computed(() => {
  if (activeKind.value === 'newsletter') return 'Newsletters'
  if (activeKind.value !== null) return TYPE_TITLES[activeKind.value]
  return 'Biblioteca'
})

const typeItems = computed<LibraryItem[]>(() => {
  if (activeKind.value === 'newsletter') return []
  if (activeKind.value === null) return store.libraryItems
  return store.libraryItems.filter((item) => item.kind === activeKind.value)
})

const counts = computed<Record<LibraryView, number>>(() => ({
  inbox: typeItems.value.filter((item) => item.status === 'inbox').length,
  depois: typeItems.value.filter((item) => item.status === 'depois').length,
  arquivo: typeItems.value.filter((item) => item.status === 'arquivo').length,
  tudo: typeItems.value.length
}))

const segOptions = computed(() =>
  VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view], count: counts.value[view] }))
)

const visibleItems = computed<LibraryItem[]>(() => {
  const filtered = typeItems.value.filter(
    (item) =>
      (activeView.value === 'tudo' || item.status === activeView.value) && (!unreadOnly.value || item.unread)
  )
  if (sort.value === 'titulo') {
    return [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  }
  return [...filtered].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
})

const emptyText = computed(() => {
  if (unreadOnly.value && visibleItems.value.length === 0 && typeItems.value.length > 0) {
    return 'Tudo lido por aqui.'
  }
  if (activeView.value === 'inbox') return 'Inbox vazia. O que entrar pela extensão, upload ou feed aparece aqui.'
  if (activeView.value === 'depois') return 'Nada guardado para depois.'
  if (activeView.value === 'arquivo') return 'Nada arquivado ainda.'
  return 'Nenhum item deste tipo.'
})

const countText = computed(
  () => `${visibleItems.value.length} ${visibleItems.value.length === 1 ? 'item' : 'itens'}`
)

const sortLabel = computed(() => (sort.value === 'titulo' ? 'Título' : 'Data salva'))

function setView(view: string): void {
  if ((VIEWS as string[]).includes(view)) {
    void router.push({ query: { ...route.query, v: view } })
  }
}

function toggleSort(): void {
  sort.value = sort.value === 'titulo' ? 'data' : 'titulo'
}

function materialTarget(item: LibraryItem): { name: string; params: { kind: string; id: string } } {
  return { name: 'material', params: { kind: item.kind, id: item.id } }
}

function openItem(item: LibraryItem, event: MouseEvent): void {
  if ((event.target as HTMLElement).closest('button, a')) return
  void router.push(materialTarget(item))
}

function laterTitle(item: LibraryItem): string {
  return item.status === 'depois' ? 'Voltar para a inbox' : 'Depois'
}

function archiveTitle(item: LibraryItem): string {
  return item.status === 'arquivo' ? 'Desarquivar' : 'Arquivar'
}

function readTitle(item: LibraryItem): string {
  return item.status === 'read' ? 'Marcar como não lido' : 'Marcar como lido'
}

function toggleLater(item: LibraryItem): void {
  store.setLibraryItemStatus(item.id, item.status === 'depois' ? 'inbox' : 'depois')
}

function toggleArchive(item: LibraryItem): void {
  store.setLibraryItemStatus(item.id, item.status === 'arquivo' ? 'inbox' : 'arquivo')
}

function toggleRead(item: LibraryItem): void {
  const entry = store.libraryItems.find((candidate) => candidate.id === item.id)
  if (!entry) return
  if (entry.status === 'read') {
    store.setLibraryItemStatus(item.id, 'inbox')
    entry.unread = true
  } else {
    store.setLibraryItemStatus(item.id, 'read')
    entry.unread = false
  }
}

/**
 * An item can only be joined to a curriculum or turned into a task while the
 * module that owns the other end is mounted and reads from the same place. A
 * real id is a UUID and a mock id is a string like `saved-link-3`, so offering
 * the action across that line would write a reference neither side resolves.
 */
const canLinkCurriculum = computed(() => crossModuleActionAllowed('library', 'study'))
const canMakeTask = computed(() => crossModuleActionAllowed('library', 'projects'))

type CrossAction = 'curriculo' | 'tarefa'

const openAction = ref<{ itemId: string; action: CrossAction } | null>(null)

function toggleAction(item: LibraryItem, action: CrossAction): void {
  const current = openAction.value
  openAction.value = current && current.itemId === item.id && current.action === action ? null : { itemId: item.id, action }
}

function isActionOpen(item: LibraryItem, action: CrossAction): boolean {
  return openAction.value?.itemId === item.id && openAction.value?.action === action
}

function linkToCurriculum(item: LibraryItem, slug: string): void {
  store.setLibraryItemCurriculum(item.id, slug)
  openAction.value = null
}

function makeTask(item: LibraryItem, projectId: string): void {
  store.addTask({
    projectId,
    title: `Ler "${item.title}"`,
    description: item.url,
    priority: 'P2',
    bucket: 'next'
  })
  openAction.value = null
}

function curriculumTitle(item: LibraryItem): string | undefined {
  if (!item.curriculumSlug) return undefined
  return store.curricula.find((curriculum) => curriculum.slug === item.curriculumSlug)?.title
}
</script>

<template>
  <main class="library">
    <div class="library-head">
      <div class="library-title-row">
        <h1>{{ title }}</h1>
        <SegmentedControl :options="segOptions" :model-value="activeView" label="Estado" @change="setView" />
      </div>
      <div class="library-tools">
        <button type="button" class="ghost" @click="toggleSort">
          {{ sortLabel }}
          <Icon name="chevronDown" :size="14" />
        </button>
        <button
          type="button"
          class="ghost ghost-icon"
          :class="{ 'is-active': unreadOnly }"
          title="Só não lidos"
          aria-label="Só não lidos"
          :aria-pressed="unreadOnly"
          @click="unreadOnly = !unreadOnly"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="unreadOnly" class="library-unread">
      Mostrando só não lidos
      <button type="button" class="ghost ghost-clear" @click="unreadOnly = false">Limpar</button>
    </div>

    <div class="library-list">
      <article v-for="item in visibleItems" :key="item.id" class="item" @click="openItem(item, $event)">
        <div class="item-thumb" aria-hidden="true">
          <Icon name="note" :size="18" />
          <span v-if="item.unread" class="item-dot" role="img" aria-label="Não lido" />
        </div>
        <div class="item-main">
          <RouterLink class="item-title" :to="materialTarget(item)">{{ item.title }}</RouterLink>
          <div class="item-meta">
            <span>{{ item.author }}</span>
            <span aria-hidden="true">·</span>
            <span class="mono">{{ formatSavedAt(item.savedAt) }}</span>
            <span v-if="activeKind === null" class="item-kind">{{ KIND_LABELS[item.kind] }}</span>
            <span v-if="curriculumTitle(item)" class="tag-cur">{{ curriculumTitle(item) }}</span>
          </div>
        </div>
        <span class="mono item-date">{{ formatSavedAt(item.savedAt) }}</span>
        <div class="actions" role="group" aria-label="Ações">
          <button type="button" class="act" :title="laterTitle(item)" :aria-label="laterTitle(item)" @click="toggleLater(item)">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 5v3.2l2 1.3" />
            </svg>
          </button>
          <button
            type="button"
            class="act"
            :title="archiveTitle(item)"
            :aria-label="archiveTitle(item)"
            @click="toggleArchive(item)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="2.5" y="3" width="11" height="3" rx="1" />
              <path d="M3.5 6v6.5h9V6M6.5 9h3" />
            </svg>
          </button>
          <button type="button" class="act" :title="readTitle(item)" :aria-label="readTitle(item)" @click="toggleRead(item)">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 8.5l3 3 7-7" />
            </svg>
          </button>
          <div v-if="canLinkCurriculum" class="act-wrap">
            <button
              type="button"
              class="act"
              title="Vincular a currículo"
              aria-label="Vincular a currículo"
              :aria-expanded="isActionOpen(item, 'curriculo')"
              @click="toggleAction(item, 'curriculo')"
            >
              <Icon name="note" :size="16" />
            </button>
            <div v-if="isActionOpen(item, 'curriculo')" class="act-menu" role="menu" aria-label="Currículos">
              <button
                v-for="curriculum in store.curricula"
                :key="curriculum.slug"
                type="button"
                role="menuitem"
                class="act-menu-row"
                @click="linkToCurriculum(item, curriculum.slug)"
              >
                {{ curriculum.title }}
              </button>
            </div>
          </div>
          <div v-if="canMakeTask" class="act-wrap">
            <button
              type="button"
              class="act"
              title="Criar tarefa"
              aria-label="Criar tarefa"
              :aria-expanded="isActionOpen(item, 'tarefa')"
              @click="toggleAction(item, 'tarefa')"
            >
              <Icon name="check" :size="16" />
            </button>
            <div v-if="isActionOpen(item, 'tarefa')" class="act-menu" role="menu" aria-label="Projetos">
              <button
                v-for="project in store.projects"
                :key="project.id"
                type="button"
                role="menuitem"
                class="act-menu-row"
                @click="makeTask(item, project.id)"
              >
                {{ project.title }}
              </button>
            </div>
          </div>
        </div>
      </article>
      <div v-if="visibleItems.length === 0" class="library-empty">{{ emptyText }}</div>
    </div>
    <div class="mono library-count">{{ countText }}</div>
  </main>
</template>

<style scoped>
.act-wrap { position: relative; }
.act-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; display: grid; min-width: 220px; padding: 4px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow-pop); }
.act-menu-row { padding: 7px 10px; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--ink); font-family: var(--font-sans); font-size: 13px; text-align: left; cursor: pointer; }
.act-menu-row:hover { background: var(--norte-soft); color: var(--norte); }

.library {
  max-width: 1120px;
  margin: 0 auto;
}

.library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-top: 28px;
}

.library-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.library-title-row h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 36px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}

.library-tools {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
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

.ghost:hover {
  background: var(--sunken);
  color: var(--ink);
}

.ghost-icon {
  padding: 0 7px;
}

.ghost-icon.is-active {
  color: var(--norte);
}

.ghost-clear {
  height: 24px;
  padding: 0 6px;
}

.ghost:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.library-unread {
  margin-top: var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--muted);
}

.library-list {
  margin-top: 20px;
  border-top: 1px solid var(--line);
}

.item {
  position: relative;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 72px;
  gap: 20px;
  align-items: start;
  padding: 16px 12px;
  border-bottom: 1px solid var(--line);
  color: inherit;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.item:hover {
  background: var(--surface);
}

.item:hover .item-title {
  color: var(--norte);
}

.item:hover .actions,
.item:focus-within .actions {
  opacity: 1;
  pointer-events: auto;
}

.item-thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-sm);
  background: var(--sunken);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--muted);
}

.item-dot {
  position: absolute;
  left: -10px;
  top: 28px;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--norte);
}

.item-main {
  min-width: 0;
}

.item-title {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  text-decoration: none;
  border-radius: var(--radius-xs);
  transition: color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.item-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.item-meta > span {
  white-space: nowrap;
}

.item-kind {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
}

.tag-cur {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--norte-soft);
  color: var(--norte);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.item-date {
  justify-self: end;
  font-size: 12px;
  line-height: 20px;
  color: var(--muted);
}

.actions {
  position: absolute;
  right: 12px;
  top: 14px;
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.act {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.act:hover {
  background: var(--sunken);
  color: var(--ink);
}

.item-title:focus-visible,
.act:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.library-empty {
  padding: 48px 12px;
  font-size: 15px;
  line-height: 24px;
  color: var(--muted);
  max-width: 48ch;
}

.library-count {
  padding: 12px;
  text-align: right;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}

@media (max-width: 900px) {
  .item {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .item-date {
    display: none;
  }

  .item-thumb {
    width: 48px;
    height: 48px;
  }
}
</style>
