<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Button from '../components/ds/Button.vue'
import Icon from '../components/ds/Icon.vue'
import SegmentedControl from '../components/ds/SegmentedControl.vue'
import type { MaterialKind, LibraryItem } from '../mock/types'
import { store } from '../mock/store'
import MaterialExercises from './MaterialView/MaterialExercises.vue'
import MaterialPanel from './MaterialView/MaterialPanel.vue'
import MaterialReader from './MaterialView/MaterialReader.vue'

type ReadingMode = 'read' | 'exercises'
type PanelTab = 'note' | 'annotations'

interface MaterialContext {
  curriculumTitle: string
  curriculumSlug: string
  moduleTitle: string
  position: number
  total: number
}

interface PanelAnnotation {
  id: string
  quote?: string
  note?: string
  n?: number
  location?: string
  time?: string
}

const route = useRoute()
const router = useRouter()

const FALLBACK_TITLES: Record<MaterialKind, string> = {
  post: 'Observações que viram hipóteses',
  livro: 'Aprender com atenção',
  paper: 'Como explicamos nossas próprias escolhas'
}

function routeParam(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function isMaterialKind(value: string): value is MaterialKind {
  return value === 'post' || value === 'livro' || value === 'paper'
}

function defaultMode(value: MaterialKind): ReadingMode {
  return value === 'paper' ? 'exercises' : 'read'
}

function defaultPanelCollapsed(value: MaterialKind): boolean {
  return value === 'livro'
}

function defaultPanelTab(value: MaterialKind): PanelTab {
  return value === 'livro' ? 'note' : 'annotations'
}

function fallbackMaterial(kind: MaterialKind, id: string): LibraryItem {
  return {
    id: id || `demo-${kind}`,
    kind,
    title: FALLBACK_TITLES[kind],
    author: 'Equipe Norte',
    url: 'https://example.com/material',
    status: 'inbox',
    unread: true,
    savedAt: '2026-10-03'
  }
}

const kind = computed<MaterialKind>(() => {
  const value = routeParam(route.params.kind)
  return isMaterialKind(value) ? value : 'post'
})

const materialId = computed(() => routeParam(route.params.id))
const storedMaterial = computed(() =>
  store.libraryItems.find((item) => item.id === materialId.value && item.kind === kind.value)
)
const material = computed(() => storedMaterial.value ?? fallbackMaterial(kind.value, materialId.value))

const materialContext = computed<MaterialContext | undefined>(() => {
  for (const curriculum of store.curricula) {
    for (const module of curriculum.modules) {
      const position = module.materials.findIndex((entry) => entry.libraryItemId === material.value.id)
      if (position >= 0) {
        return {
          curriculumTitle: curriculum.title,
          curriculumSlug: curriculum.slug,
          moduleTitle: module.title,
          position: position + 1,
          total: module.materials.length
        }
      }
    }
  }
  return undefined
})

const nextMaterial = computed(() => {
  const context = materialContext.value
  if (!context) return undefined

  const curriculum = store.curricula.find((entry) => entry.slug === context.curriculumSlug)
  const module = curriculum?.modules.find((entry) => entry.title === context.moduleTitle)
  const next = module?.materials[context.position]
  if (!next) return undefined

  const item = store.libraryItems.find((entry) => entry.id === next.libraryItemId)
  if (!item || !isMaterialKind(item.kind)) return undefined
  return item
})

const mode = ref<ReadingMode>(defaultMode(kind.value))
const panelTab = ref<PanelTab>(defaultPanelTab(kind.value))
const panelCollapsed = ref(defaultPanelCollapsed(kind.value))
const exerciseAnswer = ref('')
const exerciseSubmitted = ref(false)
const highlightedQuote = ref('')
const locallyCompleted = ref(false)

watch(
  () => [route.params.kind, route.params.id],
  () => {
    mode.value = defaultMode(kind.value)
    panelTab.value = defaultPanelTab(kind.value)
    panelCollapsed.value = defaultPanelCollapsed(kind.value)
    exerciseAnswer.value = ''
    exerciseSubmitted.value = false
    highlightedQuote.value = ''
    locallyCompleted.value = false
  },
  { immediate: true }
)

const isComplete = computed(() => locallyCompleted.value || material.value.status === 'read')
const bodyColumns = computed(() => {
  if (mode.value === 'exercises') return 'minmax(0, 1fr)'
  return panelCollapsed.value ? 'minmax(0, 1fr) 48px' : 'minmax(0, 1fr) 380px'
})

const panelAnnotations = computed<PanelAnnotation[]>(() => {
  const materialHighlights = store.highlights.filter((highlight) => highlight.materialId === material.value.id)
  const materialAnnotations = store.annotations.filter((annotation) => annotation.materialId === material.value.id)
  const linkedAnnotationIds = new Set<string>()
  const entries: PanelAnnotation[] = []

  materialHighlights.forEach((highlight, index) => {
    const annotation = materialAnnotations.find((candidate) => candidate.highlightId === highlight.id)
    if (annotation) linkedAnnotationIds.add(annotation.id)
    entries.push({
      id: annotation?.id ?? highlight.id,
      quote: highlight.text,
      note: annotation?.text,
      n: index + 1,
      location: kind.value === 'livro' ? 'Capítulo atual' : 'Texto principal',
      time: annotation?.createdAt.slice(11, 16) ?? 'agora'
    })
  })

  materialAnnotations
    .filter((annotation) => !linkedAnnotationIds.has(annotation.id))
    .forEach((annotation) => {
      entries.push({
        id: annotation.id,
        note: annotation.text,
        location: 'Sobre o material',
        time: annotation.createdAt.slice(11, 16)
      })
    })

  return entries
})

const panelTabs = computed(() => [
  { value: 'note', label: 'Nota', icon: 'note' as const },
  { value: 'annotations', label: 'Anotações', count: panelAnnotations.value.length, icon: 'comment' as const }
])

const backTarget = computed(() => {
  if (materialContext.value) {
    return { name: 'curriculo', params: { slug: materialContext.value.curriculumSlug } }
  }
  return { name: 'biblioteca', query: { v: 'tudo' } }
})

const backHref = computed(() => router.resolve(backTarget.value).href)

function goBack(): void {
  const state = router.options.history.state
  if (typeof state.position === 'number' && state.position === 0) {
    router.push(backTarget.value)
  } else {
    router.back()
  }
}

function setPanelTab(value: string): void {
  if (value === 'note' || value === 'annotations') panelTab.value = value
}

function setMode(value: string): void {
  if (value === 'read' || value === 'exercises') mode.value = value
}

function markComplete(): void {
  if (storedMaterial.value) {
    store.setLibraryItemStatus(storedMaterial.value.id, 'read')
    storedMaterial.value.unread = false
  }
  locallyCompleted.value = true
}

function handleSelectionAction(payload: { action: string; text: string }): void {
  const text = payload.text.trim()
  if (!text) return

  if (payload.action === 'Destacar' || payload.action === 'Anotar') {
    const highlight = store.addHighlight({ materialId: material.value.id, text })
    highlightedQuote.value = text

    if (payload.action === 'Anotar') {
      store.addAnnotation({
        materialId: material.value.id,
        highlightId: highlight.id,
        text: 'Revisar esta ideia antes da próxima sessão de estudo.'
      })
      panelTab.value = 'annotations'
      panelCollapsed.value = false
    }
    return
  }

  if (payload.action === 'Virar pergunta') {
    store.addQuestion({
      materialId: material.value.id,
      kind: 'what',
      text: `O que este trecho muda na forma de estudar?`
    })
    router.push({ name: 'notas', query: { tab: 'perguntas' } })
    return
  }

  if (payload.action === 'Criar cartão') router.push({ name: 'revisao' })
}

function addPanelAnnotation(text: string): void {
  const value = text.trim()
  if (!value) return
  store.addAnnotation({ materialId: material.value.id, text: value })
  panelTab.value = 'annotations'
  panelCollapsed.value = false
}

function submitExercise(): void {
  if (exerciseAnswer.value.trim().length < 10) return
  exerciseSubmitted.value = true
}
</script>

<template>
  <main class="material-view" :class="`material-view-${kind}`">
    <header class="material-top">
      <div class="material-top-start">
        <a class="material-back" :href="backHref" aria-label="Voltar" @click.prevent="goBack">
          <Icon name="arrowLeft" />
          <span>{{ materialContext?.curriculumTitle ?? 'Biblioteca' }}</span>
        </a>
        <span v-if="materialContext" class="material-crumb">
          {{ materialContext.moduleTitle }} · item
          <span class="material-mono">{{ materialContext.position }}/{{ materialContext.total }}</span>
        </span>
      </div>

      <SegmentedControl
        :options="[
          { value: 'read', label: 'Leitura' },
          { value: 'exercises', label: 'Exercícios' }
        ]"
        :model-value="mode"
        label="Modo"
        @update:model-value="setMode"
      />

      <div class="material-top-actions">
        <a
          v-if="nextMaterial"
          class="material-next"
          :href="router.resolve({ name: 'material', params: { kind: nextMaterial.kind, id: nextMaterial.id } }).href"
          @click.prevent="router.push({ name: 'material', params: { kind: nextMaterial.kind, id: nextMaterial.id } })"
        >
          Próximo: {{ nextMaterial.title }}
          <Icon name="arrow" />
        </a>
        <Button
          data-action="complete"
          :variant="isComplete ? 'secondary' : 'primary'"
          icon="check"
          @click="markComplete"
        >
          {{ isComplete ? 'Concluído' : 'Marcar como concluído' }}
        </Button>
      </div>
    </header>

    <div class="material-body" :style="{ gridTemplateColumns: bodyColumns }">
      <MaterialReader
        v-if="mode === 'read'"
        :kind="kind"
        :material="material"
        :highlighted-quote="highlightedQuote"
        @selection-action="handleSelectionAction"
        @go-exercises="mode = 'exercises'"
      />
      <MaterialExercises
        v-else
        :kind="kind"
        :material="material"
        :answer="exerciseAnswer"
        :submitted="exerciseSubmitted"
        @update:answer="exerciseAnswer = $event"
        @submit="submitExercise"
      />

      <MaterialPanel
        v-if="mode === 'read'"
        :kind="kind"
        :tabs="panelTabs"
        :annotations="panelAnnotations"
        :model-value="panelTab"
        :collapsed="panelCollapsed"
        @update:model-value="setPanelTab"
        @update:collapsed="panelCollapsed = $event"
        @add-annotation="addPanelAnnotation"
      />
    </div>
  </main>
