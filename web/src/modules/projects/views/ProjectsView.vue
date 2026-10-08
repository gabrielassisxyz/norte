<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import Stat from '@/components/ds/Stat.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import type { ProjectStatus } from '@/mock/types'
import { useSources } from '@/sources'

import { useProjectsOverview } from '../data/composables'
import type { ProjectRow } from '../data/source'

type GroupBy = 'area' | 'status'

const GROUP_OPTIONS = [
  { value: 'area', label: 'Por área' },
  { value: 'status', label: 'Por estado' }
]

const STATUS_DETAILS: Record<ProjectStatus, { label: string; tone: string }> = {
  active: { label: 'Ativo', tone: 'var(--norte)' },
  planning: { label: 'Planejando', tone: 'var(--ink-2)' },
  paused: { label: 'Pausado', tone: 'var(--muted)' },
  completed: { label: 'Concluído', tone: 'var(--success)' }
}

const STATUS_ORDER: ProjectStatus[] = ['active', 'planning', 'paused', 'completed']

const route = useRoute()
const { projects: projectsSource } = useSources()
const { data: overview, loading, error, refresh, prependProject } = useProjectsOverview()
const writing = useAsyncAction()

const firstLoad = computed(() => loading.value && overview.value === null)
const areas = computed(() => overview.value?.areas ?? [])

const groupBy = ref<GroupBy>('area')
const dialogOpen = ref(false)
const title = ref('')
const purpose = ref('')
const nextStep = ref('')
const areaId = ref('')
const createdNextSteps = ref<Record<string, string>>({})

function isGroupBy(value: unknown): value is GroupBy {
  return value === 'area' || value === 'status'
}

watch(
  () => route.query.v,
  (value) => {
    groupBy.value = value === 'status' ? 'status' : 'area'
  },
  { immediate: true }
)

watch(
  () => route.query.new,
  (value) => {
    if (value === '1') openDialog()
  },
  { immediate: true }
)

/**
 * The rows as the source counted them. The only thing added here is the next
 * step typed into the dialog, which is a note this screen keeps and the source
 * has nowhere to put yet.
 */
const projectRows = computed<ProjectRow[]>(() =>
  (overview.value?.items ?? []).map((project) => ({
    ...project,
    nextStep: createdNextSteps.value[project.id] ?? project.nextStep
  }))
)

const areaGroups = computed(() =>
  areas.value.map((area) => {
    const projects = projectRows.value.filter((project) => project.areaId === area.id)
    const active = projects.filter((project) => project.status === 'active').length
    return { ...area, projects, active }
  })
)

const statusGroups = computed(() =>
  STATUS_ORDER.map((status) => ({
    status,
    ...STATUS_DETAILS[status],
    projects: projectRows.value.filter((project) => project.status === status)
  })).filter((group) => group.projects.length > 0)
)

const stats = computed(() => ({
  active: overview.value?.counts.active ?? 0,
  openTasks: overview.value?.counts.openTasks ?? 0,
  pendingDecisions: overview.value?.counts.pendingDecisions ?? 0,
  paused: overview.value?.counts.paused ?? 0
}))

const canCreate = computed(() => Boolean(title.value.trim() && purpose.value.trim() && nextStep.value.trim() && areaId.value))

function openDialog(): void {
  areaId.value ||= areas.value.find((area) => !area.archived)?.id ?? areas.value[0]?.id ?? ''
  dialogOpen.value = true
}

function closeDialog(): void {
  dialogOpen.value = false
}

function selectGroup(value: string): void {
  if (isGroupBy(value)) groupBy.value = value
}

function projectSummary(project: ProjectRow): string {
  const parts: string[] = []
  if (project.openTasks) parts.push(`${project.openTasks} ${project.openTasks === 1 ? 'tarefa' : 'tarefas'}`)
  if (project.pendingDecisions) parts.push(`${project.pendingDecisions} ${project.pendingDecisions === 1 ? 'decisão' : 'decisões'}`)
  return parts.length ? parts.join(' · ') : 'Nada em aberto'
}

async function createProject(): Promise<void> {
  if (!canCreate.value) return

  const created = await writing.run(() =>
    projectsSource.addProject({
      areaId: areaId.value,
      title: title.value.trim(),
      purpose: purpose.value.trim(),
      status: 'planning',
      priority: 'P2'
    })
  )
  // A failed create keeps the dialog and everything typed into it.
  if (!created) return

  prependProject(created)
  createdNextSteps.value = { ...createdNextSteps.value, [created.id]: nextStep.value.trim() }
  title.value = ''
  purpose.value = ''
  nextStep.value = ''
  groupBy.value = 'area'
  closeDialog()
}
</script>

