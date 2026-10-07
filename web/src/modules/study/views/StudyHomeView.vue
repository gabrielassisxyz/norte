<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import Carousel from '@/components/ds/Carousel.vue'
import CoverCard from '@/components/ds/CoverCard.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import Stat from '@/components/ds/Stat.vue'
import StreakGrid from '@/components/ds/StreakGrid.vue'
import { store } from '@/mock/store'
import { formatLongWeekdayDate, formatMonthName, todayIsoDate } from '@/lib/clock'
import {
  WEEKLY_FOCUS,
  completedThisMonth,
  currentStreak,
  hoursInWindow,
  levelForMinutes,
  recordStreak
} from '@/modules/study/mock/study'
import type { Subject } from '@/mock/types'
import { crossModuleActionAllowed } from '@/modules/mounting'

/** A way into another product is offered only while that product is mounted. */
const canReachLibrary = computed(() => crossModuleActionAllowed('study', 'library'))
const canReachNotes = computed(() => crossModuleActionAllowed('study', 'notes'))
const canReachReview = computed(() => crossModuleActionAllowed('study', 'review'))

type SubjectsView = 'capas' | 'tabela'

const SUBJECT_VIEWS: SubjectsView[] = ['capas', 'tabela']
const VIEW_OPTIONS = [
  { value: 'capas', label: 'Capas' },
  { value: 'tabela', label: 'Tabela' }
]

function isSubjectsView(value: unknown): value is SubjectsView {
  return typeof value === 'string' && SUBJECT_VIEWS.includes(value as SubjectsView)
}

