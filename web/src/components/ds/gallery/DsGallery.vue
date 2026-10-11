<script setup lang="ts">
import { ref } from 'vue'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Button from '@/components/ds/Button.vue'
import Carousel from '@/components/ds/Carousel.vue'
import CourseRow from '@/components/ds/CourseRow.vue'
import Cover from '@/components/ds/Cover.vue'
import CoverCard from '@/components/ds/CoverCard.vue'
import ExerciseItem from '@/components/ds/ExerciseItem.vue'
import Flashcard from '@/components/ds/Flashcard.vue'
import Highlight from '@/components/ds/Highlight.vue'
import Icon from '@/components/ds/Icon.vue'
import MarginNote from '@/components/ds/MarginNote.vue'
import Mark from '@/components/ds/Mark.vue'
import MaterialRow from '@/components/ds/MaterialRow.vue'
import ModuleItem from '@/components/ds/ModuleItem.vue'
import NavItem from '@/components/ds/NavItem.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import ProgressBar from '@/components/ds/ProgressBar.vue'
import QuestionItem from '@/components/ds/QuestionItem.vue'
import SectionHeader from '@/components/ds/SectionHeader.vue'
import SelectionToolbar from '@/components/ds/SelectionToolbar.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import SidePanel from '@/components/ds/SidePanel.vue'
import Stat from '@/components/ds/Stat.vue'
import StreakGrid from '@/components/ds/StreakGrid.vue'
import SyncStatus from '@/components/ds/SyncStatus.vue'
import Tabs from '@/components/ds/Tabs.vue'
import Tag from '@/components/ds/Tag.vue'
import TextField from '@/components/ds/TextField.vue'
import TrailPath from '@/components/ds/TrailPath.vue'
import type { IconName, TabItem } from '@/components/ds/types'
import { getTheme, setTheme, type Theme } from '@/theme'

const currentTheme = ref<Theme>(getTheme())

function toggleTheme(): void {
  currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark'
  setTheme(currentTheme.value)
}

const themes = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
] as const

const modes = [
  { value: 'reading', label: 'Reading' },
  { value: 'practice', label: 'Practice', count: '2/5' }
]
const views = [
  { value: 'covers', label: 'Covers' },
  { value: 'table', label: 'Table' }
]
const tabs = [
  { value: 'note', label: 'Note' },
  { value: 'annotations', label: 'Annotations', count: 4 }
]
const panelTabs: TabItem[] = [
  { value: 'note', label: 'Note', icon: 'note' },
  { value: 'annotations', label: 'Annotations', count: 4, icon: 'comment' }
]
const iconNames: IconName[] = [
  'check',
  'play',
  'plus',
  'lock',
  'arrow',
  'arrowLeft',
  'chevronDown',
  'collapse',
  'expand',
  'external',
  'note',
  'comment',
  'image'
]
const streakDays = Array.from({ length: 26 * 7 }, (_, index) => {
  const value = (index * 17 + 3) % 11
  return value < 2 ? 0 : Math.min(4, Math.floor(value / 2))
})

const selectedMode = ref('reading')
const selectedTab = ref('annotations')
const collapsedPanel = ref(true)
const note = ref('')

const trailSteps = [
  { title: 'Foundations', meta: '4 materials · 2 weeks', status: 'done' as const },
  { title: 'How memory works', meta: '6 materials · 3 weeks', status: 'current' as const },
  { title: 'Deliberate practice', meta: '5 materials · 2 weeks', status: 'next' as const },
  { title: 'Capstone project', meta: 'Written submission', status: 'locked' as const }
]

const courses = [
  { title: 'Queueing basics', topic: 'Systems', source: 'Book', progress: 0.5, lessons: '6/12', lastStudied: '2d ago' },
  { title: 'Technical writing', topic: 'Communication', source: 'Course', progress: 0.25, lessons: '3/12', lastStudied: '9d ago' },
  { title: 'Linear algebra', topic: 'Mathematics', source: 'YouTube', progress: 1, lessons: '18/18', lastStudied: '1h ago' }
]

const collections = [
  { title: 'Distributed systems', description: 'Learn enough consensus to pick a database for the right reasons.' },
  { title: 'Long-form writing', description: 'Ship one essay a month, from first draft to published.' },
  { title: 'Applied statistics', description: 'Read an empirical paper without trusting the abstract.' },
  { title: 'Music theory', description: 'Pick up a new tune by ear each week.' },
  { title: 'Geometry', description: 'Rebuild the visual intuition that school drills replaced.' },
  { title: 'Photography', description: 'Develop a roll each month and understand what shaped it.' }
]

