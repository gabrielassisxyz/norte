<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { nowTimestamp } from '@/lib/clock'
import type { Bucket, Priority, ProjectStatus, Task } from '@/mock/types'
import { useSources } from '@/sources'

import { useProject } from '../data/composables'
import SessionDialog from './ProjectView/SessionDialog.vue'
import TaskDialog, { type NewProjectTask } from './ProjectView/TaskDialog.vue'

const props = withDefaults(defineProps<{ id: string; tasksExpanded?: boolean }>(), {
  tasksExpanded: false
})

type TaskFilter = 'open' | 'p1' | 'all'
type Dialog = 'sess' | 'task' | null

const filter = ref<TaskFilter>('open')
const dialog = ref<Dialog>(null)
const openTaskIds = ref<string[]>([])
const sessionNote = ref('')
const sessionNext = ref('')

const { projects: projectsSource } = useSources()
const { data: detail, loading, error, refresh, applyTask, countSession } = useProject(() => props.id)
const writing = useAsyncAction()

const firstLoad = computed(() => loading.value && detail.value === null)
const project = computed(() => detail.value?.project)
const area = computed(() => detail.value?.area)
const projectTasks = computed(() => detail.value?.tasks ?? [])
const projectDecisions = computed(() => detail.value?.decisions ?? [])
const projectBugs = computed(() => project.value?.bugs ?? [])
const sessionCount = computed(() => detail.value?.sessionCount ?? 0)

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  planning: 'Planning',
  paused: 'Paused',
  completed: 'Completed'
}

// The mock Task has no topical domain field, so the "Domain" pick in the New
// task dialog maps onto the task horizon (bucket) and rows display it back.
const BUCKET_LABELS: Record<Bucket, string> = {
  today: 'Today',
  next: 'Up next',
  later: 'Later',
  someday: 'Someday'
}

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
const PRIORITY_TONE: Record<string, string> = {
  P0: 'var(--danger)',
  P1: 'var(--norte)',
  P2: 'var(--ink-2)',
  P3: 'var(--muted)'
}

// The mock bug has no severity field; derive a stable display severity from
// the project priority so every project still groups its bugs by severity.
const bugSeverity = computed(() => {
  const priority = project.value?.priority
  if (priority === 'P0' || priority === 'P1') return 'critical'
  if (priority === 'P2') return 'medium'
  return 'minor'
})

const bugSeverityColor = computed(() => {
  if (bugSeverity.value === 'critical') return 'var(--danger)'
  if (bugSeverity.value === 'medium') return 'var(--ink-2)'
  return 'var(--muted)'
})

const features = computed(
  () =>
    project.value?.features.map((feature) => ({
      ...feature,
      state: feature.complete ? 'Working' : 'Partial'
    })) ?? []
)

const openTasks = computed(() => projectTasks.value.filter((task) => !task.completed))
const p1Tasks = computed(() => openTasks.value.filter((task) => task.priority === 'P1'))
const pendingDecisions = computed(() =>
  projectDecisions.value.filter((decision) => decision.status !== 'decided')
)
const openBugs = computed(() => projectBugs.value.filter((bug) => !bug.resolved))

const priorities = computed(() =>
  [...openTasks.value]
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .slice(0, 5)
)

const openGroups = computed(() => [
  {
    key: 'tasks',
    name: 'Tasks',
    count: openTasks.value.length,
    items: openTasks.value.map((task) => ({
      key: task.id,
      kind: 'task',
      title: task.title,
      to: { name: 'task', params: { id: task.id } }
    }))
  },
  {
    key: 'decisions',
    name: 'Decisions',
    count: pendingDecisions.value.length,
    items: pendingDecisions.value.map((decision) => ({
      key: decision.id,
      kind: 'decision',
      title: decision.title,
      to: { name: 'decision', params: { id: decision.id } }
    }))
  },
  {
    key: 'bugs',
    name: 'Bugs',
    count: openBugs.value.length,
    items: openBugs.value.map((bug) => ({ key: bug.id, kind: 'bug', title: bug.title, to: null }))
  }
])

const openCount = computed(
  () => openTasks.value.length + pendingDecisions.value.length + openBugs.value.length
)

const visibleTasks = computed<Task[]>(() => {
  if (filter.value === 'p1') return p1Tasks.value
  if (filter.value === 'all') return projectTasks.value
  return openTasks.value
})

const taskFilterOptions = computed(() => [
  { value: 'open', label: 'Open', count: openTasks.value.length },
  { value: 'p1', label: 'P1', count: p1Tasks.value.length },
  { value: 'all', label: 'All', count: projectTasks.value.length }
])

