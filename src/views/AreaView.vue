<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import TextField from '@/components/ds/TextField.vue'
import { store } from '@/mock/store'
import type { Bucket, ProjectStatus } from '@/mock/types'

const props = defineProps<{ id: string }>()

/** The id the route uses for the empty form of a brand new area. */
const NEW_AREA_ID = 'nova'

type ProjectFilter = 'todos' | 'ativos'

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Ativo',
  planning: 'Planejando',
  paused: 'Pausado',
  completed: 'Concluído'
}

const STATUS_TONE: Record<ProjectStatus, string> = {
  active: 'var(--norte)',
  planning: 'var(--ink-2)',
  paused: 'var(--muted)',
  completed: 'var(--success)'
}

const BUCKET_LABELS: Record<Bucket, string> = {
  today: 'Hoje',
  next: 'A seguir',
  later: 'Mais tarde',
  someday: 'Algum dia'
}

const router = useRouter()

const isNew = computed(() => props.id === NEW_AREA_ID)
const area = computed(() => store.areas.find((candidate) => candidate.id === props.id))

const editing = ref(isNew.value)
const editTitle = ref(area.value?.title ?? '')
const editIntention = ref(area.value?.intention ?? '')
const projectFilter = ref<ProjectFilter>('todos')

watch(
  () => props.id,
  () => {
    editing.value = isNew.value
    editTitle.value = area.value?.title ?? ''
    editIntention.value = area.value?.intention ?? ''
    projectFilter.value = 'todos'
  }
)

const areaProjects = computed(() =>
  store.projects.filter((project) => project.areaId === props.id)
)
const projectIds = computed(() => areaProjects.value.map((project) => project.id))
const areaTasks = computed(() => store.tasks.filter((task) => projectIds.value.includes(task.projectId)))
const areaDecisions = computed(() =>
  store.decisions.filter((decision) => projectIds.value.includes(decision.projectId))
)
const areaSessions = computed(() =>
  [...store.sessions]
    .filter((session) => projectIds.value.includes(session.projectId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
)

const openTasks = computed(() => areaTasks.value.filter((task) => !task.completed))
const pendingDecisions = computed(() =>
  areaDecisions.value.filter((decision) => decision.status !== 'decided')
)
const openBugCount = computed(() =>
  areaProjects.value.reduce((total, project) => total + project.bugs.filter((bug) => !bug.resolved).length, 0)
)
const activeProjects = computed(() =>
  areaProjects.value.filter((project) => project.status === 'active')
)
const pausedCount = computed(
  () => areaProjects.value.filter((project) => project.status === 'paused').length
)

function projectTitle(projectId: string): string {
  return areaProjects.value.find((project) => project.id === projectId)?.title ?? projectId
}

const projectRows = computed(() => {
  const visible =
    projectFilter.value === 'ativos' ? activeProjects.value : areaProjects.value
  return visible.map((project) => {
    const open = store.tasks.filter((task) => task.projectId === project.id && !task.completed)
    const bugs = project.bugs.filter((bug) => !bug.resolved)
    const counts = [`${open.length} tarefas`]
    if (bugs.length > 0) counts.push(`${bugs.length} bugs`)
    return {
      id: project.id,
      title: project.title,
      purpose: project.purpose,
      next: open[0]?.title ?? 'Nada em aberto',
      open: counts.join(' · '),
      status: STATUS_LABELS[project.status],
      statusColor: STATUS_TONE[project.status],
      priority: project.priority
    }
  })
})

const projectFilterOptions = computed(() => [
  { value: 'todos', label: 'Todos', count: areaProjects.value.length },
  { value: 'ativos', label: 'Ativos', count: activeProjects.value.length }
])

const railAreas = computed(() =>
  store.areas
    .filter((candidate) => !candidate.archived || candidate.id === props.id)
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.title,
      count: store.projects.filter((project) => project.areaId === candidate.id).length
    }))
)

const archivedCount = computed(() => store.areas.filter((candidate) => candidate.archived).length)

const editHeading = computed(() => (isNew.value ? 'Nova área' : 'Editar área'))
const canSave = computed(() => editTitle.value.trim().length > 0 && editIntention.value.trim().length > 0)

