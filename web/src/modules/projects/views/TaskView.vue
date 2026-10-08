<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import Tag from '@/components/ds/Tag.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { nowTimestamp } from '@/lib/clock'
import type { Bucket, Decision } from '@/mock/types'
import { useSources } from '@/sources'

import { useTask } from '../data/composables'
import SessionDialog from './TaskView/SessionDialog.vue'

const props = defineProps<{ id: string }>()

const editing = ref(false)
const editTitle = ref('')
const editDescription = ref('')
const sessionOpen = ref(false)

const { projects: projectsSource } = useSources()
const { data: detail, loading, error, refresh, applyTask, refreshSessions } = useTask(() => props.id)
const writing = useAsyncAction()

const firstLoad = computed(() => loading.value && detail.value === null)
const task = computed(() => detail.value?.task)
const project = computed(() => detail.value?.project)
const area = computed(() => detail.value?.area)
const taskSessions = computed(() => detail.value?.sessions ?? [])
const blockingDecisions = computed(() => detail.value?.blockingDecisions ?? [])
const siblingTasks = computed(() => detail.value?.siblingTasks ?? [])

// The prototype offers three horizons; the fourth mock bucket ("someday")
// keeps its stored value and simply shows no active pick here.
const BUCKETS: Array<{ value: Bucket; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'next', label: 'Esta semana' },
  { value: 'later', label: 'Depois' }
]

const BUCKET_LABELS: Record<Bucket, string> = {
  today: 'Hoje',
  next: 'Esta semana',
  later: 'Depois',
  someday: 'Algum dia'
}

const DECISION_STATUS: Record<Decision['status'], string> = {
  open: 'aberta',
  decided: 'decidida',
  postponed: 'adiada'
}

const doneSteps = computed(() => task.value?.steps.filter((step) => step.completed).length ?? 0)

function openEdit(): void {
  editTitle.value = task.value?.title ?? ''
  editDescription.value = task.value?.description ?? ''
  editing.value = true
}

function closeEdit(): void {
  editing.value = false
}

/** Each write shows the task the source answered with, or nothing at all. */
async function saveEdit(): Promise<void> {
  const current = task.value
  if (!current || editTitle.value.trim().length === 0) return
  const updated = await writing.run(() =>
    projectsSource.updateTask(current.id, {
      title: editTitle.value.trim(),
      description: editDescription.value.trim()
    })
  )
  if (!updated) return
  applyTask(updated)
  editing.value = false
}

async function pickBucket(bucket: Bucket): Promise<void> {
  const current = task.value
  if (!current || current.bucket === bucket) return
  const updated = await writing.run(() => projectsSource.setTaskBucket(current.id, bucket))
  if (updated) applyTask(updated)
}

async function toggleDone(): Promise<void> {
  const current = task.value
  if (!current) return
  const updated = await writing.run(() => projectsSource.toggleTaskDone(current.id))
  if (updated) applyTask(updated)
}

async function toggleStep(stepId: string): Promise<void> {
  const current = task.value
  if (!current) return
  const updated = await writing.run(() => projectsSource.toggleTaskStep(current.id, stepId))
  if (updated) applyTask(updated)
}

async function saveSession(payload: { did: string; next: string }): Promise<void> {
  const current = task.value
  const currentProject = project.value
  if (!current || !currentProject) return
  const saved = await writing.run(() =>
    projectsSource.addSession({
      projectId: currentProject.id,
      taskId: current.id,
      startedAt: nowTimestamp(),
      durationMinutes: 25,
      summary: `${payload.did} Próximo: ${payload.next}`
    })
  )
  // A failed save keeps the dialog open with everything typed into it.
  if (!saved) return

  // The session list belongs to the task's read, so it is read again.
  await refreshSessions()
  sessionOpen.value = false
}

function sessionDate(startedAt: string): string {
  return startedAt.slice(0, 10)
}
</script>