const nextStep = computed(() => sessionNext.value || priorities.value[0]?.title || 'Nothing open')

function isTaskOpen(id: string): boolean {
  return props.tasksExpanded || openTaskIds.value.includes(id)
}

function toggleTask(id: string): void {
  openTaskIds.value = openTaskIds.value.includes(id)
    ? openTaskIds.value.filter((candidate) => candidate !== id)
    : [...openTaskIds.value, id]
}

function blockedTitles(ids: string[]): string {
  if (ids.length === 0) return '—'
  return ids
    .map((id) => projectTasks.value.find((task) => task.id === id)?.title ?? id)
    .join(' · ')
}

function stepsProgress(task: Task): string {
  if (task.steps.length === 0) return 'no steps'
  const done = task.steps.filter((step) => step.completed).length
  return `${done}/${task.steps.length} steps`
}

async function saveSession(payload: { did: string; stuck: string; next: string }): Promise<void> {
  const current = project.value
  if (!current) return
  const note = `${payload.did}${payload.stuck ? ` Stuck: ${payload.stuck}.` : ''}`
  const summary = `${note} Next: ${payload.next}`
  // No duration input in the design; a new session records one focused block.
  const saved = await writing.run(() =>
    projectsSource.addSession({
      projectId: current.id,
      startedAt: nowTimestamp(),
      durationMinutes: 25,
      summary
    })
  )
  // A failed save keeps the dialog open with everything typed into it.
  if (!saved) return

  countSession()
  sessionNote.value = note
  sessionNext.value = payload.next
  dialog.value = null
}

async function saveTask(payload: NewProjectTask): Promise<void> {
  const current = project.value
  if (!current) return
  const description =
    `${payload.why}${payload.what ? ` What to do: ${payload.what}.` : ''}` +
    ` Done when: ${payload.done}.`
  const created = await writing.run(() =>
    projectsSource.addTask({
      projectId: current.id,
      title: payload.title,
      description,
      priority: payload.priority,
      bucket: payload.bucket
    })
  )
  if (!created) return

  applyTask(created)
  openTaskIds.value = [...openTaskIds.value, created.id]
  if (filter.value !== 'open') filter.value = 'open'
  dialog.value = null
}
</script>

