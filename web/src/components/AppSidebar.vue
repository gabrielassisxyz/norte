<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import Icon from '@/components/ds/Icon.vue'
import { store } from '@/mock/store'

withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

defineEmits<{
  search: []
  preferences: []
  'toggle-collapse': []
}>()

interface SidebarLink {
  id: string
  label: string
  to: RouteLocationRaw
  count?: number | string
  /** False for cross-links that share their target with another entry. */
  trackActive?: boolean
}

interface SidebarHead {
  head: true
  label: string
}

interface ShortcutGroup {
  label: string
  entries: SidebarLink[]
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

function toggleSection(section: keyof typeof open.value): void {
  open.value[section] = !open.value[section]
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

const shortcutGroups = computed<ShortcutGroup[]>(() => [
  {
    label: 'Biblioteca',
    entries: [
      { id: 'atalho-inbox', label: 'Inbox', to: { name: 'biblioteca', query: { v: 'inbox' } }, count: countByStatus('inbox') },
      // The prototype links Artigos at the library root; the app filters
      // articles through tipo=artigos (kind post).
      {
        id: 'atalho-artigos',
        label: 'Artigos',
        to: { name: 'biblioteca', query: { tipo: 'artigos' } },
        count: store.libraryItems.filter((item) => item.kind === 'post').length
      },
      // The prototype links Shortlist at the library root (v=tudo); the mock
      // store has no shortlist yet, so it shares the full-library count.
      {
        id: 'atalho-shortlist',
        label: 'Shortlist',
        to: { name: 'biblioteca', query: { v: 'tudo' } },
        count: store.libraryItems.length
      }
    ]
  },
  {
    label: 'Estudo',
    entries: [
      { id: 'atalho-curriculos', label: 'Currículos', to: { name: 'estudo' }, count: store.curricula.length }
    ]
  }
])

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
  <aside class="app-sidebar" :class="{ 'is-collapsed': collapsed }" aria-label="Navegação principal">
    <div class="app-brand">
      <RouterLink v-if="!collapsed" :to="{ name: 'inicio' }" class="app-brand-link">Norte</RouterLink>
      <button
        type="button"
        class="app-collapse"
        :aria-label="collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'"
        :title="collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'"
        :aria-expanded="!collapsed"
        @click="$emit('toggle-collapse')"
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
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M6 3v10" />
        </svg>
      </button>
    </div>

    <nav v-if="!collapsed" aria-label="Principal" class="app-nav">
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
          <RouterLink
            v-else
            :to="row.to"
            class="app-item app-sub"
            :class="{ 'is-active': isActive(row) }"
          >
            <span class="app-label">{{ row.label }}</span>
            <span v-if="row.count !== undefined" class="app-count">{{ row.count }}</span>
          </RouterLink>
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
        <RouterLink
          v-for="entry in studyRows"
          :key="entry.id"
          :to="entry.to"
          class="app-item app-sub"
          :class="{ 'is-active': isActive(entry) }"
        >
          <span class="app-label">{{ entry.label }}</span>
          <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
        </RouterLink>
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
        <RouterLink
          v-for="entry in projectRows"
          :key="entry.id"
          :to="entry.to"
          class="app-item app-sub"
          :class="{ 'is-active': isActive(entry) }"
        >
          <span class="app-label">{{ entry.label }}</span>
          <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
        </RouterLink>
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
        <RouterLink
          v-for="entry in noteRows"
          :key="entry.id"
          :to="entry.to"
          class="app-item app-sub"
          :class="{ 'is-active': isActive(entry) }"
        >
          <span class="app-label">{{ entry.label }}</span>
          <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
        </RouterLink>
      </div>
    </nav>

    <nav v-if="!collapsed" aria-label="Atalhos" class="app-nav">
      <template v-for="group in shortcutGroups" :key="group.label">
        <div class="app-head">{{ group.label }}</div>
        <RouterLink
          v-for="entry in group.entries"
          :key="entry.id"
          :to="entry.to"
          class="app-item"
          :class="{ 'is-active': isActive(entry) }"
        >
          <span class="app-label">{{ entry.label }}</span>
          <span v-if="entry.count !== undefined" class="app-count">{{ entry.count }}</span>
        </RouterLink>
      </template>
    </nav>

    <div v-if="!collapsed" class="app-foot">
      <button type="button" class="app-item app-button" @click="$emit('search')">
        <span class="app-label">Buscar</span>
        <span class="app-count app-kbd">⌘K</span>
      </button>
      <button type="button" class="app-item app-button" @click="$emit('preferences')">
        <span class="app-label">Preferências</span>
      </button>
      <div class="app-sync">
        <span class="app-sync-dot" aria-hidden="true" />
        <span>Sincronizado há {{ store.syncMinutesAgo }} min</span>
      </div>
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

.app-sidebar.is-collapsed {
  width: 52px;
  padding: 20px 8px 16px;
}

.app-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 10px;
}

.is-collapsed .app-brand {
  justify-content: center;
  padding: 0;
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

.app-collapse {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.app-collapse:hover {
  background: var(--surface);
  color: var(--ink);
}

.app-collapse:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
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

.app-nav[aria-label='Atalhos'] .app-head {
  padding-left: 10px;
}

.app-chevron {
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

.app-chevron:hover {
  background: var(--surface);
  color: var(--ink);
}

.app-chevron:focus-visible {
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
}

.app-sync {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 10px 0;
  font-size: 12px;
  line-height: 16px;
  font-weight: 450;
  color: var(--muted);
  white-space: nowrap;
}

.app-sync-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--success);
}

@media (max-width: 900px) {
  .app-sidebar {
    display: none;
  }
}
</style>