function toggleEdit(): void {
  editing.value = !editing.value
  editTitle.value = area.value?.title ?? ''
  editIntention.value = area.value?.intention ?? ''
}

function save(): void {
  if (!canSave.value) return
  const title = editTitle.value.trim()
  const intention = editIntention.value.trim()
  if (isNew.value) {
    const created = store.addArea({ title, intention })
    editing.value = false
    void router.push({ name: 'area', params: { id: created.id } })
    return
  }
  if (!area.value) return
  store.updateArea(area.value.id, { title, intention })
  editing.value = false
}

function cancel(): void {
  if (isNew.value) {
    void router.push({ name: 'projetos' })
    return
  }
  editTitle.value = area.value?.title ?? ''
  editIntention.value = area.value?.intention ?? ''
  editing.value = false
}

function archive(): void {
  if (!area.value) return
  store.archiveArea(area.value.id)
  editing.value = false
}

function unarchive(): void {
  if (!area.value) return
  store.unarchiveArea(area.value.id)
}
</script>

<template>
  <main v-if="area || isNew" class="area">
    <div class="area-top">
      <nav class="crumb" aria-label="Navegação estrutural">
        <RouterLink :to="{ name: 'projetos' }">Projetos</RouterLink>
        <span aria-hidden="true">/</span>
        <span class="crumb-current">{{ area?.title ?? 'Nova área' }}</span>
      </nav>
      <div class="area-actions">
        <button
          v-if="!isNew"
          type="button"
          class="ghost"
          :aria-expanded="editing"
          @click="toggleEdit()"
        >
          {{ editing ? 'Fechar edição' : 'Editar área' }}
        </button>
        <RouterLink :to="{ name: 'projetos' }" class="area-new-project">
          <Icon name="plus" />
          Novo projeto
        </RouterLink>
      </div>
    </div>

    <div class="area-page">
      <div class="area-main">
        <template v-if="!editing && area">
          <div class="area-hero">
            <PageTitle :title="area.title" :objective="area.intention" />
          </div>

          <p v-if="area.archived" class="body-sm area-archived">
            Área arquivada. Some da sidebar e da lista; os projetos continuam acessíveis pela busca.
            <button type="button" class="ghost ghost-inline" @click="unarchive()">Desfazer</button>
          </p>

          <div class="area-strip">
            <span class="mono area-strip-meta">
              {{ areaProjects.length }} projetos · {{ activeProjects.length }} ativos ·
              {{ pausedCount }} pausados
            </span>
            <span class="mono area-strip-meta">
              {{ areaTasks.length }} tarefas · {{ areaDecisions.length }} decisões ·
              {{ openBugCount }} bugs
            </span>
            <span class="mono area-strip-meta">{{ areaSessions.length }} sessões</span>
          </div>
        </template>

        <div v-if="editing" class="area-edit">
          <div class="area-edit-head">
            <h1 class="area-edit-title">{{ editHeading }}</h1>
            <p class="body-sm area-muted">
              Uma área é um projeto permanente: não termina, só muda de forma. Nome curto, intenção
              em uma frase.
            </p>
          </div>
          <div class="area-edit-grid">
            <div class="area-edit-form">
              <TextField
                v-model="editTitle"
                label="Nome"
                placeholder="Curto: Finanças, Saúde, Escrita"
              />
              <TextField
                v-model="editIntention"
                label="Intenção"
                multiline
                :rows="3"
                placeholder="Uma frase que diz o que entra nesta área"
              />
              <p class="body-sm area-muted area-edit-hint">
                A intenção aparece ao lado do nome na lista de projetos e no topo desta página.
                Escreva como critério: o que entra nesta área e o que não entra.
              </p>
              <div class="area-edit-actions">
                <Button variant="primary" :disabled="!canSave" @click="save()">Salvar</Button>
                <Button variant="secondary" @click="cancel()">Cancelar</Button>
              </div>
            </div>
            <div v-if="area" class="area-edit-side">
              <div class="area-edit-block">
                <div class="sub area-edit-sub">
                  {{ area.archived ? 'Desarquivar área' : 'Arquivar área' }}
                </div>
                <p class="body-sm area-edit-note">
                  Some da sidebar e da lista de projetos. Os {{ areaProjects.length }} projetos
                  continuam acessíveis pela busca e podem ser movidos para outra área.
                </p>
                <button
                  v-if="area.archived"
                  type="button"
                  class="ghost area-edit-button"
                  @click="unarchive()"
                >
                  Desarquivar
                </button>
                <button v-else type="button" class="ghost area-edit-button" @click="archive()">
                  Arquivar
                </button>
              </div>
              <div class="area-edit-rule" />
              <div class="area-edit-block">
                <div class="sub area-edit-sub">Excluir área</div>
                <p class="body-sm area-edit-note">
                  Só é possível com a área vazia. Mova ou arquive os {{ areaProjects.length }}
                  projetos antes.
                </p>
                <button type="button" class="ghost ghost-danger area-edit-button" disabled>
                  Excluir
                </button>
              </div>
            </div>
          </div>
        </div>

        <template v-if="!editing && area">
          <section aria-labelledby="h-area-proj" class="area-section">
            <div class="sec-head">
              <h2 id="h-area-proj" class="sec-title">Projetos</h2>
              <SegmentedControl
                label="Filtrar projetos"
                :options="projectFilterOptions"
                :model-value="projectFilter"
                @change="projectFilter = $event as ProjectFilter"
              />
            </div>
            <div class="sec-lines">
              <RouterLink
                v-for="project in projectRows"
                :key="project.id"
                :to="{ name: 'projeto', params: { id: project.id } }"
                class="row row-proj"
              >
                <div class="row-main">
                  <div class="row-title">{{ project.title }}</div>
                  <div class="row-sub">{{ project.purpose }}</div>
                </div>
                <div class="row-meta">
                  <div class="row-fact">
                    <span class="mono row-key">próximo</span>
                    <span class="row-value">{{ project.next }}</span>
                  </div>
                  <div class="row-fact">
                    <span class="mono row-key">aberto</span>
                    <span class="mono">{{ project.open }}</span>
                  </div>
                </div>
                <div class="row-side">
                  <span class="row-status" :style="{ color: project.statusColor }">
                    <span
                      class="row-dot"
                      :style="{ background: project.statusColor }"
                      aria-hidden="true"
                    />
                    {{ project.status }}
                  </span>
                  <span class="mono row-priority">{{ project.priority }}</span>
                </div>
              </RouterLink>
              <p v-if="projectRows.length === 0" class="empty">Nenhum projeto aqui.</p>
            </div>
          </section>

          <div class="area-two">
            <section aria-labelledby="h-area-tarefas">
              <div class="sec-head sec-head-inline">
                <h2 id="h-area-tarefas" class="sec-title">Tarefas da área</h2>
                <span class="sec-hint">Em aberto</span>
              </div>
              <div class="sec-lines">
                <RouterLink
                  v-for="task in openTasks"
                  :key="task.id"
                  :to="{ name: 'tarefa', params: { id: task.id } }"
                  class="task-row"
                >
                  <span class="task-box" aria-hidden="true" />
                  <div class="task-main">
                    <span class="task-title">{{ task.title }}</span>
                    <span class="task-why">{{ task.description }}</span>
                  </div>
                  <span class="mono task-bucket">{{ BUCKET_LABELS[task.bucket] }}</span>
                </RouterLink>
                <p v-if="openTasks.length === 0" class="empty">Nada em aberto.</p>
              </div>
              <p class="body-sm area-muted area-note">
                Tarefa que cresce vira projeto: "Promover a projeto" leva o por quê junto.
              </p>
            </section>
            <section aria-labelledby="h-area-dec">
              <div class="sec-head sec-head-inline">
                <h2 id="h-area-dec" class="sec-title">Decisões pendentes</h2>
                <span class="mono sec-hint">{{ pendingDecisions.length }}</span>
              </div>
              <div class="sec-lines">
                <RouterLink
                  v-for="decision in pendingDecisions"
                  :key="decision.id"
                  :to="{ name: 'decisao', params: { id: decision.id } }"
                  class="decision-row"
                >
                  <span class="decision-title">{{ decision.title }}</span>
                  <span class="decision-meta">
                    <span>{{ projectTitle(decision.projectId) }}</span>
                    <span aria-hidden="true">·</span>
                    <span class="mono" :class="{ 'is-undated': !decision.postponedUntil }">
                      {{ decision.postponedUntil ?? 'sem prazo' }}
                    </span>
                  </span>
                </RouterLink>
                <p v-if="pendingDecisions.length === 0" class="empty">Nada pendente.</p>
              </div>
            </section>
          </div>

          <section aria-labelledby="h-area-hist" class="area-section">
            <div class="sec-head sec-head-inline">
              <h2 id="h-area-hist" class="sec-title">Últimas sessões</h2>
              <span class="sec-hint">Para onde o tempo da área está indo</span>
            </div>
            <div class="sec-lines">
              <div v-for="session in areaSessions" :key="session.id" class="session-row">
                <span class="mono session-date">{{ session.startedAt.slice(0, 10) }}</span>
                <RouterLink
                  :to="{ name: 'projeto', params: { id: session.projectId } }"
                  class="session-project"
                >
                  {{ projectTitle(session.projectId) }}
                </RouterLink>
                <span class="session-note">{{ session.summary }}</span>
              </div>
              <p v-if="areaSessions.length === 0" class="empty">Nenhuma sessão registada.</p>
            </div>
          </section>
        </template>
      </div>

      <nav class="rail" aria-label="Áreas">
        <div class="rail-head">
          <span class="rail-label">Áreas</span>
          <RouterLink :to="{ name: 'area', params: { id: NEW_AREA_ID } }" class="rail-new">
            Nova
          </RouterLink>
        </div>
        <RouterLink
          v-for="entry in railAreas"
          :key="entry.id"
          :to="{ name: 'area', params: { id: entry.id } }"
          class="area-link"
          :class="{ 'is-active': entry.id === props.id }"
        >
          <span class="area-link-label">{{ entry.label }}</span>
          <span class="mono area-link-count">{{ entry.count }}</span>
        </RouterLink>
        <RouterLink :to="{ name: 'projetos' }" class="area-link area-link-archived">
          <span class="area-link-label">Arquivadas</span>
          <span class="mono area-link-count">{{ archivedCount }}</span>
        </RouterLink>
      </nav>
    </div>
  </main>

  <main v-else class="area area-missing">
    <h1 class="sec-title">Área não encontrada</h1>
    <RouterLink :to="{ name: 'projetos' }" class="missing-link">Voltar para Projetos</RouterLink>
  </main>