<template>
  <main v-if="firstLoad" class="task task-missing" role="status">
    <p>Carregando a tarefa…</p>
  </main>

  <main v-else-if="error" class="task task-missing" role="alert">
    <p>Não foi possível carregar a tarefa: {{ error }}</p>
    <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
  </main>

  <main v-else-if="task && project" class="task">
    <div class="task-top">
      <nav class="crumb" aria-label="Navegação estrutural">
        <RouterLink :to="{ name: 'projetos' }">Projetos</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="area" :to="{ name: 'area', params: { id: area.id } }">{{
          area.title
        }}</RouterLink>
        <span v-if="area" aria-hidden="true">/</span>
        <RouterLink :to="{ name: 'projeto', params: { id: project.id } }">{{
          project.title
        }}</RouterLink>
        <span aria-hidden="true">/</span>
        <span class="crumb-current">{{ task.title }}</span>
      </nav>
      <div class="task-actions">
        <button type="button" class="ghost" :aria-pressed="editing" @click="editing ? closeEdit() : openEdit()">
          {{ editing ? 'Fechar edição' : 'Editar' }}
        </button>
        <Button variant="secondary" icon="note" @click="sessionOpen = true">Registrar sessão</Button>
        <Button variant="primary" icon="check" @click="toggleDone()">
          {{ task.completed ? 'Reabrir tarefa' : 'Marcar como feita' }}
        </Button>
      </div>
    </div>

    <p v-if="writing.error.value" class="task-write-error" role="alert">
      Não foi possível salvar: {{ writing.error.value }}
    </p>

    <div class="task-page">
      <div class="task-main">
        <div class="task-hero">
          <div v-if="editing" class="task-edit">
            <TextField label="Título" v-model="editTitle" />
            <TextField label="Descrição" :multiline="true" :rows="2" v-model="editDescription" />
            <div class="task-edit-actions">
              <Button variant="primary" :disabled="editTitle.trim().length === 0" @click="saveEdit">
                Salvar
              </Button>
              <Button variant="secondary" @click="closeEdit">Cancelar</Button>
            </div>
          </div>
          <PageTitle v-else :title="task.title" :objective="task.description" />
        </div>

        <div class="task-strip">
          <span class="task-status" :class="{ 'is-done': task.completed }">
            <span class="task-dot" aria-hidden="true" />
            {{ task.completed ? 'Concluída' : 'Em andamento' }}
          </span>
          <span class="mono task-priority">{{ task.priority }}</span>
          <span class="mono task-strip-meta">
            {{ doneSteps }}/{{ task.steps.length }} passos · {{ taskSessions.length }}
            {{ taskSessions.length === 1 ? 'sessão' : 'sessões' }}
          </span>
        </div>

        <section aria-labelledby="h-what" class="task-section">
          <h2 id="h-what" class="sec-title">O que fazer</h2>
          <p class="body">{{ task.description }}</p>
          <div class="steps">
            <button
              v-for="step in task.steps"
              :key="step.id"
              type="button"
              class="step"
              :class="{ 'is-done': step.completed }"
              :aria-pressed="step.completed"
              @click="toggleStep(step.id)"
            >
              <span class="box" aria-hidden="true">
                <svg
                  v-if="step.completed"
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
              </span>
              <span class="txt">{{ step.title }}</span>
            </button>
            <p v-if="task.steps.length === 0" class="empty">Sem passos registados.</p>
          </div>
        </section>

        <section aria-labelledby="h-context" class="task-section">
          <h2 id="h-context" class="sec-title">Contexto</h2>
          <div class="refs">
            <RouterLink
              class="ref"
              :to="{ name: 'projeto', params: { id: project.id } }"
            >
              <span class="mono ref-kind">projeto</span>
              <span class="ref-title">{{ project.title }}</span>
              <span class="mono ref-meta">{{ area?.title ?? '' }}</span>
            </RouterLink>
            <RouterLink
              v-for="decision in blockingDecisions"
              :key="decision.id"
              class="ref"
              :to="{ name: 'decisao', params: { id: decision.id } }"
            >
              <span class="mono ref-kind">decisão</span>
              <span class="ref-title">{{ decision.title }}</span>
              <span class="mono ref-meta">{{ DECISION_STATUS[decision.status] }}</span>
            </RouterLink>
          </div>
        </section>

        <section aria-labelledby="h-sessions" class="task-section">
          <div class="sec-head">
            <h2 id="h-sessions" class="sec-title">Sessões nesta tarefa</h2>
            <span class="mono sec-hint">{{ taskSessions.length }}</span>
          </div>
          <div class="sessions">
            <div v-for="session in taskSessions" :key="session.id" class="sess">
              <span class="mono sess-date">{{ sessionDate(session.startedAt) }}</span>
              <span class="body-sm sess-note">{{ session.summary }}</span>
            </div>
            <p v-if="taskSessions.length === 0" class="empty">Sem sessões registadas.</p>
          </div>
        </section>
      </div>

      <aside class="aside">
        <div class="meta">
          <span class="k">projeto</span>
          <RouterLink :to="{ name: 'projeto', params: { id: project.id } }" class="meta-link">
            {{ project.title }}
          </RouterLink>
          <span class="k">área</span>
          <RouterLink v-if="area" :to="{ name: 'area', params: { id: area.id } }" class="meta-plain">
            {{ area.title }}
          </RouterLink>
          <span v-else class="meta-plain">—</span>
          <span class="k">prioridade</span>
          <span class="mono meta-priority">{{ task.priority }}</span>
          <span class="k">bloqueada por</span>
          <span v-if="blockingDecisions.length === 0" class="meta-plain">—</span>
          <RouterLink
            v-for="decision in blockingDecisions"
            :key="decision.id"
            :to="{ name: 'decisao', params: { id: decision.id } }"
            class="meta-plain meta-blocker"
          >
            {{ decision.title }}
          </RouterLink>
        </div>

        <div class="aside-block">
          <span class="aside-label">Mover para</span>
          <div class="bucket-row">
            <Tag
              v-for="bucket in BUCKETS"
              :key="bucket.value"
              :active="task.bucket === bucket.value"
              @click="pickBucket(bucket.value)"
            >
              {{ bucket.label }}
            </Tag>
          </div>
          <span class="aside-hint">Aparece em “{{ BUCKET_LABELS[task.bucket] }}” na home.</span>
        </div>

        <div class="aside-block">
          <span class="aside-label">Outras tarefas {{ task.priority }} do projeto</span>
          <RouterLink
            v-for="sibling in siblingTasks"
            :key="sibling.id"
            :to="{ name: 'tarefa', params: { id: sibling.id } }"
            class="sibling"
          >
            {{ sibling.title }}
          </RouterLink>
          <span v-if="siblingTasks.length === 0" class="aside-hint">Nada aqui.</span>
        </div>
      </aside>
    </div>

    <SessionDialog v-if="sessionOpen" @close="sessionOpen = false" @save="saveSession" />
  </main>

  <main v-else class="task task-missing">
    <PageTitle title="Tarefa não encontrada" objective="Esta tarefa não existe." />
    <RouterLink :to="{ name: 'projetos' }" class="missing-link">Voltar para Projetos</RouterLink>
  </main>
