<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import Icon from '@/components/ds/Icon.vue'
import { store } from '@/mock/store'

defineEmits<{
  search: []
  preferences: []
}>()

interface SidebarLink {
  id: string
  label: string
  to: RouteLocationRaw
  count?: number | string
  /** False for cross-links that share their target with another entry. */
  trackActive?: boolean
  pinnable?: boolean
}

interface SidebarHead {
  head: true
  label: string
}

type SidebarRow = SidebarLink | SidebarHead

function isHead(row: SidebarRow): row is SidebarHead {
  return (row as SidebarHead).head === true
}

const KIND_LABELS: Record<string, string> = {
  post: 'Posts',
  livro: 'Livros',
  paper: 'Papers',
  video: 'Vídeos',
  podcast: 'Podcasts',
  curso: 'Cursos'
}

const KIND_ORDER = ['post', 'livro', 'paper', 'video', 'podcast', 'curso']

const router = useRouter()
const route = useRoute()

const open = ref({ biblioteca: false, estudo: false, projetos: false, notas: false })
const pinned = ref<string[]>(['inbox', 'curriculos', 'revisao'])

function toggleSection(section: keyof typeof open.value): void {
  open.value[section] = !open.value[section]
}

function isPinned(id: string): boolean {
  return pinned.value.includes(id)
}

function togglePin(id: string): void {
  pinned.value = isPinned(id) ? pinned.value.filter((item) => item !== id) : [...pinned.value, id]
}

function countByStatus(status: string): number {
  return store.libraryItems.filter((item) => item.status === status).length
}