<template>
  <main class="projects-view">
    <div class="projects-inner">
      <div class="projects-actions">
        <Button variant="primary" icon="plus" @click="openDialog">Novo projeto</Button>
      </div>

      <PageTitle
        class="projects-title"
        title="Projetos"
        objective="Saber o que está em andamento, por que importa e qual é o próximo passo de cada projeto."
      />

      <section aria-label="Resumo dos projetos" class="projects-stats">
        <div class="projects-stat-list">
          <Stat :value="stats.active" label="Projetos ativos" />
          <Stat :value="stats.openTasks" label="Tarefas abertas" />
          <Stat :value="stats.pendingDecisions" label="Decisões pendentes" />
          <Stat :value="stats.paused" label="Projetos parados" />
        </div>
        <SegmentedControl :model-value="groupBy" :options="GROUP_OPTIONS" label="Agrupar projetos" @change="selectGroup" />
      </section>

      <p v-if="writing.error.value" class="projects-write-error" role="alert">
        Não foi possível salvar: {{ writing.error.value }}
      </p>

      <p v-if="firstLoad" class="projects-state" role="status">Carregando os projetos…</p>

      <div v-else-if="error" class="projects-state" role="alert">
        <p>Não foi possível carregar os projetos: {{ error }}</p>
        <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
      </div>

      <p v-else-if="projectRows.length === 0" class="projects-state">
        Nenhum projeto ainda. Comece criando um — ele guarda o próximo passo para você.
      </p>

      <div v-else-if="groupBy === 'area'" class="projects-groups" data-grouping="area">
        <section v-for="area in areaGroups" :key="area.id" :aria-labelledby="area.id" class="project-group">
          <div class="project-group-head">
            <div class="project-group-title">
              <h2 :id="area.id"><RouterLink :to="`/areas/${area.id}`">{{ area.title }}</RouterLink></h2>
              <p>{{ area.intention }}</p>
            </div>
            <span class="project-group-count">{{ area.active }} {{ area.active === 1 ? 'ativo' : 'ativos' }} · {{ area.projects.length }} total</span>
          </div>
          <div class="project-list">
            <RouterLink v-for="project in area.projects" :key="project.id" :to="`/projetos/${project.id}`" class="project-row">
              <div class="project-row-main">
                <span class="project-row-title">{{ project.title }}</span>
                <span class="project-row-purpose">{{ project.purpose }}</span>
              </div>
              <div class="project-row-facts">
                <span><b>próximo</b>{{ project.nextStep }}</span>
                <span><b>aberto</b>{{ projectSummary(project) }}</span>
              </div>
              <div class="project-row-status">
                <span :style="{ color: STATUS_DETAILS[project.status].tone }" class="project-status"><i :style="{ background: STATUS_DETAILS[project.status].tone }" />{{ STATUS_DETAILS[project.status].label }}</span>
                <span class="project-priority">{{ project.priority }}</span>
              </div>
            </RouterLink>
          </div>
        </section>
      </div>

      <div v-else class="projects-groups" data-grouping="status">
        <section v-for="group in statusGroups" :key="group.status" :aria-labelledby="`status-${group.status}`" class="project-group">
          <div class="project-group-head status-group-head">
            <div class="project-group-title"><h2 :id="`status-${group.status}`">{{ group.label }}{{ group.label === 'Pausado' ? 's' : group.label === 'Ativo' ? 's' : '' }}</h2></div>
            <span class="project-group-count">{{ group.projects.length }} {{ group.projects.length === 1 ? 'projeto' : 'projetos' }}</span>
          </div>
          <div class="project-list">
            <RouterLink v-for="project in group.projects" :key="project.id" :to="`/projetos/${project.id}`" class="project-row">
              <div class="project-row-main">
                <span class="project-row-title">{{ project.title }}</span>
                <span class="project-row-purpose">{{ project.purpose }}</span>
              </div>
              <div class="project-row-facts">
                <span><b>área</b>{{ project.areaTitle }}</span>
                <span><b>próximo</b>{{ project.nextStep }}</span>
              </div>
              <div class="project-row-status">
                <span class="project-summary">{{ projectSummary(project) }}</span>
                <span class="project-priority">{{ project.priority }}</span>
              </div>
            </RouterLink>
          </div>
        </section>
      </div>
    </div>
  </main>

  <div v-if="dialogOpen" class="projects-backdrop" @mousedown.self="closeDialog">
    <form class="projects-dialog" role="dialog" aria-labelledby="new-project-title" @submit.prevent="createProject">
      <div>
        <h2 id="new-project-title">Novo projeto</h2>
        <p>Registre o motivo e o primeiro passo para poder retomar depois.</p>
      </div>
      <TextField v-model="title" label="Nome" placeholder="Curto, como um título" />
      <TextField v-model="purpose" label="Por quê" placeholder="O que torna este projeto importante" :multiline="true" :rows="3" />
      <TextField v-model="nextStep" label="Próximo passo" placeholder="A primeira coisa concreta a fazer" />
      <fieldset class="projects-area-picker">
        <legend>Área</legend>
        <div>
          <button
            v-for="area in areas"
            :key="area.id"
            type="button"
            :class="['projects-area-option', { 'is-selected': areaId === area.id }]"
            :aria-pressed="areaId === area.id"
            @click="areaId = area.id"
          >
            {{ area.title }}
          </button>
        </div>
      </fieldset>
      <div class="projects-dialog-actions">
        <Button variant="secondary" @click="closeDialog">Cancelar</Button>
        <Button variant="primary" type="submit" :disabled="!canCreate">Criar projeto</Button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.projects-state { margin: var(--space-6) 0 0; color: var(--muted); font-size: 15px; line-height: 24px; }
