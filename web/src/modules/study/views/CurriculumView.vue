<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import MaterialRow from '@/components/ds/MaterialRow.vue'
import ModuleItem from '@/components/ds/ModuleItem.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import ProgressBar from '@/components/ds/ProgressBar.vue'
import Stat from '@/components/ds/Stat.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { useCurriculum } from '../data/composables'
import CurriculumEditor from './CurriculumView/CurriculumEditor.vue'
import InstrumentTable from './CurriculumView/InstrumentTable.vue'
import ModuleRuler from './CurriculumView/ModuleRuler.vue'
import { buildCurriculumView, NEW_CURRICULUM_SLUG } from './CurriculumView/curriculum'
import type { CurriculumDraft } from './CurriculumView/curriculum'

const route = useRoute()
const router = useRouter()
const { study } = useSources()

const slug = computed(() => String(route.params.slug ?? ''))
const isNew = computed(() => slug.value === NEW_CURRICULUM_SLUG)

// The empty form has no slug to read, so nothing is asked for it.
const { data: detail, loading, error, refresh, apply } = useCurriculum(slug, () => !isNew.value)
const writing = useAsyncAction()

const firstLoad = computed(() => !isNew.value && loading.value && detail.value === null)
const curriculum = computed(() => detail.value?.curriculum)
const view = computed(() =>
  detail.value ? buildCurriculumView(detail.value.curriculum, detail.value.materials) : undefined
)

const shortTitle = computed(() => curriculum.value?.title.split(/[,:]/)[0] ?? 'New curriculum')

// The next required material may be a kind with no reading screen, and then only its source exists.
const continueTarget = computed(() => {
  const next = view.value?.next
  if (!next) return undefined
  return { title: next.title, href: next.href, external: !next.href.startsWith('/') }
})

const editing = ref(isNew.value)
// Modules the reader opened; the module in progress starts open, as the prototype does.
const openModules = reactive(new Set<string>())

watch(
  view,
  (current) => {
    if (!current) return
    const started = current.modules.find((module) => module.status === 'current') ?? current.modules[0]
    if (started && openModules.size === 0) openModules.add(started.id)
  },
  { immediate: true }
)

watch(isNew, (value) => {
  editing.value = value
})

function toggleModule(id: string, open: boolean): void {
  if (open) openModules.add(id)
  else openModules.delete(id)
}