</template>

<style scoped>
.task {
  max-width: 1120px;
  margin: 0 auto;
}

.task-top {
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
  flex-wrap: wrap;
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

.task-actions {
  display: flex;
  gap: 12px;
  align-items: center;
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

.task-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 64px;
  align-items: start;
}

.task-main {
  min-width: 0;
}

.task-hero {
  padding-top: 72px;
}

.task-edit {
  display: grid;
  gap: 20px;
  max-width: 640px;
}

.task-edit-actions {
  display: flex;
  gap: 12px;
}

.task-strip {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.task-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
  color: var(--norte);
}

.task-status.is-done {
  color: var(--success);
}

.task-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--norte);
}

.task-status.is-done .task-dot {
  background: var(--success);
}

.task-priority {
  font-size: 13px;
  line-height: 20px;
  color: var(--norte);
}

.task-strip-meta {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.task-section {
  margin-top: 56px;
}

.sec-title {
  margin: 0 0 16px;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--ink);
}

.sec-head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 8px;
}

.sec-head .sec-title {
  margin-bottom: 0;
}

.sec-hint {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.body {
  font-size: 16px;
  line-height: 26px;
  color: var(--ink);
  max-width: 65ch;
  text-wrap: pretty;
  margin: 0;
}

.body-sm {
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
  text-wrap: pretty;
  margin: 0;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.empty {
  margin: 0;
  padding: 12px;
  font-size: 14px;
  line-height: 22px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}

.steps {
  margin-top: 24px;
  border-top: 1px solid var(--line);
}

.step {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  width: 100%;
  padding: 10px 0;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.step .box {
  margin-top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  color: var(--on-norte);
}

.step.is-done .box {
  background: var(--norte);
  border-color: var(--norte);
}

.step .txt {
  font-size: 15px;
  line-height: 24px;
  color: var(--ink);
}

.step.is-done .txt {
  color: var(--muted);
  text-decoration: line-through;
}

.refs {
  margin-top: 20px;
  border-top: 1px solid var(--line);
}

.ref {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  text-decoration: none;
  color: var(--ink);
}

.ref:hover .ref-title {
  color: var(--norte);
}

.ref-kind {
  font-size: 12px;
  color: var(--muted);
}

.ref-title {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.ref-meta {
  font-size: 12px;
  color: var(--muted);
}

.sessions {
  border-top: 1px solid var(--line);
}

.sess {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 24px;
  align-items: baseline;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.sess-date {
  font-size: 13px;
  color: var(--muted);
}

.sess-note {
  color: var(--ink);
}

.aside {
  position: sticky;
  top: 92px;
  padding-top: 72px;
  display: grid;
  gap: 28px;
  align-content: start;
}

.meta {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 6px 16px;
  font-size: 14px;
  line-height: 22px;
}

.meta .k {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 22px;
  color: var(--muted);
}

.meta-link {
  text-decoration: none;
  font-family: var(--font-display);
  font-weight: 550;
  color: var(--ink);
}

.meta-link:hover {
  color: var(--norte);
}

.meta-plain {
  text-decoration: none;
  color: var(--ink-2);
}

a.meta-plain:hover {
  color: var(--norte);
}

.meta-priority {
  color: var(--norte);
  font-size: 13px;
}

.meta-blocker {
  grid-column: 2;
}

.aside-block {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 20px;
}

.aside-label {
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
  color: var(--muted);
}

.bucket-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.aside-hint {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.sibling {
  font-size: 14px;
  line-height: 22px;
  text-decoration: none;
  color: var(--ink-2);
}

.sibling:hover {
  color: var(--norte);
}

.task-write-error {
  margin: var(--space-4) 0 0;
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}

.task-missing {
  display: grid;
  gap: 16px;
  padding: 72px 0;
}

.missing-link {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}

@media (max-width: 1240px) {
  .aside {
    position: static;
    padding-top: 0;
  }

  .task-page {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
