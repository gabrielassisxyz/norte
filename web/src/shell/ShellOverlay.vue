<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { store } from '@/mock/store'
import { createSearchIndex, filterSearchIndex, groupSearchResults, type SearchEntry } from '@/search'
import { getTheme, setTheme, type Theme } from '@/theme'

export type ShellOverlayMode = 'busca' | 'prefs' | null

type PaletteAction = {
  action: 'theme' | 'prefs'
  title: string
  subtitle: string
  kind: string
}

type PaletteEntry = SearchEntry | PaletteAction

const props = defineProps<{
  open: ShellOverlayMode
}>()

const emit = defineEmits<{
  close: []
  'open-preferences': []
}>()

const router = useRouter()
const input = ref<HTMLInputElement>()
const query = ref('')
const highlighted = ref(0)
const theme = ref<Theme>(getTheme())

/**
 * The screens a mounted module offers, which is where the "Ir para" list comes
 * from: a module the server switched off contributes no entry, so the palette
 * cannot offer a way into a screen that is not there.
 */
const screenEntries = computed<SearchEntry[]>(() => createSearchIndex(store).filter((entry) => entry.kind === 'tela'))

const defaultGroups = computed<Array<{ label: string; items: PaletteEntry[] }>>(() => [
  { label: 'Ir para', items: screenEntries.value },
  {
    label: 'Ações',
    items: [
      { action: 'theme', title: 'Alternar tema', subtitle: 'Claro ou escuro', kind: 'ação' },
      { action: 'prefs', title: 'Preferências', subtitle: 'Tema e dados', kind: 'ação' }
    ]
  }
])

const results = computed(() => filterSearchIndex(createSearchIndex(store), query.value))
const groups = computed(() => (query.value.trim() ? groupSearchResults(results.value) : defaultGroups.value))
const entries = computed<PaletteEntry[]>(() => groups.value.flatMap((group) => group.items))

function close(): void {
  query.value = ''
  highlighted.value = 0
  emit('close')
}

function changeTheme(nextTheme: Theme): void {
  theme.value = nextTheme
  setTheme(nextTheme)
}

function toggleTheme(): void {
  changeTheme(theme.value === 'dark' ? 'light' : 'dark')
}

async function run(entry: PaletteEntry): Promise<void> {
  if ('action' in entry) {
    if (entry.action === 'theme') {
      toggleTheme()
      close()
    } else {
      emit('open-preferences')
    }
    return
  }

  await router.push(entry.to)
  close()
}

function select(index: number): void {
  highlighted.value = index
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlighted.value = Math.min(entries.value.length - 1, highlighted.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlighted.value = Math.max(0, highlighted.value - 1)
  } else if (event.key === 'Enter' && entries.value[highlighted.value]) {
    event.preventDefault()
    void run(entries.value[highlighted.value])
  }
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) close()
}

watch(
  () => props.open,
  (open) => {
    if (open === 'busca') {
      query.value = ''
      highlighted.value = 0
      void nextTick(() => input.value?.focus())
    }
    if (open === 'prefs') theme.value = getTheme()
  }
)

watch(query, () => {
  highlighted.value = 0
})

onMounted(() => window.addEventListener('keydown', handleWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleWindowKeydown))
</script>

<template>
  <div v-if="open === 'busca'" class="shell-overlay-backdrop" @mousedown.self="close">
    <section class="shell-palette" role="dialog" aria-label="Buscar" aria-modal="true">
      <input
        ref="input"
        v-model="query"
        class="shell-palette-input"
        type="text"
        placeholder="Buscar telas, artigos, projetos, tarefas…"
        aria-label="Buscar"
        @keydown="handleSearchKeydown"
      />
      <div class="shell-palette-results">
        <template v-for="group in groups" :key="group.label">
          <div class="shell-palette-heading">{{ group.label }}</div>
          <button
            v-for="(entry, entryIndex) in group.items"
            :key="`${group.label}-${entry.title}`"
            type="button"
            class="shell-palette-row"
            :class="{ 'is-highlighted': entries.indexOf(entry) === highlighted }"
            @mouseenter="select(entries.indexOf(entry))"
            @click="run(entry)"
          >
            <span class="shell-palette-copy">
              <span class="shell-palette-title">{{ entry.title }}</span>
              <span class="shell-palette-subtitle">{{ entry.subtitle }}</span>
            </span>
            <span class="shell-palette-kind">{{ entry.kind }}</span>
          </button>
        </template>
        <p v-if="query.trim() && results.length === 0" class="shell-palette-empty">Nada encontrado para “{{ query }}”.</p>
      </div>
      <footer class="shell-palette-footer"><span><kbd>↑↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span><span><kbd>esc</kbd> fechar</span></footer>
    </section>
  </div>

  <div v-else-if="open === 'prefs'" class="shell-overlay-backdrop" @mousedown.self="close">
    <section class="shell-preferences" role="dialog" aria-labelledby="shell-preferences-title" aria-modal="true">
      <div class="shell-preferences-intro">
        <h2 id="shell-preferences-title">Preferências</h2>
        <p>Valem para este dispositivo.</p>
      </div>
      <div class="shell-theme-section">
        <span class="shell-theme-label">Tema</span>
        <div role="radiogroup" aria-label="Tema" class="shell-theme-options">
          <button type="button" role="radio" class="shell-theme-option" :class="{ 'is-selected': theme === 'light' }" :aria-checked="theme === 'light'" @click="changeTheme('light')">
            <span class="shell-theme-radio"></span><span><strong>Claro</strong><small>Branco frio, cobalto como acento.</small></span>
          </button>
          <button type="button" role="radio" class="shell-theme-option" :class="{ 'is-selected': theme === 'dark' }" :aria-checked="theme === 'dark'" @click="changeTheme('dark')">
            <span class="shell-theme-radio"></span><span><strong>Escuro</strong><small>O cobalto clareia; o texto sobre ele escurece.</small></span>
          </button>
        </div>
      </div>
      <dl class="shell-preferences-details">
        <dt>dados</dt><dd>Dados locais neste dispositivo</dd>
        <dt>servidor</dt><dd>Os dados vêm do servidor Norte</dd>
        <dt>atalho</dt><dd>Buscar com <kbd>⌘K</kbd></dd>
      </dl>
      <div class="shell-preferences-actions"><button type="button" class="shell-close" @click="close">Fechar</button></div>
    </section>
  </div>
