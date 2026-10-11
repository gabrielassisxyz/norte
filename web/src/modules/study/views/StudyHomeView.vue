<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import Carousel from '@/components/ds/Carousel.vue'
import CoverCard from '@/components/ds/CoverCard.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import Stat from '@/components/ds/Stat.vue'
import StreakGrid from '@/components/ds/StreakGrid.vue'
import { formatLongWeekdayDate, formatMonthName, todayIsoDate } from '@/lib/clock'
import type { StudyDay } from '@/mock/types'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useReviewSummary } from '@/modules/review/data/composables'
import { useSubjects } from '@/shell/data/composables'
import type { Subject } from '@/shell/data/source'
import NewSubjectButton from '@/shell/NewSubjectButton.vue'
import { requestPaletteSearch } from '@/shell/paletteRequest'
import { useStudyHome } from '../data/composables'
import { completedThisMonth, currentStreak, hoursInWindow, levelForMinutes, recordStreak } from './studyDays'

/** A way into another product is offered only while that product is mounted. */
const canReachLibrary = computed(() => crossModuleActionAllowed('study', 'library'))
const canReachNotes = computed(() => crossModuleActionAllowed('study', 'notes'))
const canReachReview = computed(() => crossModuleActionAllowed('study', 'review'))

const { data: home, loading, error, refresh } = useStudyHome()
const { data: reviewCounts } = useReviewSummary(canReachReview)
/**
 * The subjects are the core's, not this module's.
 *
 * They are read straight from the core rather than from the study mock, and
 * they are not behind `crossModuleActionAllowed`: the core is always on, so
 * there is no crossing to gate and no mock id that could be joined to a real
 * one.
 */
const { data: subjectPage, hasMore: hasMoreSubjects, loadingMore: loadingMoreSubjects, loadMore: loadMoreSubjects } =
  useSubjects()

const firstLoad = computed(() => loading.value && home.value === null)
const curricula = computed(() => home.value?.items ?? [])
const subjects = computed<Subject[]>(() => subjectPage.value?.items ?? [])
const studyDays = computed<StudyDay[]>(() => home.value?.studyDays ?? [])
const focus = computed(() => home.value?.focus ?? '')

type SubjectsView = 'covers' | 'table'

const SUBJECT_VIEWS: SubjectsView[] = ['covers', 'table']
const VIEW_OPTIONS = [
  { value: 'covers', label: 'Covers' },
  { value: 'table', label: 'Table' }
]

function isSubjectsView(value: unknown): value is SubjectsView {
  return typeof value === 'string' && SUBJECT_VIEWS.includes(value as SubjectsView)
}