</template>

<style scoped>
:global(.app-shell:has(.material-view)) {
  grid-template-columns: minmax(0, 1fr);
}

.material-view {
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr);
  height: 100vh;
  margin: -20px -48px -112px;
  overflow: hidden;
  background: var(--ground);
  color: var(--ink);
}

.material-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
}

.material-top-start,
.material-top-actions,
.material-back,
.material-next {
  display: inline-flex;
  align-items: center;
}

.material-top-start,
.material-top-actions {
  min-width: 0;
  gap: var(--space-3);
}

.material-top-actions {
  justify-content: flex-end;
}

.material-back,
.material-next {
  gap: var(--space-2);
  min-width: 0;
  height: 36px;
  padding: 0 10px 0 6px;
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.material-back:hover,
.material-next:hover {
  background: var(--sunken);
}

.material-next {
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
}

.material-crumb {
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.material-body {
  display: grid;
  min-height: 0;
}

.material-body > :deep(.nt-panel),
.material-body > :deep(.nt-rail) {
  min-height: 0;
}

@media (max-width: 1180px) {
  .material-crumb,
  .material-next {
    display: none;
  }
}

@media (max-width: 900px) {
  .material-view {
    margin: -24px -16px -72px;
  }

  .material-top {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 8px 16px;
  }

  .material-top-actions {
    display: none;
  }
}

@media (max-width: 860px) {
  .material-view {
    grid-template-rows: auto minmax(0, 1fr);
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .material-body {
    grid-template-columns: minmax(0, 1fr) !important;
    min-height: auto;
  }

  .material-body > :deep(.nt-panel) {
    width: 100%;
    border-top: 1px solid var(--line);
    border-left: 0;
  }

  .material-body > :deep(.nt-rail) {
    display: none;
  }
}
</style>