<template>
  <main v-if="firstLoad" class="project project-missing" role="status">
    <p>Loading the project…</p>
  </main>

  <main v-else-if="error" class="project project-missing" role="alert">
    <p>The project could not be loaded: {{ error }}</p>
    <Button variant="secondary" @click="refresh()">Try again</Button>
  </main>

  <main v-else-if="project" class="project">
    <div class="project-top">
      <nav class="crumb" aria-label="Breadcrumb">
        <RouterLink :to="{ name: 'projects' }">Projects</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="area" :to="{ name: 'area', params: { id: area.id } }">{{
          area.title
        }}</RouterLink>
        <span aria-hidden="true">/</span>
        <span class="crumb-current">{{ project.title }}</span>
      </nav>
      <div class="project-actions">
        <Button variant="secondary" @click="dialog = 'sess'">Log session</Button>
        <Button variant="primary" @click="dialog = 'task'">New task</Button>
      </div>
    </div>

    <p v-if="writing.error.value" class="project-write-error" role="alert">
      Could not save: {{ writing.error.value }}
    </p>

    <div class="project-page">
      <div class="project-main">
        <div class="project-hero">
          <PageTitle :title="project.title" :objective="project.purpose" />
        </div>

        <div class="project-strip">
          <span class="project-status">
            <span class="project-dot" aria-hidden="true" />
            {{ STATUS_LABELS[project.status] }}
          </span>
          <span class="mono project-strip-meta">
            {{ projectTasks.length }} tasks · {{ projectDecisions.length }} decisions ·
            {{ projectBugs.length }} bugs · {{ sessionCount }} sessions
          </span>
          <span class="project-next">
            Next step: <a href="#tasks">{{ nextStep }}</a>
          </span>
        </div>

        <div v-if="sessionNote" class="project-now">
          <span class="mono project-now-label">now</span>
          <span class="project-now-text">{{ sessionNote }}</span>
        </div>

        <section id="why" aria-labelledby="h-why" class="project-section">
          <h2 id="h-why" class="sec-title">Why</h2>
          <p class="body">{{ project.purpose }}</p>
        </section>

        <section id="state" aria-labelledby="h-state" class="project-section">
          <div class="sec-head">
            <h2 id="h-state" class="sec-title">Current state</h2>
            <span class="sec-hint">What can be used today</span>
          </div>
          <div class="sec-lines">
            <div v-for="feature in features" :key="feature.id" class="feature-row">
              <div class="sub">{{ feature.title }}</div>
              <span class="feature-state">
                <span
                  class="feature-dot"
                  :class="{ 'is-done': feature.complete }"
                  aria-hidden="true"
                />
                {{ feature.state }}
              </span>
            </div>
            <p v-if="features.length === 0" class="empty">No features recorded.</p>
          </div>
        </section>

        <section id="open" aria-labelledby="h-open" class="project-section">
          <div class="sec-head">
            <h2 id="h-open" class="sec-title">Open</h2>
            <span class="sec-hint">By item type</span>
          </div>
          <div class="open-grid">
            <div v-for="group in openGroups" :key="group.key" class="open-group">
              <div class="open-group-head">
                <h3 class="sub">{{ group.name }}</h3>
                <span class="mono open-count">{{ group.count }}</span>
              </div>
              <RouterLink
                v-for="item in group.items"
                :key="item.key"
                :to="item.to ?? '#bugs'"
                class="open-item"
              >
                <span class="mono open-kind">{{ item.kind }}</span>
                <span>{{ item.title }}</span>
              </RouterLink>
              <p v-if="group.items.length === 0" class="empty">Nothing here.</p>
            </div>
          </div>
        </section>

        <section id="decisions" aria-labelledby="h-decisions" class="project-section">
          <div class="sec-head">
            <h2 id="h-decisions" class="sec-title">Decisions</h2>
            <span class="sec-hint">While undecided, this blocks what is on the right</span>
          </div>
          <div class="sec-lines">
            <div v-for="decision in projectDecisions" :key="decision.id" class="decision-row">
              <div class="decision-main">
                <RouterLink
                  :to="{ name: 'decision', params: { id: decision.id } }"
                  class="sub decision-title"
                >
                  {{ decision.title }}
                </RouterLink>
                <p class="body-sm">{{ decision.context }}</p>
                <div class="decision-options">
                  <span
                    v-for="option in decision.options"
                    :key="option.id"
                    class="decision-option"
                    :class="{ 'is-selected': decision.selectedOptionId === option.id }"
                  >
                    {{ option.title }}
                  </span>
                </div>
              </div>
              <div class="decision-side">
                <div class="decision-fact">
                  <span class="mono decision-key">state</span>
                  <span>{{
                    decision.status === 'decided'
                      ? 'Decided'
                      : decision.status === 'postponed'
                        ? 'Postponed'
                        : 'Open'
                  }}</span>
                </div>
                <div class="decision-fact">
                  <span class="mono decision-key">blocks</span>
                  <span>{{ blockedTitles(decision.blockedTaskIds) }}</span>
                </div>
                <div v-if="decision.postponedUntil" class="decision-fact">
                  <span class="mono decision-key">until</span>
                  <span class="mono">{{ decision.postponedUntil }}</span>
                </div>
              </div>
            </div>
            <p v-if="projectDecisions.length === 0" class="empty">No decisions recorded.</p>
          </div>
        </section>

        <div class="project-two">
          <section id="priorities" aria-labelledby="h-prio">
            <div class="sec-head">
              <h2 id="h-prio" class="sec-title">Priorities</h2>
              <span class="sec-hint">In this order</span>
            </div>
            <div class="sec-lines">
              <RouterLink
                v-for="(task, index) in priorities"
                :key="task.id"
                :to="{ name: 'task', params: { id: task.id } }"
                class="priority-row"
              >
                <span class="mono priority-num">{{ index + 1 }}</span>
                <span class="priority-main">
                  <span class="priority-title">{{ task.title }}</span>
                  <span class="priority-reason">{{ task.description }}</span>
                </span>
              </RouterLink>
              <p v-if="priorities.length === 0" class="empty">Nothing open.</p>
            </div>
          </section>

          <section id="bugs" aria-labelledby="h-bugs">
            <div class="sec-head">
              <h2 id="h-bugs" class="sec-title">Bugs</h2>
              <span class="mono sec-hint">{{ openBugs.length }} open</span>
            </div>
            <div class="sec-lines">
              <div v-for="bug in projectBugs" :key="bug.id" class="bug-row">
                <div class="bug-line">
                  <span class="mono bug-sev" :style="{ color: bugSeverityColor }">{{
                    bugSeverity
                  }}</span>
                  <span class="bug-title">{{ bug.title }}</span>
                </div>
                <div class="bug-meta">{{ bug.resolved ? 'Resolved' : 'Open' }}</div>
              </div>
              <p v-if="projectBugs.length === 0" class="empty">No bugs recorded.</p>
            </div>
          </section>
        </div>

        <section id="tasks" aria-labelledby="h-tasks" class="project-section">
          <div class="sec-head">
            <h2 id="h-tasks" class="sec-title">Tasks</h2>
            <span class="sec-hint">Each one explains itself</span>
            <span class="tasks-filter">
              <SegmentedControl
                :options="taskFilterOptions"
                :model-value="filter"
                @change="filter = $event as TaskFilter"
              />
            </span>
          </div>
          <div class="sec-lines">
            <div v-for="task in visibleTasks" :key="task.id" class="task-wrap">
              <button
                type="button"
                class="task"
                :aria-expanded="isTaskOpen(task.id)"
                @click="toggleTask(task.id)"
              >
                <span class="task-grid">
                  <span
                    class="task-check"
                    :class="{ 'is-done': task.completed }"
                    aria-hidden="true"
                  />
                  <span class="task-main">
                    <span class="task-title">
                      {{ task.title }}
                      <RouterLink
                        :to="{ name: 'task', params: { id: task.id } }"
                        class="task-open"
                        @click.stop=""
                      >
                        Open
                      </RouterLink>
                    </span>
                    <span class="task-desc">{{ task.description }}</span>
                  </span>
                  <span class="task-meta">
                    <span class="mono" :style="{ color: PRIORITY_TONE[task.priority] ?? 'var(--muted)' }">
                      {{ task.priority }}
                    </span>
                    <span>{{ BUCKET_LABELS[task.bucket] }}</span>
                    <span class="mono">{{ stepsProgress(task) }}</span>
                    <svg
                      class="task-chev"
                      :class="{ 'is-open': isTaskOpen(task.id) }"
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </span>
                </span>
                <span v-if="isTaskOpen(task.id)" class="task-body">
                  <span class="mono task-key">description</span>
                  <span class="task-text">{{ task.description }}</span>
                  <span class="mono task-key">steps</span>
                  <span class="task-steps">
                    <span v-for="step in task.steps" :key="step.id" class="task-step">
                      <span class="task-step-box" :class="{ 'is-done': step.completed }" aria-hidden="true">
                        <svg
                          v-if="step.completed"
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M1.5 5.5l2.5 2.5 4.5-5" />
                        </svg>
                      </span>
                      {{ step.title }}
                    </span>
                    <span v-if="task.steps.length === 0" class="task-step">No steps recorded.</span>
                  </span>
                </span>
              </button>
            </div>
            <p v-if="visibleTasks.length === 0" class="empty">No tasks here.</p>
          </div>
        </section>
      </div>

      <nav class="toc" aria-label="On this page">
        <div class="toc-title">On this page</div>
        <a href="#why">Why</a>
        <a href="#state">Current state <span class="mono">{{ features.length }}</span></a>
        <a href="#open">Open <span class="mono">{{ openCount }}</span></a>
        <a href="#decisions">Decisions <span class="mono">{{ projectDecisions.length }}</span></a>
        <a href="#priorities">Priorities <span class="mono">{{ priorities.length }}</span></a>
        <a href="#bugs">Bugs <span class="mono">{{ openBugs.length }}</span></a>
        <a href="#tasks">Tasks <span class="mono">{{ openTasks.length }}</span></a>
      </nav>
    </div>

    <SessionDialog v-if="dialog === 'sess'" @close="dialog = null" @save="saveSession" />
    <TaskDialog v-if="dialog === 'task'" @close="dialog = null" @save="saveTask" />
  </main>

  <main v-else class="project project-missing">
    <PageTitle title="Project not found" objective="This project does not exist." />
    <RouterLink :to="{ name: 'projects' }" class="missing-link">Back to Projects</RouterLink>
  </main>