</template>

<style scoped>
.area {
  max-width: 1120px;
  margin: 0 auto;
}

.area-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
  color: var(--muted);
}

.crumb a {
  color: var(--muted);
  text-decoration: none;
}

.crumb a:hover {
  color: var(--ink);
}

.crumb-current {
  color: var(--ink);
}

.area-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
}

.ghost:hover {
  background: var(--surface);
  color: var(--ink);
}

.ghost-inline {
  height: 24px;
  padding: 0 6px;
}

.ghost-danger {
  color: var(--danger);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: default;
}

.area-new-project {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  background: var(--norte);
  color: var(--on-norte);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
}

.area-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px;
  gap: 64px;
  align-items: start;
}

.area-main {
  min-width: 0;
}

.area-hero {
  padding-top: 72px;
}

.area-archived {
  margin-top: 16px;
  color: var(--muted);
}

.area-strip {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 24px;
  padding: 20px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.area-strip-meta {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.area-edit {
  padding-top: 72px;
  display: grid;
  gap: 32px;
}

.area-edit-head {
  display: grid;
  gap: 4px;
}

.area-edit-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 40px;
  line-height: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.area-edit-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 48px;
  align-items: start;
}

.area-edit-form {
  display: grid;
  gap: 20px;
  max-width: 560px;
}

.area-edit-hint {
  max-width: 60ch;
}

.area-edit-actions {
  display: flex;
  gap: 12px;
  padding-top: 8px;
}

.area-edit-side {
  display: grid;
  gap: 20px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.area-edit-block {
  display: grid;
  gap: 6px;
}

.area-edit-sub {
  font-size: 15px;
}

.area-edit-note {
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.area-edit-button {
  justify-self: start;
  margin-left: -10px;
}

.area-edit-rule {
  border-top: 1px solid var(--line);
}

.area-section {
  margin-top: 56px;
}

.area-two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 48px;
  margin-top: 64px;
}

.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.sec-head-inline {
  justify-content: flex-start;
}

.sec-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: -0.015em;
}

.sec-hint {
  font-size: 14px;
  line-height: 20px;
  color: var(--muted);
}

.sec-lines {
  border-top: 1px solid var(--line);
}

.sub {
  margin: 0;
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.body-sm {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
  text-wrap: pretty;
}

.area-muted {
  color: var(--muted);
}

.area-note {
  font-size: 13px;
  line-height: 20px;
  margin-top: 12px;
  max-width: 48ch;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.empty {
  margin: 0;
  padding: 16px 12px;
  font-size: 14px;
  line-height: 22px;
  color: var(--muted);
}

.row {
  display: grid;
  align-items: center;
  gap: 24px;
  padding: 16px 12px;
  border-bottom: 1px solid var(--line);
  text-decoration: none;
  color: inherit;
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.row:hover {
  background: var(--surface);
}

.row:hover .row-title {
  color: var(--norte);
}

.row-proj {
  grid-template-columns: minmax(0, 1fr) 320px 110px;
}

.row-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.row-title {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  transition: color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.row-sub {
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
  max-width: 65ch;
  text-wrap: pretty;
}

.row-meta {
  display: grid;
  gap: 4px;
  font-size: 13px;
  line-height: 20px;
  color: var(--ink-2);
}

.row-fact {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.row-key {
  color: var(--muted);
  width: 64px;
  flex: none;
}

.row-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-side {
  display: grid;
  gap: 4px;
  justify-items: end;
}

.row-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 18px;
  font-weight: 550;
}

.row-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
}

.row-priority {
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}

.task-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  align-items: start;
  text-decoration: none;
  color: inherit;
}

.task-row:hover {
  background: var(--surface);
}

.task-box {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
}

.task-main {
  display: grid;
  gap: 2px;
}

.task-title {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.task-why {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
  text-wrap: pretty;
}

.task-bucket {
  font-size: 12px;
  line-height: 22px;
  color: var(--muted);
}

.decision-row {
  display: grid;
  gap: 2px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  text-decoration: none;
  color: var(--ink);
}

.decision-row:hover {
  background: var(--surface);
}

.decision-title {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.decision-meta {
  display: flex;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.decision-meta .mono {
  color: var(--ink);
}

.decision-meta .is-undated {
  color: var(--muted);
}

.session-row {
  display: grid;
  grid-template-columns: 96px 200px minmax(0, 1fr);
  gap: 24px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  align-items: baseline;
}

.session-date {
  font-size: 13px;
  line-height: 22px;
  color: var(--muted);
}

.session-project {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  text-decoration: none;
}

.session-note {
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
  text-wrap: pretty;
}

.rail {
  position: sticky;
  top: 92px;
  padding-top: 72px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rail-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 10px 8px;
}

.rail-label {
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
  color: var(--muted);
}

.rail-new {
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
  text-decoration: none;
}

.area-link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 18px;
  font-weight: 550;
  color: var(--muted);
  text-decoration: none;
  align-items: center;
}

.area-link:hover {
  background: var(--surface);
  color: var(--ink);
}

.area-link.is-active {
  color: var(--norte);
  background: var(--norte-soft);
}

.area-link-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.area-link-count {
  font-size: 12px;
}

.area-link-archived {
  margin-top: 8px;
}

.area-missing {
  display: grid;
  gap: 12px;
  padding-top: 72px;
  justify-items: start;
}

@media (max-width: 1240px) {
  .rail {
    display: none;
  }

  .area-page {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1180px) {
  .row-proj {
    grid-template-columns: minmax(0, 1fr) 110px;
  }

  .row-proj .row-meta {
    display: none;
  }

  .area-two {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .row-proj {
    grid-template-columns: minmax(0, 1fr);
  }

  .area-edit-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