</template>

<style scoped>
.shell-overlay-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: rgb(13 17 23 / 32%); }
:global([data-theme='dark']) .shell-overlay-backdrop { background: rgb(0 0 0 / 60%); }
.shell-palette, .shell-preferences { box-sizing: border-box; background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); color: var(--ink); }
.shell-palette { width: min(600px, calc(100vw - 32px)); overflow: hidden; }
.shell-palette-input { display: block; width: 100%; height: 52px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--line); outline: 0; background: transparent; color: var(--ink); font: 16px var(--font-sans); }
.shell-palette-input::placeholder { color: var(--muted); }
.shell-palette-results { max-height: 52vh; overflow: auto; padding-bottom: 8px; }
.shell-palette-heading { padding: 12px 16px 4px; font: 550 12px/16px var(--font-display); color: var(--muted); }
.shell-palette-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; width: 100%; padding: 9px 16px; border: 0; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.shell-palette-row:hover, .shell-palette-row.is-highlighted { background: var(--norte-soft); }
.shell-palette-row.is-highlighted .shell-palette-title { color: var(--norte); }
.shell-palette-copy { min-width: 0; }
.shell-palette-title, .shell-palette-subtitle { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell-palette-title { font: 600 15px/22px var(--font-display); letter-spacing: -0.005em; }
.shell-palette-subtitle { font-size: 13px; line-height: 18px; color: var(--muted); }
.shell-palette-kind, .shell-preferences-details dt, kbd { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.shell-palette-empty { padding: 24px 16px; margin: 0; font-size: 14px; color: var(--muted); }
.shell-palette-footer { display: flex; gap: 16px; padding: 10px 16px; border-top: 1px solid var(--line); font-size: 12px; line-height: 16px; color: var(--muted); }
kbd { padding: 1px 5px; border: 1px solid var(--line); border-radius: var(--radius-xs); }
.shell-preferences { width: min(480px, calc(100vw - 32px)); display: grid; gap: 24px; padding: 28px; }
.shell-preferences-intro { display: grid; gap: 4px; }.shell-preferences-intro h2 { margin: 0; font: 650 24px/30px var(--font-display); letter-spacing: -0.015em; }.shell-preferences-intro p { margin: 0; font-size: 14px; line-height: 22px; color: var(--ink-2); }
.shell-theme-section, .shell-theme-options { display: grid; gap: 8px; }.shell-theme-label { font: 550 13px var(--font-display); }
.shell-theme-option { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 12px; align-items: start; width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: inherit; text-align: left; cursor: pointer; }.shell-theme-option:hover { border-color: var(--line-strong); }.shell-theme-option.is-selected { border-color: var(--norte); box-shadow: inset 0 0 0 1px var(--norte); }
.shell-theme-radio { width: 16px; height: 16px; margin-top: 3px; border: 1.5px solid var(--line-strong); border-radius: var(--radius-full); }.shell-theme-option.is-selected .shell-theme-radio { border-color: var(--norte); box-shadow: inset 0 0 0 4px var(--surface), inset 0 0 0 8px var(--norte); }.shell-theme-option strong, .shell-theme-option small { display: block; }.shell-theme-option strong { font: 600 15px var(--font-display); }.shell-theme-option small { margin-top: 2px; font-size: 13px; line-height: 20px; color: var(--muted); }
.shell-preferences-details { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px 16px; margin: 0; padding-top: 20px; border-top: 1px solid var(--line); font-size: 14px; line-height: 22px; }.shell-preferences-details dt, .shell-preferences-details dd { margin: 0; }
.shell-preferences-actions { display: flex; justify-content: flex-end; }.shell-close { height: 36px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font: 550 14px var(--font-display); cursor: pointer; }.shell-close:hover { background: var(--sunken); }
</style>