</template>

<style scoped>
.project {
  max-width: 1120px;
  margin: 0 auto;
}

.project-top {
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

.project-actions {
  display: flex;
  gap: 12px;
}

.project-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 64px;
  align-items: start;
}

.project-main {
  min-width: 0;
}

.project-hero {
  padding-top: 72px;
}

.project-strip {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 24px;
  padding: 20px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.project-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
  color: var(--norte);
}

.project-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--norte);
}

.project-strip-meta {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.project-next {
  margin-left: auto;
  font-size: 14px;
  line-height: 20px;
  color: var(--ink-2);
}

.project-now {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 24px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  align-items: baseline;
}

.project-now-label {
  font-size: 13px;
  color: var(--muted);
}

.project-now-text {
  font-size: 14px;
  line-height: 22px;
  color: var(--ink);
}

.project-section {
  margin-top: 64px;
}

.sec-title {
  margin: 0;
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
  color: var(--ink);
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
  max-width: 60ch;
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

.feature-row {
  display: grid;
  grid-template-columns: 220px 120px minmax(0, 1fr);
  gap: 24px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
  align-items: start;
}

.feature-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 20px;
  font-weight: 550;
  color: var(--ink-2);
}

.feature-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--ink-2);
}

.feature-dot.is-done {
  background: var(--success);
}