const lastRating = ref<string | null>(null)
const lastAction = ref<string | null>(null)
</script>

<template>
  <main class="ds-gallery">
    <header class="ds-gallery-header">
      <p class="ds-eyebrow">Norte · design system</p>
      <h1>Component gallery</h1>
      <p>Documented variants of the shared controls, in both themes.</p>
      <button type="button" class="ds-gallery-theme" @click="toggleTheme">
        Theme: {{ currentTheme === 'dark' ? 'Dark' : 'Light' }}
      </button>
    </header>

    <section
      v-for="theme in themes"
      :key="theme.id"
      class="ds-theme"
      :data-theme="theme.id"
      :aria-labelledby="'ds-theme-' + theme.id"
    >
      <div class="ds-theme-heading">
        <h2 :id="'ds-theme-' + theme.id">{{ theme.label }}</h2>
        <span class="ds-theme-code">data-theme="{{ theme.id }}"</span>
      </div>

      <div class="ds-grid">
        <article class="ds-card ds-card-wide">
          <h3>Button</h3>
          <div class="ds-row">
            <Button variant="primary" icon="play">Start studying</Button>
            <Button>Add note</Button>
            <Button variant="ghost" icon="plus">New task</Button>
            <Button disabled>Archive</Button>
          </div>
          <div class="ds-row">
            <Button variant="primary" size="sm">Mark as done</Button>
            <Button size="sm">Skip</Button>
            <Button variant="ghost" size="sm">Undo</Button>
          </div>
        </article>

        <article class="ds-card">
          <h3>Tag</h3>
          <div class="ds-row">
            <Tag kind="topic">Systems</Tag>
            <Tag kind="topic">Research</Tag>
            <Tag kind="topic" active>Projects</Tag>
          </div>
          <div class="ds-row">
            <Tag @click="selectedTab = 'note'">reading</Tag>
            <Tag active :count="8" @click="selectedTab = 'annotations'">concepts</Tag>
            <Tag :count="3" @click="selectedTab = 'note'">experiments</Tag>
            <Tag>review</Tag>
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>SyncStatus</h3>
          <div class="ds-row ds-status-row">
            <SyncStatus state="saved" />
            <SyncStatus state="syncing" />
            <SyncStatus state="offline" />
            <SyncStatus state="conflict" />
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>Stat</h3>
          <div class="ds-row ds-stats">
            <Stat :value="18" unit="days" label="Current streak" />
            <Stat value="7.5" unit="h" label="Studied this week" delta="+1.5 h" />
            <Stat :value="64" label="Cards up to date" delta="−4 overdue" delta-tone="down" />
          </div>
        </article>

        <article class="ds-card">
          <h3>ProgressBar</h3>
          <div class="ds-stack">
            <ProgressBar label="Network track" :value="0.68" />
            <ProgressBar label="Weekly plan" :value="9" :max="12" value-text="9/12 sessions" />
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>StreakGrid</h3>
          <StreakGrid :days="streakDays" caption="Last 26 weeks · 118 study days" />
        </article>

        <article class="ds-card ds-card-wide">
          <h3>PageTitle</h3>
          <PageTitle
            title="Study distributed systems"
            objective="Be able to explain how services coordinate state and recover from failure in production."
          >
            <template #meta>
              <Tag kind="topic">Architecture</Tag>
              <Tag>backend</Tag>
              <SyncStatus state="saved" />
            </template>
            <template #actions>
              <Button>Edit plan</Button>
              <Button variant="primary" icon="play">Continue</Button>
            </template>
          </PageTitle>
        </article>

        <article class="ds-card">
          <h3>NavItem</h3>
          <nav class="ds-nav-preview" aria-label="Gallery navigation">
            <NavItem label="Home" active />
            <NavItem label="Curricula" :count="9" />
            <NavItem label="Subjects" :count="5" />
            <NavItem label="Review" :count="16" />
            <NavItem label="Notes" :count="84" />
          </nav>
        </article>

        <article class="ds-card">
          <h3>SectionHeader</h3>
          <SectionHeader title="Upcoming studies" action-label="See all" />
          <SectionHeader title="Filters" action-label="See all">
            <template #trailing>
              <SegmentedControl label="View" :options="views" default-value="covers" />
            </template>
          </SectionHeader>
        </article>

        <article class="ds-card">
          <h3>SegmentedControl</h3>
          <div class="ds-stack ds-controls-stack">
            <SegmentedControl v-model="selectedMode" label="Mode" :options="modes" />
            <SegmentedControl label="View" :options="views" default-value="table" />
          </div>
        </article>

        <article class="ds-card">
          <h3>Tabs</h3>
          <Tabs v-model="selectedTab" label="Panel" :items="tabs" />
        </article>

        <article class="ds-card ds-card-wide">
          <h3>SidePanel</h3>
          <div class="ds-panels">
            <SidePanel
              label="Note and annotations"
              :tabs="panelTabs"
              :panels="{ note: 'A note on the material.', annotations: 'A saved passage to review later.' }"
              default-value="annotations"
            />
            <SidePanel v-model:collapsed="collapsedPanel" label="Note and annotations" :tabs="panelTabs" />
          </div>
        </article>

        <article class="ds-card">
          <h3>TextField</h3>
          <div class="ds-stack">
            <TextField
              v-model="note"
              label="New annotation"
              multiline
              placeholder="An idea about the material…"
            />
            <TextField
              label="My estimate"
              inline
              mono
              default-value="70%"
              :width="88"
              hint="Review on Friday"
            />
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>Icon</h3>
          <div class="ds-icon-grid">
            <span v-for="name in iconNames" :key="name" class="ds-icon-item">
              <Icon :name="name" :size="18" />
              <code>{{ name }}</code>
            </span>
          </div>
        </article>
      </div>
    </section>

    <section class="gallery-legacy" aria-labelledby="gallery-legacy-title">
      <div class="gallery-legacy-head">
        <h2 id="gallery-legacy-title">Reading and study components</h2>
        <p>Composed blocks used by the curriculum, reading and review screens.</p>
      </div>

      <section class="gallery-section">
        <h3 class="gallery-name">Cover</h3>
        <Cover />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">TrailPath</h3>
        <TrailPath :steps="trailSteps" />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">CourseRow</h3>
        <CourseRow v-for="course in courses" :key="course.title" v-bind="course" />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">ModuleItem + MaterialRow</h3>
        <ModuleItem
          label="02"
          title="How memory works"
          meta="3 weeks · 3 materials, 2 required"
          status="current"
          status-text="In progress · 1/3"
          :default-open="true"
        >
          <MaterialRow
            :n="1"
            title="How spaced repetition works"
            by="A. Ellis"
            type="Post"
            status="done"
            description="The forgetting curve and what it means for a review schedule."
            url="https://example.org/"
          />
          <MaterialRow
            :n="2"
            title="Working memory in practice"
            by="R. Nolan"
            type="Book"
            status="current"
            description="Chapters 3 and 4, with the exercises at the end of each."
          />
          <MaterialRow :n="3" title="Interview on consolidation" type="Talk" :optional="true" status="skipped" />
        </ModuleItem>
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">ExerciseItem</h3>
        <ExerciseItem :n="1" kind="Explain without looking" prompt="Why do growing intervals beat daily review?">
          <p class="gallery-hint">The workspace goes here as children.</p>
        </ExerciseItem>
        <ExerciseItem
          :n="2"
          kind="Apply"
          prompt="Build a review schedule for 40 new cards."
          :done="true"
          answer="Four batches of ten, reviewed after 1, 3, 7 and 21 days."
          time="12:40"
        />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">CoverCard</h3>
        <div class="gallery-grid">
          <CoverCard v-for="item in collections.slice(0, 3)" :key="item.title" v-bind="item" />
        </div>
      </section>

      <section class="gallery-section gallery-section-wide">
        <h3 class="gallery-name">Carousel</h3>
        <Carousel label="Curricula" :item-width="248" :visible="4" :step="2">
          <CoverCard v-for="item in collections" :key="item.title" v-bind="item" />
        </Carousel>
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">Flashcard</h3>
        <Flashcard
          deck="Distributed systems"
          position="12/40"
          front="What must be chosen during a partition, per the CAP theorem?"
          back="Between answering with possibly stale data and refusing to answer — consistency or availability."
          @rate="lastRating = $event"
        />
        <p class="gallery-hint">Last rating: {{ lastRating ?? '—' }}</p>
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">QuestionItem</h3>
        <QuestionItem kind="why" question="Why are logical clocks enough to order events?" topic="Systems" age="3d ago" />
        <QuestionItem
          kind="how"
          question="How can I tell whether my review is calibrated?"
          status="answered"
          answer="By first-attempt recall: near 90% means the intervals are too short."
          topic="Study"
          age="11d ago"
        />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">Highlight</h3>
        <Highlight
          quote="A system that never measures its own delay learns about the queue from support tickets."
          source="Operating under load, ch. 4"
          timestamp="12:47"
          note="Same for review: without a count of overdue cards, the deck becomes debt."
        />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">Mark + MarginNote</h3>
        <p class="gallery-prose">
          Active reading is not about finishing the text, but about
          <Mark :note="1">leaving it with a question that was not there before</Mark>, even when the
          <Mark>subject already seemed settled</Mark>.
        </p>
        <MarginNote :n="1">The question outlives the summary: it survives forgetting the text.</MarginNote>
      </section>

      <section class="gallery-section gallery-section-start">
        <h3 class="gallery-name">SelectionToolbar</h3>
        <SelectionToolbar @action="lastAction = $event" />
        <p class="gallery-hint">Last action: {{ lastAction ?? '—' }}</p>
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">AnnotationItem</h3>
        <AnnotationItem
          quote="leaving it with a question that was not there before"
          note="Turn this into a card: what the reading opened, not what it closed."
          :n="1"
          location="Ch. 2 · p. 48"
          time="09:12"
        />
        <AnnotationItem quote="the subject already seemed settled" location="Ch. 2 · p. 49" time="09:14" />
        <AnnotationItem note="Reorder the modules: deliberate practice before the project." time="18:03" />
        <AnnotationItem kind="question" note="Can calibration be measured without a long history?" time="18:05" />
      </section>
    </section>
  </main>
