<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Icon from '@/components/ds/Icon.vue'
import type { SidebarHead, SidebarLink, SidebarRow } from '@/modules/types'

import {
  sectionRows,
  sidebarShortcuts,
  sidebarTree,
  useModuleSidebars,
  useShellSidebarSections,
  type SidebarTree
} from './composition'

withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

defineEmits<{
  search: []
  preferences: []
  'toggle-collapse': []
}>()

const router = useRouter()
const route = useRoute()

/**
 * The sidebar is assembled from the mounted modules on every read, so a module
 * that the server switched off simply has no line here. Each module's part is
 * bound to its own source once, here, which is why the counts fill in as the
 * reads answer instead of being absent until a reload.
 */
const sidebars = useModuleSidebars()
const trees = computed<SidebarTree[]>(() => sidebarTree(sidebars))
const shortcutGroups = computed(() => sidebarShortcuts(sidebars))
/**
 * The shell's own blocks, which are not any module's and so are not in the
 * tree: subjects belong to the core and are there whatever the server lists.
 * They start expanded, because a grouping with no index page behind it is
 * useless collapsed.
 */
const shellSections = useShellSidebarSections()
const expanded = ref<Record<string, boolean>>(
  Object.fromEntries(shellSections.map((section) => [section.id, true]))
)

function isHead(row: SidebarRow): row is SidebarHead {
  return (row as SidebarHead).head === true
}

function toggleSection(id: string): void {
  expanded.value[id] = !expanded.value[id]
}

function rowsOf(tree: SidebarTree): SidebarRow[] {
  return sectionRows(tree)
}

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

function isSectionActive(tree: SidebarTree): boolean {
  return tree.section.activeRouteNames.includes(String(route.name))
}

const isInicio = computed(() => route.name === 'inicio')
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

      <template v-for="section in shellSections" :key="section.id">
        <div class="app-line">
          <span class="app-item app-line-link app-group">
            <span class="app-label">{{ section.label }}</span>
            <span v-if="section.count() !== undefined" class="app-count">{{ section.count() }}</span>
          </span>
          <button
            type="button"
            class="app-chevron"
            :class="{ 'is-open': expanded[section.id] }"
            :aria-expanded="Boolean(expanded[section.id])"
            :aria-label="`Expandir ${section.label}`"
            @click="toggleSection(section.id)"
          >
            <Icon name="chevronDown" :size="14" />
          </button>
        </div>
        <div v-if="expanded[section.id]" class="app-children">
          <template v-for="row in section.rows()" :key="isHead(row) ? row.label : row.id">
            <div v-if="isHead(row)" class="app-head">{{ row.label }}</div>
            <RouterLink v-else :to="row.to" class="app-item app-sub" :class="{ 'is-active': isActive(row) }">
              <span class="app-label">{{ row.label }}</span>
              <span v-if="row.count !== undefined" class="app-count">{{ row.count }}</span>
            </RouterLink>
          </template>
          <div v-if="section.rows().length === 0" class="app-empty">Nenhum assunto ainda</div>
        </div>
      </template>

      <template v-for="tree in trees" :key="tree.section.id">
        <div class="app-line">
          <RouterLink :to="tree.section.to" class="app-item app-line-link" :class="{ 'is-active': isSectionActive(tree) }">
            <span class="app-label">{{ tree.section.label }}</span>
            <span v-if="tree.section.count?.() !== undefined" class="app-count">{{ tree.section.count?.() }}</span>
          </RouterLink>
          <button
            v-if="rowsOf(tree).length > 0"
            type="button"
            class="app-chevron"
            :class="{ 'is-open': expanded[tree.section.id] }"
            :aria-expanded="Boolean(expanded[tree.section.id])"
            :aria-label="`Expandir ${tree.section.label}`"
            @click="toggleSection(tree.section.id)"
          >
            <Icon name="chevronDown" :size="14" />
          </button>
        </div>
        <div v-if="expanded[tree.section.id]" class="app-children">
          <template v-for="row in rowsOf(tree)" :key="isHead(row) ? row.label : row.id">
            <div v-if="isHead(row)" class="app-head">{{ row.label }}</div>
            <RouterLink
              v-else
              :to="row.to"
              class="app-item app-sub"
              :class="{ 'is-active': isActive(row), 'app-new': Boolean(row.icon) }"
            >
              <Icon v-if="row.icon" :name="row.icon" :size="14" />
              <span class="app-label">{{ row.label }}</span>
              <span v-if="row.count !== undefined" class="app-count">{{ row.count }}</span>
            </RouterLink>
          </template>
        </div>
      </template>
    </nav>

    <nav v-if="!collapsed && shortcutGroups.length > 0" aria-label="Atalhos" class="app-nav">
      <template v-for="group in shortcutGroups" :key="group.label">
        <div class="app-head">{{ group.label }}</div>
        <RouterLink
          v-for="entry in group.entries()"
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

.app-group {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  cursor: default;
}

.app-group:hover {
  background: transparent;
  color: var(--muted);
}

.app-empty {
  padding: 4px 10px 4px 24px;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 20px;
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


@media (max-width: 900px) {
  .app-sidebar {
    display: none;
  }
}
</style>