const libraryRows = computed<SidebarRow[]>(() => {
  const rows: SidebarRow[] = [
    { id: 'tudo', label: 'Tudo', to: { name: 'biblioteca', query: { v: 'tudo' } }, count: store.libraryItems.length },
    { id: 'inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: countByStatus('inbox') },
    { id: 'depois', label: 'Depois', to: { name: 'biblioteca', query: { v: 'depois' } }, count: countByStatus('depois') },
    { id: 'arquivo', label: 'Arquivo', to: { name: 'biblioteca', query: { v: 'arquivo' } }, count: countByStatus('arquivo') },
    { head: true, label: 'Tipos' }
  ]
  for (const kind of KIND_ORDER) {
    rows.push({
      id: `tipo-${kind}`,
      label: KIND_LABELS[kind],
      to: { name: 'biblioteca', query: { tipo: kind } },
      count: store.libraryItems.filter((item) => item.kind === kind).length
    })
  }
  rows.push({ head: true, label: 'Listas' })
  for (const curriculum of store.curricula) {
    const count = store.libraryItems.filter((item) => item.curriculumSlug === curriculum.slug).length
    if (count === 0) continue
    rows.push({
      id: `lista-${curriculum.slug}`,
      label: curriculum.title,
      to: { name: 'biblioteca', query: { v: 'tudo' } },
      count,
      trackActive: false
    })
  }
  return rows
})

const studyRows = computed<SidebarLink[]>(() => {
  // The mock data has no standalone subject entity; each curriculum module
  // reads as one subject on the Estudo home screen.
  const subjectCount = store.curricula.reduce((total, curriculum) => total + curriculum.modules.length, 0)
  return [
    { id: 'curriculos', label: 'Currículos', to: { name: 'estudo' }, count: store.curricula.length },
    { id: 'assuntos', label: 'Assuntos', to: { name: 'estudo', hash: '#assuntos' }, count: subjectCount },
    { id: 'revisao', label: 'Revisão', to: { name: 'revisao' }, count: store.reviewCards.length },
    { id: 'perguntas', label: 'Perguntas', to: { name: 'notas', query: { tab: 'perguntas' } }, count: store.questions.length }
  ]
})

const projectRows = computed<SidebarLink[]>(() =>
  store.areas
    .filter((area) => !area.archived)
    .map((area) => ({
      id: `area-${area.id}`,
      label: area.title,
      to: { name: 'area', params: { id: area.id } },
      count: store.projects.filter((project) => project.areaId === area.id).length
    }))
)

const noteRows = computed<SidebarLink[]>(() => [
  { id: 'anotacoes', label: 'Anotações', to: { name: 'notas', query: { tab: 'anotacoes' } }, count: store.annotations.length },
  { id: 'highlights', label: 'Highlights', to: { name: 'notas', query: { tab: 'highlights' } }, count: store.highlights.length },
  { id: 'perguntas-notas', label: 'Perguntas', to: { name: 'notas', query: { tab: 'perguntas' } }, count: store.questions.length }
])

const allLinks = computed<SidebarLink[]>(() => [
  ...(libraryRows.value.filter((row) => !isHead(row)) as SidebarLink[]),
  ...studyRows.value,
  ...projectRows.value,
  ...noteRows.value
])

const pinnedEntries = computed<SidebarLink[]>(() =>
  pinned.value
    .map((id) => allLinks.value.find((link) => link.id === id))
    .filter((link): link is SidebarLink => link !== undefined)
)

function isActive(link: SidebarLink): boolean {
  if (link.trackActive === false) return false
  const target = router.resolve(link.to)
  if (target.name !== route.name) return false
  const targetQuery = target.query as Record<string, unknown>
  const currentQuery = route.query as Record<string, unknown>
  for (const key of Object.keys(targetQuery)) {
    if (String(targetQuery[key] ?? '') !== String(currentQuery[key] ?? '')) return false
  }
  const targetParams = target.params as Record<string, unknown>
  const currentParams = route.params as Record<string, unknown>
  for (const key of Object.keys(targetParams)) {
    if (String(targetParams[key] ?? '') !== String(currentParams[key] ?? '')) return false
  }
  return (target.hash || '') === (route.hash || '')
}

const isInicio = computed(() => route.name === 'inicio')
const isBiblioteca = computed(() => route.name === 'biblioteca')
const isEstudo = computed(() => route.name === 'estudo' || route.name === 'curriculo')
const isProjetos = computed(() => route.name === 'projetos' || route.name === 'projeto' || route.name === 'area')
const isNotas = computed(() => route.name === 'notas')
const projectCount = computed(() => store.projects.length)
</script>

<template>
  <aside class="app-sidebar" aria-label="Navegação principal">
    <div class="app-brand">
      <RouterLink :to="{ name: 'inicio' }" class="app-brand-link">Norte</RouterLink>
    </div>

    <nav aria-label="Principal" class="app-nav">
      <RouterLink :to="{ name: 'inicio' }" class="app-item" :class="{ 'is-active': isInicio }">Início</RouterLink>

      <div class="app-line">
        <RouterLink
          :to="{ name: 'biblioteca', query: { v: 'tudo' } }"
          class="app-item app-line-link"
          :class="{ 'is-active': isBiblioteca }"
        >
          Biblioteca
        </RouterLink>
        <button
          type="button"
          class="app-chevron"
          :class="{ 'is-open': open.biblioteca }"
          :aria-expanded="open.biblioteca"
          aria-label="Expandir Biblioteca"
          @click="toggleSection('biblioteca')"
        >
          <Icon name="chevronDown" :size="14" />
        </button>
      </div>
      <div v-if="open.biblioteca" class="app-children">
        <template v-for="row in libraryRows" :key="isHead(row) ? row.label : row.id">
          <div v-if="isHead(row)" class="app-head">{{ row.label }}</div>
          <div v-else class="app-line">
            <RouterLink :to="row.to" class="app-item app-sub" :class="{ 'is-active': isActive(row) }">
              <span class="app-label">{{ row.label }}</span>
              <span v-if="row.count !== undefined" class="app-count">{{ row.count }}</span>
            </RouterLink>
            <button
              type="button"
              class="app-star"
              :aria-pressed="isPinned(row.id)"
              :title="isPinned(row.id) ? 'Remover dos favoritos' : 'Favoritar'"
              :aria-label="`${isPinned(row.id) ? 'Remover dos favoritos:' : 'Favoritar:'} ${row.label}`"
              @click="togglePin(row.id)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
                aria-hidden="true"
                :fill="isPinned(row.id) ? 'currentColor' : 'none'"
              >
                <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
              </svg>
            </button>
          </div>
        </template>
      </div>

      <div class="app-line">
        <RouterLink :to="{ name: 'estudo' }" class="app-item app-line-link" :class="{ 'is-active': isEstudo }">
          Estudo
        </RouterLink>
        <button
          type="button"
          class="app-chevron"
          :class="{ 'is-open': open.estudo }"
          :aria-expanded="open.estudo"
          aria-label="Expandir Estudo"
          @click="toggleSection('estudo')"
        >
          <Icon name="chevronDown" :size="14" />
        </button>
      </div>
      <div v-if="open.estudo" class="app-children">
        <div v-for="entry in studyRows" :key="entry.id" class="app-line">
          <RouterLink :to="entry.to" class="app-item app-sub" :class="{ 'is-active': isActive(entry) }">
            <span class="app-label">{{ entry.label }}</span>
            <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
          </RouterLink>
          <button
            type="button"
            class="app-star"
            :aria-pressed="isPinned(entry.id)"
            :title="isPinned(entry.id) ? 'Remover dos favoritos' : 'Favoritar'"
            :aria-label="`${isPinned(entry.id) ? 'Remover dos favoritos:' : 'Favoritar:'} ${entry.label}`"
            @click="togglePin(entry.id)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
              aria-hidden="true"
              :fill="isPinned(entry.id) ? 'currentColor' : 'none'"
            >
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
            </svg>
          </button>
        </div>
      </div>

      <div class="app-line">
        <RouterLink
          :to="{ name: 'projetos' }"
          class="app-item app-line-link"
          :class="{ 'is-active': isProjetos }"
        >
          <span class="app-label">Projetos</span>
          <span class="app-count">{{ projectCount }}</span>
        </RouterLink>
        <button
          type="button"
          class="app-chevron"
          :class="{ 'is-open': open.projetos }"
          :aria-expanded="open.projetos"
          aria-label="Expandir Projetos"
          @click="toggleSection('projetos')"
        >
          <Icon name="chevronDown" :size="14" />
        </button>
      </div>
      <div v-if="open.projetos" class="app-children">
        <div v-for="entry in projectRows" :key="entry.id" class="app-line">
          <RouterLink :to="entry.to" class="app-item app-sub" :class="{ 'is-active': isActive(entry) }">
            <span class="app-label">{{ entry.label }}</span>
            <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
          </RouterLink>
          <button
            type="button"
            class="app-star"
            :aria-pressed="isPinned(entry.id)"
            :title="isPinned(entry.id) ? 'Remover dos favoritos' : 'Favoritar'"
            :aria-label="`${isPinned(entry.id) ? 'Remover dos favoritos:' : 'Favoritar:'} ${entry.label}`"
            @click="togglePin(entry.id)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
              aria-hidden="true"
              :fill="isPinned(entry.id) ? 'currentColor' : 'none'"
            >
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
            </svg>
          </button>
        </div>
        <RouterLink :to="{ name: 'projetos' }" class="app-item app-sub app-new">
          <Icon name="plus" :size="14" />
          <span class="app-label">Nova área</span>
        </RouterLink>
      </div>

      <div class="app-line">
        <RouterLink :to="{ name: 'notas' }" class="app-item app-line-link" :class="{ 'is-active': isNotas }">
          Notas
        </RouterLink>
        <button
          type="button"
          class="app-chevron"
          :class="{ 'is-open': open.notas }"
          :aria-expanded="open.notas"
          aria-label="Expandir Notas"
          @click="toggleSection('notas')"
        >
          <Icon name="chevronDown" :size="14" />
        </button>
      </div>
      <div v-if="open.notas" class="app-children">
        <div v-for="entry in noteRows" :key="entry.id" class="app-line">
          <RouterLink :to="entry.to" class="app-item app-sub" :class="{ 'is-active': isActive(entry) }">
            <span class="app-label">{{ entry.label }}</span>
            <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
          </RouterLink>
          <button
            type="button"
            class="app-star"
            :aria-pressed="isPinned(entry.id)"
            :title="isPinned(entry.id) ? 'Remover dos favoritos' : 'Favoritar'"
            :aria-label="`${isPinned(entry.id) ? 'Remover dos favoritos:' : 'Favoritar:'} ${entry.label}`"
            @click="togglePin(entry.id)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
              aria-hidden="true"
              :fill="isPinned(entry.id) ? 'currentColor' : 'none'"
            >
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
            </svg>
          </button>
        </div>
      </div>
    </nav>

    <nav v-if="pinnedEntries.length > 0" aria-label="Fixados" class="app-nav">
      <div class="app-head">Fixados</div>
      <RouterLink
        v-for="entry in pinnedEntries"
        :key="entry.id"
        :to="entry.to"
        class="app-item"
        :class="{ 'is-active': isActive(entry) }"
      >
        <span class="app-label">{{ entry.label }}</span>
        <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
      </RouterLink>
    </nav>

    <div class="app-foot">
      <button type="button" class="app-item app-button" @click="$emit('search')">
        <span class="app-label">Buscar</span>
        <span class="app-count app-kbd">⌘K</span>
      </button>
      <button type="button" class="app-item app-button" @click="$emit('preferences')">
        <span class="app-label">Preferências</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 232px;
  flex: none;
  position: sticky;
  top: 0;
  height: 100vh;
  box-sizing: border-box;
  overflow: auto;
  padding: 20px 12px 16px;
  background: var(--sunken);
  border-right: 1px solid var(--line);
}