</template>

<style scoped>
.ds-gallery {
  min-height: 100vh;
  padding: var(--space-11);
  background: var(--ground);
  color: var(--ink);
}

.ds-gallery-header {
  position: relative;
  max-width: 760px;
  margin: 0 auto var(--space-11);
}

.ds-eyebrow,
.ds-theme-code {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 16px;
}

.ds-eyebrow {
  margin: 0 0 var(--space-2);
}

.ds-gallery-header h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 44px;
}

.ds-gallery-header > p:not(.ds-eyebrow) {
  margin: var(--space-3) 0 0;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 30px;
}

.ds-gallery-theme {
  position: absolute;
  top: 0;
  right: 0;
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
}

.ds-gallery-theme:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.ds-theme {
  max-width: 1120px;
  margin: 0 auto var(--space-11);
  padding: var(--space-6);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--ground);
}

.ds-theme-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.ds-theme-heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.ds-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-6);
}

.ds-card {
  min-width: 0;
  padding: var(--space-6);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.ds-card-wide {
  grid-column: 1 / -1;
}

.ds-card h3 {
  margin: 0 0 var(--space-4);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 24px;
}

.ds-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.ds-row + .ds-row {
  margin-top: var(--space-4);
}

.ds-status-row {
  gap: var(--space-6);
}

.ds-stats {
  align-items: start;
  gap: var(--space-11);
}

.ds-stack {
  display: grid;
  gap: var(--space-4);
}

.ds-controls-stack {
  justify-items: start;
}

.ds-nav-preview {
  display: grid;
  gap: 2px;
  padding: var(--space-2);
  background: var(--sunken);
}

.ds-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  min-height: 260px;
  gap: var(--space-6);
}