function formatHours(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatSignedHours(value: number): string {
  const sign = value < 0 ? '−' : '+'
  return `${sign}${formatHours(Math.abs(value))} h vs. anterior`
}

const title = computed(() => formatLongWeekdayDate(todayIsoDate()))
const addOpen = ref(false)
const subjectsView = ref<SubjectsView>('capas')

const levels = computed(() => store.studyDays.map((day) => levelForMinutes(day.minutes)))
const streak = computed(() => currentStreak(store.studyDays))
const record = computed(() => recordStreak(store.studyDays))
const weekHours = computed(() => hoursInWindow(store.studyDays))
const previousWeekHours = computed(() => hoursInWindow(store.studyDays.slice(0, store.studyDays.length - 7)))
const weekDelta = computed(() => weekHours.value - previousWeekHours.value)
const dueCount = computed(() => store.reviewCards.filter((card) => card.dueAt <= todayIsoDate()).length)
const monthly = computed(() => completedThisMonth(store.studyDays))
const monthLabel = computed(() => {
  const last = store.studyDays[store.studyDays.length - 1]
  return last === undefined ? '' : formatMonthName(last.date)
})

function subjectTotal(subject: Subject): number {
  return subject.curricula + subject.courses + subject.articles + subject.videos + subject.notes + subject.questions
}

function subjectHref(): string {
  return '/biblioteca?v=tudo'
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
</script>

<template>
  <main class="study-view">
    <div class="study-inner">
      <div class="study-topbar">
        <label class="study-search-label" for="study-search">Buscar</label>
        <input id="study-search" class="study-search" type="search" placeholder="Buscar cursos, notas, perguntas…" />
        <div class="study-add">
          <Button variant="secondary" icon="plus" aria-haspopup="menu" :aria-expanded="addOpen" @click="toggleAdd">
            Adicionar
          </Button>
          <div v-if="addOpen" class="study-menu" role="menu" @keydown.escape="closeAdd">
            <RouterLink role="menuitem" to="/curriculos/nova" @click="closeAdd">Novo currículo</RouterLink>
            <RouterLink role="menuitem" :to="{ name: 'inicio', query: { save: '1' } }" @click="closeAdd">
              Salvar link na inbox
            </RouterLink>
            <RouterLink v-if="canReachNotes" role="menuitem" :to="{ name: 'notas', query: { tab: 'perguntas' } }" @click="closeAdd">
              Nova pergunta
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
          Revisar {{ dueCount }} cartões
        </RouterLink>
      </div>

      <PageTitle class="study-title" :title="title" :objective="WEEKLY_FOCUS" />

      <section aria-label="Streak e estatísticas" class="study-band">
        <StreakGrid
          :days="levels"
          label="Dias de estudo nas últimas 26 semanas"
          caption="Últimas 26 semanas · hoje ainda em aberto"
        />
        <div class="study-stats">
          <Stat :value="streak" unit="dias" label="Streak atual" :delta="`recorde: ${record}`" />
          <Stat
            :value="formatHours(weekHours)"
            unit="h"
            label="Estudadas esta semana"
            :delta="formatSignedHours(weekDelta)"
            :delta-tone="weekDelta < 0 ? 'down' : undefined"
          />
          <Stat :value="dueCount" unit="cartões" label="Para revisar hoje" />
          <Stat :value="monthly.total" unit="itens" :label="`Concluídos em ${monthLabel}`" />
        </div>
      </section>

      <section aria-labelledby="study-curricula" class="study-section">
        <div class="study-section-head">
          <h2 id="study-curricula">Currículos</h2>
        </div>
        <Carousel label="Currículos" :item-width="248" :visible="4" :step="2">
          <CoverCard
            v-for="curriculum in store.curricula"
            :key="curriculum.slug"
            :title="curriculum.title"
            :description="curriculum.goal"
            :href="`/curriculos/${curriculum.slug}`"
          />
        </Carousel>
      </section>

      <section aria-labelledby="study-subjects" class="study-section">
        <div class="study-section-head">
          <div class="study-section-titles">
            <h2 id="study-subjects">Assuntos</h2>
            <RouterLink v-if="canReachLibrary" :to="{ name: 'biblioteca', query: { v: 'tudo' } }" class="study-see-all">
              Ver na biblioteca
            </RouterLink>
          </div>
          <SegmentedControl
            :model-value="subjectsView"
            :options="VIEW_OPTIONS"
            label="Visualização dos assuntos"
            @change="selectView"
          />
        </div>

        <div v-if="subjectsView === 'capas'" class="study-grid">
          <CoverCard
            v-for="subject in store.subjects"
            :key="subject.id"
            :title="subject.name"
            :meta="`${subjectTotal(subject)} itens · ${subject.activity}`"
            :cover-height="200"
            :href="subjectHref()"
          />
        </div>

        <div v-else role="table" aria-label="Assuntos e o que cada um reúne" class="study-table">
          <div class="study-row study-head-row" role="row">
            <span class="study-th study-first" role="columnheader">Assunto</span>
            <span class="study-th study-col-cur" role="columnheader">Currículos</span>
            <span class="study-th study-col-courses" role="columnheader">Cursos</span>
            <span class="study-th study-col-articles" role="columnheader">Artigos</span>
            <span class="study-th study-col-videos" role="columnheader">Vídeos</span>
            <span class="study-th study-col-notes" role="columnheader">Notas</span>
            <span class="study-th study-col-questions" role="columnheader">Perguntas</span>
            <span class="study-th" role="columnheader">Atividade</span>
          </div>
          <div v-for="subject in store.subjects" :key="subject.id" class="study-row" role="row">
            <div role="cell" class="study-first">
              <RouterLink :to="subjectHref()" class="study-row-link">{{ subject.name }}</RouterLink>
            </div>
            <span class="study-num study-col-cur" role="cell">{{ subject.curricula }}</span>
            <span class="study-num study-col-courses" role="cell">{{ subject.courses }}</span>
            <span class="study-num study-col-articles" role="cell">{{ subject.articles }}</span>
            <span class="study-num study-col-videos" role="cell">{{ subject.videos }}</span>
            <span class="study-num study-col-notes" role="cell">{{ subject.notes }}</span>
            <span class="study-num study-col-questions" role="cell">{{ subject.questions }}</span>
            <span class="study-num" role="cell">{{ subject.activity }}</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.study-view {
  min-width: 0;
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
.study-table {
  min-width: 0;
}
.study-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(6, 72px) 88px;
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
@media (max-width: 1180px) {
  .study-row {
    grid-template-columns: minmax(0, 1fr) repeat(3, 64px) 80px;
  }
  .study-col-articles,
  .study-col-videos,
  .study-col-questions {
    display: none;
  }
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
  .study-row {
    grid-template-columns: minmax(0, 1fr) 64px;
  }
  .study-col-cur,
  .study-col-courses,
  .study-col-notes {
    display: none;
  }
  .study-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .study-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