.app-brand {
  display: flex;
  align-items: center;
  padding: 0 4px 0 10px;
}

.app-brand-link {
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 28px;
  font-weight: 750;
  letter-spacing: -0.035em;
  color: var(--ink);
  text-decoration: none;
}

.app-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.app-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
  color: var(--ink-2);
  text-decoration: none;
  white-space: nowrap;
}

.app-item:hover {
  background: var(--surface);
  color: var(--ink);
}

.app-item.is-active {
  background: var(--norte-soft);
  color: var(--norte);
}

.app-item.is-active .app-count {
  color: var(--norte);
}

.app-line {
  display: flex;
  align-items: center;
  gap: 2px;
}

.app-line-link {
  flex: 1;
  min-width: 0;
}

.app-sub {
  flex: 1;
  min-width: 0;
  padding-left: 22px;
  font-weight: 500;
}

.app-new {
  justify-content: flex-start;
  color: var(--muted);
}

.app-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-count {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.app-kbd {
  font-family: var(--font-mono);
}

.app-children {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0 6px;
}

.app-head {
  padding: 10px 10px 4px 24px;
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
  color: var(--muted);
}

.app-nav[aria-label='Fixados'] .app-head {
  padding-left: 10px;
}

.app-chevron,
.app-star {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.app-chevron:hover,
.app-star:hover {
  background: var(--surface);
  color: var(--ink);
}

.app-chevron:focus-visible,
.app-star:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.app-chevron :deep(svg) {
  transform: rotate(-90deg);
  transition: transform 120ms cubic-bezier(0.2, 0, 0, 1);
}

.app-chevron.is-open :deep(svg) {
  transform: none;
}

.app-star {
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.app-line:hover .app-star,
.app-star:focus-visible,
.app-star[aria-pressed='true'] {
  opacity: 1;
}

.app-star[aria-pressed='true'] {
  color: var(--ink-2);
}

.app-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.app-button {
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

@media (max-width: 900px) {
  .app-sidebar {
    display: none;
  }
}
</style>