.ds-panels > :first-child {
  min-width: 0;
}

.ds-icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--space-4);
}

.ds-icon-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-2);
}

.ds-icon-item code {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.gallery-legacy {
  max-width: 960px;
  margin: 0 auto;
  display: grid;
  gap: var(--space-16);
}

.gallery-legacy-head {
  display: grid;
  gap: var(--space-2);
}

.gallery-legacy-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.gallery-legacy-head p {
  margin: 0;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 30px;
}

.gallery-section {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

/* The toolbar sizes itself to its buttons, so the row must not stretch it. */
.gallery-section-start {
  justify-items: start;
}

/* The carousel hangs its arrows 20px outside the track, so this row needs the slack. */
.gallery-section-wide {
  padding: 0 var(--space-6);
}

.gallery-name {
  margin: 0;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: var(--space-6);
}

.gallery-hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.gallery-prose {
  max-width: 65ch;
  margin: 0;
  color: var(--ink);
  font-size: 18px;
  line-height: 30px;
}

@media (max-width: 900px) {
  .ds-gallery {
    padding: var(--space-6);
  }

  .ds-gallery-header {
    padding-top: var(--space-9);
  }

  .ds-gallery-theme {
    top: 0;
  }

  .ds-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .ds-card-wide {
    grid-column: auto;
  }
}
</style>