function revealModule(id: string): void {
  openModules.add(id)
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

/**
 * Saving awaits the source and then shows the curriculum it answered with. A
 * module rename is a write of its own, so the last answer is the one the screen
 * keeps; a failure leaves the editor open with the reason.
 */
async function save(draft: CurriculumDraft): Promise<void> {
  if (isNew.value) {
    const created = await writing.run(() => study.addCurriculum({ title: draft.title, goal: draft.goal }))
    if (!created) return
    editing.value = false
    void router.replace(`/curricula/${created.slug}`)
    return
  }

  const current = curriculum.value
  if (!current) return

  const updated = await writing.run(async () => {
    let latest = await study.updateCurriculum(current.slug, {
      title: draft.title,
      goal: draft.goal,
      status: current.status
    })
    for (const module of draft.modules) {
      latest = await study.updateCurriculumModule(current.slug, module.id, { title: module.title })
    }
    return latest
  })
  if (!updated) return

  apply(updated)
  editing.value = false
}

function cancel(): void {
  if (isNew.value) {
    void router.push('/study')
    return
  }
  editing.value = false
}
</script>

<template>
  <main class="curriculum">
    <div v-if="firstLoad" class="curriculum-inner curriculum-missing" role="status">
      <p>Loading the curriculum…</p>
    </div>

    <div v-else-if="error" class="curriculum-inner curriculum-missing" role="alert">
      <p>The curriculum could not be loaded: {{ error }}</p>
      <Button variant="secondary" @click="refresh()">Try again</Button>
    </div>

    <div v-else-if="!curriculum && !isNew" class="curriculum-inner curriculum-missing">
      <PageTitle
        title="Curriculum not found"
        objective="No curriculum answers at this address. It may have been renamed."
      />
      <RouterLink class="curriculum-back" to="/study">View all curricula</RouterLink>
    </div>

    <div v-else class="curriculum-inner">
      <div class="curriculum-top">
        <nav class="curriculum-crumbs" aria-label="Breadcrumb">
          <RouterLink class="curriculum-crumb" to="/study">Curricula</RouterLink>
          <span class="curriculum-sep" aria-hidden="true">/</span>
          <span class="curriculum-here">{{ shortTitle }}</span>
        </nav>
        <div class="curriculum-actions">
          <Button
            v-if="curriculum"
            variant="secondary"
            :aria-pressed="editing"
            @click="editing = !editing"
          >
            {{ editing ? 'Close editor' : 'Edit curriculum' }}
          </Button>
          <RouterLink v-if="!isNew" class="curriculum-new" to="/curricula/new">New curriculum</RouterLink>
          <component
            :is="continueTarget?.external ? 'a' : 'RouterLink'"
            v-if="continueTarget"
            class="curriculum-continue"
            v-bind="continueTarget.external ? { href: continueTarget.href } : { to: continueTarget.href }"
          >
            <Icon name="play" />
            Continue: {{ continueTarget.title }}
          </component>
        </div>
      </div>

      <div class="curriculum-head">
        <div>
          <CurriculumEditor
            v-if="editing"
            :key="`${slug}-${editing}`"
            :mode="isNew ? 'new' : 'edit'"
            :title="curriculum?.title ?? ''"
            :goal="curriculum?.goal ?? ''"
            :modules="curriculum?.modules.map((module) => ({ id: module.id, title: module.title })) ?? []"
            @save="save"
            @cancel="cancel"
          />
          <PageTitle v-else-if="curriculum" :title="curriculum.title" :objective="curriculum.goal" />

          <p v-if="writing.error.value" class="curriculum-write-error" role="alert">
            Could not save: {{ writing.error.value }}
          </p>

          <template v-if="view">
            <p class="curriculum-summary">{{ view.summaryLine }}</p>
            <div class="curriculum-progress">
              <ProgressBar
                :value="view.requiredDone"
                :max="Math.max(view.requiredTotal, 1)"
                label="Required completed"
                :value-text="`${view.requiredDone}/${view.requiredTotal}`"
              />
            </div>
          </template>
        </div>
        <div class="curriculum-cover">
          <Icon name="image" :size="20" />
          <span>Cover photo</span>
        </div>
      </div>

      <template v-if="view && curriculum">
        <section class="curriculum-band" aria-label="The size of the curriculum">
          <Stat :value="view.modules.length" label="Modules" />
          <Stat :value="view.materialCount" label="Materials" />
          <Stat :value="view.exerciseCount" label="Exercises" />
        </section>

        <section class="curriculum-section" aria-labelledby="h-track">
          <h2 id="h-track" class="curriculum-h2">Track</h2>
          <p class="curriculum-lead">{{ view.modules.map((module) => module.title).join(', ') }}.</p>
          <ModuleRuler :modules="view.modules" @open="revealModule" />
        </section>

        <section class="curriculum-section" aria-labelledby="h-modules">
          <div class="curriculum-section-head">
            <h2 id="h-modules" class="curriculum-h2">Modules</h2>
            <span class="curriculum-note">
              The numbering is the consumption order. Skipped an optional? Move on to the next item.
            </span>
          </div>

          <ModuleItem
            v-for="module in view.modules"
            :id="module.id"
            :key="module.id"
            :label="module.label"
            :title="module.title"
            :meta="module.meta"
            :status="module.status"
            :status-text="module.statusText"
            :open="openModules.has(module.id)"
            @toggle="(open) => toggleModule(module.id, open)"
          >
            <p v-if="module.summary" class="curriculum-intro">{{ module.summary }}</p>

            <template v-if="module.materials.length > 0">
              <h3 class="curriculum-h3">Materials</h3>
              <div class="curriculum-materials">
                <MaterialRow
                  v-for="material in module.materials"
                  :key="material.id"
                  :n="material.n"
                  :title="material.title"
                  :by="material.by"
                  :type="material.type"
                  :optional="material.optional"
                  :status="material.status"
                  :href="material.href"
                  :url="material.url"
                />
              </div>
            </template>

            <InstrumentTable v-if="module.instrument" :instrument="module.instrument" />

            <template v-if="module.exercises.length > 0">
              <h3 class="curriculum-h3">Exercises</h3>
              <ul class="curriculum-exercises">
                <li v-for="exercise in module.exercises" :key="exercise.n">
                  <span class="curriculum-exercise-n">{{ exercise.n }}</span>
                  <span>
                    <strong class="curriculum-exercise-title">{{ exercise.title }}</strong>
                    {{ exercise.prompt }}
                  </span>
                </li>
              </ul>
            </template>

            <template v-if="module.evaluation">
              <h3 class="curriculum-h3">Evaluation</h3>
              <p class="curriculum-intro">{{ module.evaluation }}</p>
            </template>
          </ModuleItem>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.curriculum-inner {
  max-width: 1120px;
  margin: 0 auto;
}

.curriculum-write-error {
  margin: var(--space-3) 0 0;
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}

.curriculum-missing {
  padding-top: var(--space-16);
}

.curriculum-back {
  display: inline-block;
  margin-top: var(--space-6);
  color: var(--link);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}

.curriculum-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.curriculum-crumbs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.curriculum-crumb {
  border-radius: var(--radius-xs);
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
}

.curriculum-crumb:hover {
  color: var(--ink);
}

.curriculum-sep {
  color: var(--line-strong);
}

.curriculum-here {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}

.curriculum-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.curriculum-new {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
}

.curriculum-new:hover {
  background: var(--sunken);
  color: var(--ink);
}

.curriculum-continue {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--norte);
  color: var(--on-norte);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
}