function formatHours(value: number): string {
  return value.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatSignedHours(value: number): string {
  const sign = value < 0 ? '−' : '+'
  return `${sign}${formatHours(Math.abs(value))} h vs. previous week`
}

const title = computed(() => formatLongWeekdayDate(todayIsoDate()))
const addOpen = ref(false)
const subjectsView = ref<SubjectsView>('covers')

const levels = computed(() => studyDays.value.map((day) => levelForMinutes(day.minutes)))
const streak = computed(() => currentStreak(studyDays.value))
const record = computed(() => recordStreak(studyDays.value))
const weekHours = computed(() => hoursInWindow(studyDays.value))
const previousWeekHours = computed(() => hoursInWindow(studyDays.value.slice(0, studyDays.value.length - 7)))
const weekDelta = computed(() => weekHours.value - previousWeekHours.value)
const dueCount = computed(() => reviewCounts.value?.due ?? 0)
const monthly = computed(() => completedThisMonth(studyDays.value))
const monthLabel = computed(() => {
  const last = studyDays.value[studyDays.value.length - 1]
  return last === undefined ? '' : formatMonthName(last.date)
})

function subjectTotal(subject: Subject): number {
  return subject.counts.total
}

/**
 * The columns the subjects table shows: one per item type that at least one
 * subject has something of.
 *
 * They are derived rather than fixed because the types belong to whichever
 * modules this binary was built with, which is exactly what the core refuses
 * to enumerate. A fixed set of columns here would print zeros for the modules
 * that have not landed and hide the ones that have.
 */
const subjectTypes = computed<string[]>(() => {
  const types = new Set<string>()
  for (const subject of subjects.value) {
    for (const count of subject.counts.by_type) types.add(count.type)
  }
  return [...types].sort((left, right) => left.localeCompare(right, 'en'))
})

function subjectTypeCount(subject: Subject, type: string): number {
  return subject.counts.by_type.find((count) => count.type === type)?.count ?? 0
}

function toggleAdd(): void {
  addOpen.value = !addOpen.value
}

function closeAdd(): void {
  addOpen.value = false
}

function selectView(value: string): void {
  if (isSubjectsView(value)) subjectsView.value = value
}

const searchQuery = ref('')

/**
 * This box used to be an input bound to nothing at all -- it took what was
 * typed and lost it. It hands the query to the command palette instead, the
 * same way the home screen's does, because the one search Norte has reaches every
 * module and the subjects and lives on the server.
 */
function openPaletteWith(typed: string): void {
  requestPaletteSearch(typed)
  searchQuery.value = ''
}
</script>

<template>
  <main class="study-view">
    <div class="study-inner">
      <div class="study-topbar">
        <label class="study-search-label" for="study-search">Search</label>
        <input
          id="study-search"
          v-model="searchQuery"
          class="study-search"
          type="search"
          placeholder="Search courses, notes, questions…"
          @input="openPaletteWith(($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="openPaletteWith(searchQuery)"
        />
        <div class="study-add">
          <Button variant="secondary" icon="plus" aria-haspopup="menu" :aria-expanded="addOpen" @click="toggleAdd">
            Add
          </Button>
          <div v-if="addOpen" class="study-menu" role="menu" @keydown.escape="closeAdd">
            <RouterLink role="menuitem" to="/curricula/new" @click="closeAdd">New curriculum</RouterLink>
            <RouterLink role="menuitem" :to="{ name: 'home', query: { save: '1' } }" @click="closeAdd">
              Save link to the inbox
            </RouterLink>
            <RouterLink v-if="canReachNotes" role="menuitem" :to="{ name: 'notes', query: { tab: 'questions' } }" @click="closeAdd">
              New question
            </RouterLink>
          </div>
        </div>
        <RouterLink v-if="canReachReview" :to="{ name: 'revisao' }" class="study-review">
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
            <path d="M5.5 3.5v9l7-4.5z" />
          </svg>
          Review {{ dueCount }} cards
        </RouterLink>
      </div>

      <PageTitle class="study-title" :title="title" :objective="focus" />

      <p v-if="firstLoad" class="study-state" role="status">Loading study…</p>

      <div v-else-if="error" class="study-state" role="alert">
        <p>Study could not be loaded: {{ error }}</p>
        <Button variant="secondary" @click="refresh()">Try again</Button>
      </div>

      <template v-else>
      <section aria-label="Streak and statistics" class="study-band">
        <StreakGrid
          :days="levels"
          label="Study days over the last 26 weeks"
          caption="Last 26 weeks · today still open"
        />
        <div class="study-stats">
          <Stat :value="streak" unit="days" label="Current streak" :delta="`record: ${record}`" />
          <Stat
            :value="formatHours(weekHours)"
            unit="h"
            label="Studied this week"
            :delta="formatSignedHours(weekDelta)"
            :delta-tone="weekDelta < 0 ? 'down' : undefined"
          />
          <Stat :value="dueCount" unit="cards" label="To review today" />
          <Stat :value="monthly.total" unit="items" :label="`Completed in ${monthLabel}`" />
        </div>
      </section>

      <section aria-labelledby="study-curricula" class="study-section">
        <div class="study-section-head">
          <h2 id="study-curricula">Curricula</h2>
        </div>
        <p v-if="curricula.length === 0" class="study-state">No curricula yet. Start by creating one.</p>
        <Carousel v-else label="Curricula" :item-width="248" :visible="4" :step="2">
          <CoverCard
            v-for="curriculum in curricula"
            :key="curriculum.slug"
            :title="curriculum.title"
            :description="curriculum.goal"
            :href="`/curricula/${curriculum.slug}`"
          />
        </Carousel>
      </section>

      <section aria-labelledby="study-subjects" class="study-section">
        <div class="study-section-head">
          <div class="study-section-titles">
            <h2 id="study-subjects">Subjects</h2>
            <RouterLink v-if="canReachLibrary" :to="{ name: 'library', query: { v: 'all' } }" class="study-see-all">
              View in the library
            </RouterLink>
            <NewSubjectButton />
          </div>
          <SegmentedControl
            :model-value="subjectsView"
            :options="VIEW_OPTIONS"
            label="Subjects view"
            @change="selectView"
          />
        </div>

        <p v-if="subjects.length === 0" class="study-state">No subjects yet.</p>

        <div v-else-if="subjectsView === 'covers'" class="study-grid">
          <CoverCard
            v-for="subject in subjects"
            :key="subject.id"
            :title="subject.name"
            :meta="`${subjectTotal(subject)} ${subjectTotal(subject) === 1 ? 'item' : 'items'}`"
            :cover-height="200"
            :href="`/subjects/${subject.slug}`"
          />
        </div>

        <div v-else role="table" aria-label="Subjects and what each one gathers" class="study-table">
          <div class="study-row study-head-row" role="row">
            <span class="study-th study-first" role="columnheader">Subject</span>
            <span v-for="type in subjectTypes" :key="type" class="study-th" role="columnheader">{{ type }}</span>
            <span class="study-th" role="columnheader">Items</span>
          </div>
          <div v-for="subject in subjects" :key="subject.id" class="study-row" role="row">
            <div role="cell" class="study-first">
              <RouterLink :to="{ name: 'subject', params: { slug: subject.slug } }" class="study-row-link">
                {{ subject.name }}
              </RouterLink>
            </div>
            <span v-for="type in subjectTypes" :key="type" class="study-num" role="cell">
              {{ subjectTypeCount(subject, type) }}
            </span>
            <span class="study-num" role="cell">{{ subjectTotal(subject) }}</span>
          </div>
        </div>

        <button
          v-if="hasMoreSubjects"
          type="button"
          class="study-more"
          :disabled="loadingMoreSubjects"
          @click="loadMoreSubjects()"
        >
          {{ loadingMoreSubjects ? 'Loading…' : 'Load more subjects' }}
        </button>
      </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.study-view {
  min-width: 0;
}
.study-state {
  margin: 32px 0 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 24px;
}
.study-state p {
  margin: 0 0 var(--space-2);
}
.study-inner {
  max-width: 1120px;
  margin: 0 auto;
}
.study-topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}
.study-search-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.study-search {
  width: 280px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;
}
.study-search::placeholder {
  color: var(--muted);
}
.study-search:focus-visible,
.study-menu a:focus-visible,
.study-row-link:focus-visible,
.study-see-all:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.study-add {
  position: relative;
}
.study-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 20;
  display: grid;
  gap: 1px;
  min-width: 220px;
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}
.study-menu a {
  display: block;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
}
.study-menu a:hover {
  background: var(--sunken);
}
.study-review {
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
.study-review:hover {
  background: var(--norte-hover);
}
.study-title {
  padding-top: var(--space-16);
}
.study-band {
  display: flex;
  align-items: center;
  gap: 56px;
  margin-top: 48px;
  padding: 28px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.study-stats {
  display: grid;
  flex-grow: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px 40px;
}
.study-section {
  margin-top: 72px;
}
.study-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.study-section-head h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}
.study-section-titles {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
}
.study-see-all {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
  text-decoration: none;
}
.study-see-all:hover {
  text-decoration: underline;
}
.study-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 36px 24px;
}
.study-more {
  margin-top: var(--space-6);
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}
.study-more:hover {
  background: var(--sunken);
}
.study-table {
  min-width: 0;
}
.study-row {
  /* The number of type columns comes from the data, so the name takes the
     remaining space and every count column is sized by its content. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(auto-fit, minmax(72px, auto));
  grid-auto-flow: column;
  align-items: center;
  gap: var(--space-4);
  padding: 14px var(--space-3);
  border-bottom: 1px solid var(--line);
}
.study-row:hover {
  background: var(--surface);
}
.study-head-row {
  padding-top: 0;
  padding-bottom: 10px;
}
.study-head-row:hover {
  background: transparent;
}
.study-first {
  min-width: 0;
}
.study-th {
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  line-height: 16px;
  text-align: right;
}
.study-th.study-first {
  text-align: left;
}
.study-num {
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  text-align: right;
}
.study-row-link {
  border-radius: var(--radius-xs);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 24px;
  text-decoration: none;
}
.study-row-link:hover {
  color: var(--norte);
}
@media (max-width: 900px) {
  .study-band {
    flex-direction: column;
    align-items: flex-start;
  }
  .study-topbar {
    flex-wrap: wrap;
  }
  .study-search {
    width: 100%;
  }
  .study-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .study-table {
    overflow-x: auto;
  }
  .study-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .study-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
