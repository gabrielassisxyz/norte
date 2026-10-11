<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatTimeOfDay } from '@/lib/clock'
import type { MaterialKind } from '@/mock/types'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useItemNotes } from '@/modules/notes/data/composables'
import { useMaterialContext } from '@/modules/study/data/composables'
import { useSources } from '@/sources'

import { useLibraryItem } from '../data/composables'
import { libraryItemChanged } from '../data/revision'
import MaterialExercises from './MaterialView/MaterialExercises.vue'
import MaterialPanel from './MaterialView/MaterialPanel.vue'
import MaterialReader from './MaterialView/MaterialReader.vue'

type ReadingMode = 'read' | 'exercises'
type PanelTab = 'note' | 'annotations'

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
const { library, notes: notesSource } = useSources()

function routeParam(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function isMaterialKind(value: string): value is MaterialKind {
  return value === 'article' || value === 'book' || value === 'paper'
}

function defaultMode(value: MaterialKind): ReadingMode {
  return value === 'paper' ? 'exercises' : 'read'
}

function defaultPanelCollapsed(value: MaterialKind): boolean {
  return value === 'book'
}

function defaultPanelTab(value: MaterialKind): PanelTab {
  return value === 'book' ? 'note' : 'annotations'
}

const kind = computed<MaterialKind>(() => {
  const value = routeParam(route.params.kind)
  return isMaterialKind(value) ? value : 'article'
})

const materialId = computed(() => routeParam(route.params.id))

const { data: material, loading, error, refresh, apply } = useLibraryItem(materialId)
const writing = useAsyncAction()

/** Nothing has answered yet, as opposed to an answer saying the item is gone. */
const firstLoad = computed(() => loading.value && material.value === null)

/**
 * Every way out of the library — landing on a curriculum, writing a question,
 * making a card — is offered only while the module on the other end is mounted
 * and reads from the same place as this item.
 */
const canReachStudy = computed(() => crossModuleActionAllowed('library', 'study'))
const canReachNotes = computed(() => crossModuleActionAllowed('library', 'notes'))
const canReachReview = computed(() => crossModuleActionAllowed('library', 'review'))

const { data: materialContext } = useMaterialContext(materialId, canReachStudy)
const { data: materialNotes, applyHighlight, applyAnnotation } = useItemNotes(materialId, canReachNotes)

const nextMaterial = computed(() => {
  const next = materialContext.value?.next
  if (!next || !isMaterialKind(next.kind)) return undefined
  return next as { id: string; kind: MaterialKind; title: string }
})

const mode = ref<ReadingMode>(defaultMode(kind.value))
const panelTab = ref<PanelTab>(defaultPanelTab(kind.value))
const panelCollapsed = ref(defaultPanelCollapsed(kind.value))
const exerciseAnswer = ref('')
const exerciseSubmitted = ref(false)
const highlightedQuote = ref('')

watch(
  () => [route.params.kind, route.params.id],
  () => {
    mode.value = defaultMode(kind.value)
    panelTab.value = defaultPanelTab(kind.value)
    panelCollapsed.value = defaultPanelCollapsed(kind.value)
    exerciseAnswer.value = ''
    exerciseSubmitted.value = false
    highlightedQuote.value = ''
  },
  { immediate: true }
)

const isComplete = computed(() => material.value !== null && !material.value.unread)
const bodyColumns = computed(() => {
  if (mode.value === 'exercises') return 'minmax(0, 1fr)'
  return panelCollapsed.value ? 'minmax(0, 1fr) 48px' : 'minmax(0, 1fr) 380px'
})

const panelAnnotations = computed<PanelAnnotation[]>(() => {
  const loaded = materialNotes.value
  if (!loaded) return []
  const linkedAnnotationIds = new Set<string>()
  const entries: PanelAnnotation[] = []

  loaded.highlights.forEach((highlight, index) => {
    const annotation = loaded.annotations.find((candidate) => candidate.highlight_id === highlight.id)
    if (annotation) linkedAnnotationIds.add(annotation.id)
    entries.push({
      id: annotation?.id ?? highlight.id,
      quote: highlight.exact,
      note: annotation?.text,
      n: index + 1,
      location: kind.value === 'book' ? 'Capítulo atual' : 'Texto principal',
      time: annotation ? formatTimeOfDay(annotation.created_at) : 'agora'
    })
  })

  loaded.annotations
    .filter((annotation) => !linkedAnnotationIds.has(annotation.id))
    .forEach((annotation) => {
      entries.push({
        id: annotation.id,
        note: annotation.text,
        location: 'Sobre o material',
        time: formatTimeOfDay(annotation.created_at)
      })
    })

  return entries
})

const panelTabs = computed(() => [
  { value: 'note', label: 'Nota', icon: 'note' as const },
  { value: 'annotations', label: 'Anotações', count: panelAnnotations.value.length, icon: 'comment' as const }
])

const selectionActions = computed(() => [
  ...(canReachNotes.value ? ['Destacar', 'Anotar', 'Virar pergunta'] : []),
  ...(canReachReview.value ? ['Criar cartão'] : [])
])

const backTarget = computed(() => {
  if (materialContext.value && canReachStudy.value) {
    return { name: 'curriculo', params: { slug: materialContext.value.curriculumSlug } }
  }
  return { name: 'library', query: { v: 'all' } }
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

/** Completion is the item's own `unread`, so the button shows what came back. */
async function markComplete(): Promise<void> {
  const current = material.value
  if (!current) return
  const updated = await writing.run(() => library.patchItem(current.id, { unread: false }))
  if (updated) apply(updated)
  libraryItemChanged()
}

async function handleSelectionAction(payload: { action: string; text: string }): Promise<void> {
  const current = material.value
  const text = payload.text.trim()
  if (!current || !text) return

  if (payload.action === 'Destacar' || payload.action === 'Anotar') {
    const highlight = await writing.run(() => notesSource.addHighlight({ item_id: current.id, exact: text }))
    if (!highlight) return
    applyHighlight(highlight)
    highlightedQuote.value = text

    if (payload.action === 'Anotar') {
      const annotation = await writing.run(() =>
        notesSource.addAnnotation({
          item_id: current.id,
          highlight_id: highlight.id,
          text: 'Revisar esta ideia antes da próxima sessão de estudo.'
        })
      )
      if (annotation) applyAnnotation(annotation)
      panelTab.value = 'annotations'
      panelCollapsed.value = false
    }
    return
  }

  if (payload.action === 'Virar pergunta') {
    const question = await writing.run(() =>
      notesSource.addQuestion({
        item_id: current.id,
        text: `O que este trecho muda na forma de estudar?`
      })
    )
    if (question && canReachNotes.value) router.push({ name: 'notas', query: { tab: 'perguntas' } })
    return
  }

  if (payload.action === 'Criar cartão' && canReachReview.value) router.push({ name: 'revisao' })
}

async function addPanelAnnotation(text: string): Promise<void> {
  const current = material.value
  const value = text.trim()
  if (!current || !value) return
  const annotation = await writing.run(() => notesSource.addAnnotation({ item_id: current.id, text: value }))
  if (!annotation) return
  applyAnnotation(annotation)
  panelTab.value = 'annotations'
  panelCollapsed.value = false
}

function submitExercise(): void {
  if (exerciseAnswer.value.trim().length < 10) return
  exerciseSubmitted.value = true
}
</script>

<template>
  <main v-if="firstLoad" class="material-view material-state" role="status">
    <p>Carregando o material…</p>
  </main>

  <main v-else-if="error" class="material-view material-state" role="alert">
    <p>Não foi possível carregar o material: {{ error }}</p>
    <button type="button" class="material-state-action" @click="refresh()">Tentar de novo</button>
  </main>

  <main v-else-if="material" class="material-view" :class="`material-view-${kind}`">
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
        :selection-actions="selectionActions"
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

    <p v-if="writing.error.value" class="material-write-error" role="alert">
      Não foi possível salvar: {{ writing.error.value }}
    </p>
  </main>

  <main v-else class="material-view material-state">
    <h1>Material não encontrado</h1>
    <p>Este material não existe mais, ou o endereço está errado.</p>
    <RouterLink class="material-state-action" :to="{ name: 'library', query: { v: 'all' } }">
      Voltar para a biblioteca
    </RouterLink>
  </main>
</template>

<style scoped>
.material-state {
  display: grid;
  align-content: center;
  justify-items: start;
  gap: var(--space-3);
  padding: 0 48px;
  grid-template-rows: none;
  font-size: 15px;
  line-height: 24px;
  color: var(--muted);
}

.material-state h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 34px;
  color: var(--ink);
}

.material-state p {
  margin: 0;
}

.material-state-action {
  height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font: 550 13px var(--font-display);
  text-decoration: none;
  cursor: pointer;
}

.material-write-error {
  position: absolute;
  left: 20px;
  bottom: 16px;
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}

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