.open-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px 40px;
}

.open-group {
  display: grid;
  gap: 4px;
  align-content: start;
}

.open-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}

.open-count {
  font-size: 12px;
  color: var(--muted);
}

.open-item {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
  padding: 7px 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line);
}

.open-item:hover {
  color: var(--norte);
}

.open-kind {
  font-size: 12px;
  line-height: 20px;
  color: var(--muted);
}

.decision-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 24px;
  padding: 20px 12px;
  border-bottom: 1px solid var(--line);
  align-items: start;
}

.decision-main {
  display: grid;
  gap: 10px;
}

.decision-title {
  text-decoration: none;
}

.decision-title:hover {
  color: var(--norte);
}

.decision-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 2px;
}

.decision-option {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
}

.decision-option.is-selected {
  border-color: var(--norte);
  background: var(--norte-soft);
  color: var(--norte);
}

.decision-side {
  display: grid;
  gap: 6px;
  font-size: 13px;
  line-height: 20px;
}

.decision-fact {
  display: flex;
  gap: 8px;
}

.decision-key {
  color: var(--muted);
  width: 64px;
  flex: none;
}

.project-two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 48px;
  margin-top: 64px;
}

.priority-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  text-decoration: none;
  color: var(--ink);
  align-items: baseline;
}

.priority-row:hover .priority-title {
  color: var(--norte);
}

.priority-num {
  font-size: 13px;
  color: var(--muted);
}

.priority-main {
  display: grid;
  gap: 2px;
}

.priority-title {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.priority-reason {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.bug-row {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
}

.bug-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.bug-sev {
  font-size: 12px;
  line-height: 20px;
  flex: none;
}

.bug-title {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.bug-meta {
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
  padding-left: 58px;
}

.tasks-filter {
  margin-left: auto;
}

.task-wrap {
  border-bottom: 1px solid var(--line);
}

.task {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.task:hover .task-title {
  color: var(--norte);
}

.task-grid {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 260px;
  gap: 16px;
  padding: 16px 12px;
  align-items: start;
}

.task-check {
  margin-top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
}

.task-check.is-done {
  background: var(--norte);
  border-color: var(--norte);
}

.task-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.task-title {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.task-open {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  margin-left: 8px;
  text-decoration: none;
}

.task-desc {
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
  text-wrap: pretty;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-meta {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  align-items: baseline;
  font-size: 13px;
  line-height: 22px;
  color: var(--muted);
  white-space: nowrap;
}

.task-chev {
  align-self: center;
  transition: transform 120ms cubic-bezier(0.2, 0, 0, 1);
}

.task-chev.is-open {
  transform: rotate(180deg);
}

.task-body {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 12px 24px;
  padding: 4px 12px 24px 48px;
  max-width: 78ch;
}

.task-key {
  font-size: 12px;
  line-height: 24px;
  color: var(--muted);
}

.task-text {
  font-size: 15px;
  line-height: 24px;
  color: var(--ink);
}

.task-steps {
  display: grid;
  gap: 6px;
}

.task-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
}

.task-step-box {
  width: 16px;
  height: 16px;
  flex: none;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--line-strong);
  color: var(--on-norte);
}

.task-step-box.is-done {
  background: var(--success);
  border-color: var(--success);
}

.toc {
  position: sticky;
  top: 92px;
  padding-top: 72px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toc-title {
  padding: 0 10px 8px;
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
  color: var(--muted);
}

.toc a {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 18px;
  font-weight: 550;
  color: var(--muted);
  text-decoration: none;
}

.toc a:hover {
  background: var(--surface);
  color: var(--ink);
}

.project-write-error {
  margin: var(--space-4) 0 0;
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}

.project-missing {
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
  .toc {
    display: none;
  }

  .project-page {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1180px) {
  .open-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .project-two {
    grid-template-columns: minmax(0, 1fr);
  }

  .open-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .decision-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .feature-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-grid {
    grid-template-columns: 20px minmax(0, 1fr);
  }

  .task-meta {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