.projects-state p { margin: 0 0 var(--space-2); }
.projects-write-error { margin: var(--space-4) 0 0; color: var(--danger); font-size: 13px; line-height: 20px; }

.projects-view { min-width: 0; }
.projects-inner { max-width: 1120px; margin: 0 auto; }
.projects-actions { display: flex; justify-content: flex-end; }
.projects-title { padding-top: var(--space-16); }
.projects-stats { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); margin-top: 40px; padding: 20px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.projects-stat-list { display: flex; gap: 48px; }
.projects-groups { margin-top: 56px; }
.project-group + .project-group { margin-top: 56px; }
.project-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-2); }
.project-group-title { display: flex; align-items: baseline; gap: var(--space-4); min-width: 0; }
.project-group-title h2 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 24px; font-weight: 650; letter-spacing: -0.015em; line-height: 30px; }
.project-group-title h2 a { color: inherit; text-decoration: none; }
.project-group-title h2 a:hover { color: var(--norte); }
.project-group-title p { max-width: 600px; margin: 0; color: var(--muted); font-size: 14px; line-height: 20px; text-wrap: pretty; }
.project-group-count, .project-priority { flex: none; color: var(--muted); font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; line-height: 20px; }
.project-list { border-top: 1px solid var(--line); }
.project-row { display: grid; grid-template-columns: minmax(0, 1fr) 320px 110px; gap: var(--space-6); align-items: start; padding: var(--space-4) var(--space-3); border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.project-row:hover { background: var(--surface); }
.project-row-main { display: grid; min-width: 0; gap: 2px; }
.project-row-title { overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.project-row:hover .project-row-title { color: var(--norte); }
.project-row-purpose { display: -webkit-box; overflow: hidden; color: var(--ink-2); font-size: 14px; line-height: 22px; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.project-row-facts { display: grid; gap: var(--space-1); color: var(--ink-2); font-size: 13px; line-height: 20px; }
.project-row-facts span { display: flex; gap: var(--space-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-row-facts b { width: 64px; flex: none; color: var(--muted); font-family: var(--font-mono); font-size: 12px; font-weight: 400; }
.project-row-status { display: grid; justify-items: end; gap: var(--space-1); }
.project-status { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-display); font-size: 13px; font-weight: 550; line-height: 18px; }
.project-status i { width: 7px; height: 7px; border-radius: var(--radius-full); }
.project-summary { color: var(--ink-2); font-family: var(--font-mono); font-size: 13px; line-height: 20px; text-align: right; }
.projects-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: flex-start; overflow: auto; padding-top: 10vh; background: rgb(13 17 23 / 32%); }
.projects-dialog { display: grid; width: min(560px, calc(100vw - 32px)); gap: 20px; margin-bottom: 48px; padding: 28px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.projects-dialog h2 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 24px; font-weight: 650; letter-spacing: -0.015em; line-height: 30px; }
.projects-dialog p { margin: var(--space-1) 0 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.projects-area-picker { display: grid; gap: var(--space-2); margin: 0; padding: 0; border: 0; }
.projects-area-picker legend { padding: 0; color: var(--ink); font-family: var(--font-display); font-size: 13px; font-weight: 600; line-height: 18px; }
.projects-area-picker > div { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.projects-area-option { height: 32px; padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); cursor: pointer; font-family: var(--font-display); font-size: 13px; font-weight: 550; }
.projects-area-option.is-selected { border-color: var(--norte); background: var(--norte-soft); color: var(--norte); }
.projects-area-option:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.projects-dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
@media (max-width: 900px) { .projects-stats { align-items: flex-start; flex-direction: column; } .projects-stat-list { flex-wrap: wrap; gap: var(--space-6); } .project-row { grid-template-columns: minmax(0, 1fr) 180px; } .project-row-status { grid-column: 2; justify-items: start; } }
@media (max-width: 620px) { .projects-stat-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: var(--space-4); } .project-group-head, .project-group-title { align-items: flex-start; flex-direction: column; gap: var(--space-1); } .project-row { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); } .project-row-status { grid-column: auto; justify-items: start; } .project-row-facts { display: none; } }
</style>
