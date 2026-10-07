<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import Icon from '@/components/ds/Icon.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatShortDate } from '@/lib/clock'
import type { LibraryItem, LibraryKind } from '@/mock/types'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useProjectsSummary } from '@/modules/projects/data/composables'
import { useStudySummary } from '@/modules/study/data/composables'
import { useSources } from '@/sources'

import { useLibraryItems } from '../data/composables'
import type { LibraryListQuery } from '../data/source'

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

const route = useRoute()
const router = useRouter()
const { library, projects: projectsSource } = useSources()

const sort = ref<'data' | 'titulo'>('data')
const unreadOnly = ref(false)
const search = ref('')

const activeView = computed<LibraryView>(() => {
  const raw = route.query.v
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && (VIEWS as string[]).includes(value) ? (value as LibraryView) : 'inbox'
})

/** The requested type filter: a library kind, 'newsletter' (no items yet), or null for every kind. */
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

/**
 * What the list is asked for. The type filter, the search term and the order
 * are the source's business; which status tab is open and whether unread items
 * are the only ones shown are this page's, applied over the rows it already has
 * so that switching a tab does not re-ask.
 */
const query = computed<LibraryListQuery>(() => ({
  kind: activeKind.value,
  search: search.value.trim(),
  sort: sort.value
}))

const { data: page, loading, error, refresh, applyItem } = useLibraryItems(query)
const writing = useAsyncAction()

const items = computed<LibraryItem[]>(() => page.value?.items ?? [])

const counts = computed<Record<LibraryView, number>>(() => ({
  inbox: page.value?.counts.inbox ?? 0,
  depois: page.value?.counts.depois ?? 0,
  arquivo: page.value?.counts.arquivo ?? 0,
  tudo: page.value?.counts.tudo ?? 0
}))

const segOptions = computed(() =>
  VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view], count: counts.value[view] }))
)

const visibleItems = computed<LibraryItem[]>(() =>
  items.value.filter(
    (item) => (activeView.value === 'tudo' || item.status === activeView.value) && (!unreadOnly.value || item.unread)
  )
)

/** Nothing has arrived yet, as opposed to nothing matching what was asked. */
const firstLoad = computed(() => loading.value && page.value === null)

const emptyText = computed(() => {
  if (search.value.trim() && items.value.length === 0) return `Nada encontrado para “${search.value.trim()}”.`
  if (unreadOnly.value && visibleItems.value.length === 0 && items.value.length > 0) {
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
  return item.unread ? 'Marcar como lido' : 'Marcar como não lido'
}

/**
 * Every action here waits for the source and then shows what came back. A
 * failure leaves the row exactly as it was and says so above the list, because
 * a row that moves and then moves back is worse than a row that never moved.
 */
async function toggleLater(item: LibraryItem): Promise<void> {
  const updated = await writing.run(() => library.setStatus(item.id, item.status === 'depois' ? 'inbox' : 'depois'))
  if (updated) applyItem(updated)
}

async function toggleArchive(item: LibraryItem): Promise<void> {
  const updated = await writing.run(() => library.setStatus(item.id, item.status === 'arquivo' ? 'inbox' : 'arquivo'))
  if (updated) applyItem(updated)
}

async function toggleRead(item: LibraryItem): Promise<void> {
  const updated = await writing.run(() => library.setUnread(item.id, !item.unread))
  if (updated) applyItem(updated)
}

/**
 * An item can only be joined to a curriculum or turned into a task while the
 * module that owns the other end is mounted and reads from the same place. A
 * real id is a UUID and a mock id is a string like `saved-link-3`, so offering
 * the action across that line would write a reference neither side resolves.
 */
const canLinkCurriculum = computed(() => crossModuleActionAllowed('library', 'study'))
const canMakeTask = computed(() => crossModuleActionAllowed('library', 'projects'))

const { data: studySummary } = useStudySummary(canLinkCurriculum)
const { data: projectsSummary } = useProjectsSummary(canMakeTask)

const curriculumOptions = computed(() => studySummary.value?.curricula ?? [])
const projectOptions = computed(() => projectsSummary.value?.projects ?? [])

type CrossAction = 'curriculo' | 'tarefa'

const openAction = ref<{ itemId: string; action: CrossAction } | null>(null)

function toggleAction(item: LibraryItem, action: CrossAction): void {
  const current = openAction.value
  openAction.value = current && current.itemId === item.id && current.action === action ? null : { itemId: item.id, action }
}

function isActionOpen(item: LibraryItem, action: CrossAction): boolean {
  return openAction.value?.itemId === item.id && openAction.value?.action === action
}

async function linkToCurriculum(item: LibraryItem, slug: string): Promise<void> {
  const updated = await writing.run(() => library.setCurriculum(item.id, slug))
  if (updated) applyItem(updated)
  openAction.value = null
}

async function makeTask(item: LibraryItem, projectId: string): Promise<void> {
  await writing.run(() =>
    projectsSource.addTask({
      projectId,
      title: `Ler "${item.title}"`,
      description: item.url,
      priority: 'P2',
      bucket: 'next'
    })
  )
  openAction.value = null
}

function curriculumTitle(item: LibraryItem): string | undefined {
  if (!item.curriculumSlug) return undefined
  return curriculumOptions.value.find((curriculum) => curriculum.slug === item.curriculumSlug)?.title
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
        <label class="library-search-label" for="library-search">Buscar na biblioteca</label>
        <input
          id="library-search"
          v-model="search"
          class="library-search"
          type="search"
          placeholder="Buscar por título ou autor…"
        />
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

    <p v-if="writing.error.value" class="library-write-error" role="alert">
      Não foi possível salvar: {{ writing.error.value }}
      <button type="button" class="ghost ghost-clear" @click="writing.clear()">Fechar</button>
    </p>

    <div v-if="firstLoad" class="library-loading" role="status">Carregando a biblioteca…</div>

    <div v-else-if="error" class="library-error" role="alert">
      <p>Não foi possível carregar a biblioteca: {{ error }}</p>
      <button type="button" class="ghost" @click="refresh()">Tentar de novo</button>
    </div>

    <div v-else class="library-list">
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
            <span class="mono">{{ formatShortDate(item.savedAt) }}</span>
            <span v-if="activeKind === null" class="item-kind">{{ KIND_LABELS[item.kind] }}</span>
            <span v-if="curriculumTitle(item)" class="tag-cur">{{ curriculumTitle(item) }}</span>
          </div>
        </div>
        <span class="mono item-date">{{ formatShortDate(item.savedAt) }}</span>
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
                v-for="curriculum in curriculumOptions"
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
                v-for="project in projectOptions"
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
    <div v-if="!firstLoad && !error" class="mono library-count">{{ countText }}</div>
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

.library-search {
  width: 220px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 13px;
}

.library-search::placeholder {
  color: var(--muted);
}

.library-search:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.library-search-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.library-loading,
.library-error {
  padding: 48px 12px;
  font-size: 15px;
  line-height: 24px;
  color: var(--muted);
  max-width: 48ch;
}

.library-error p {
  margin: 0 0 var(--space-2);
}

.library-write-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: 13px;
  line-height: 20px;
  color: var(--danger);
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