.curriculum-continue:hover {
  background: var(--norte-hover);
  color: var(--on-norte);
}

.curriculum-new:focus-visible,
.curriculum-continue:focus-visible,
.curriculum-crumb:focus-visible,
.curriculum-back:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.curriculum-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
  gap: var(--space-11);
  padding-top: var(--space-16);
}

.curriculum-summary {
  margin: var(--space-6) 0 0;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}

.curriculum-progress {
  max-width: 420px;
  margin-top: var(--space-6);
}

.curriculum-cover {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 216px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--sunken);
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.curriculum-band {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-9);
  max-width: 720px;
  margin-top: 56px;
  padding: var(--space-9) 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.curriculum-section {
  margin-top: var(--space-16);
}

.curriculum-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: 20px;
}

.curriculum-h2 {
  margin: 0 0 var(--space-2);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.curriculum-section-head .curriculum-h2 {
  margin-bottom: 0;
}

.curriculum-note {
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.curriculum-lead {
  max-width: 65ch;
  margin: 0 0 28px;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 24px;
}

.curriculum-intro {
  max-width: 65ch;
  margin: 0;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 26px;
}

.curriculum-h3 {
  margin: var(--space-9) 0 var(--space-3);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 650;
  line-height: 20px;
}

.curriculum-materials {
  border-top: 1px solid var(--line);
}

.curriculum-exercises {
  display: grid;
  gap: var(--space-3);
  max-width: 65ch;
  margin: 0;
  padding: 0;
  list-style: none;
}

.curriculum-exercises li {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: var(--space-2);
  color: var(--ink-2);
  font-size: 15px;
  line-height: 24px;
}

.curriculum-exercise-n {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.curriculum-exercise-title {
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 600;
}

.curriculum-exercise-title::after {
  content: ' ·';
  color: var(--muted);
}

@media (max-width: 1100px) {
  .curriculum-head {
    grid-template-columns: minmax(0, 1fr);
  }

  .curriculum-cover {
    max-width: 360px;
  }
}

@media (max-width: 600px) {
  .curriculum-band {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
