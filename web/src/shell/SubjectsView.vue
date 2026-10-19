<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import { useAsyncAction, useAsyncResource } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import NewSubjectButton from './NewSubjectButton.vue'
import { subjectsChanged, subjectsRevision } from './data/revision'
import type { Subject } from './data/source'

const { core } = useSources()

/**
 * Every subject, not the first page of them.
 *
 * The sidebar lists subjects a page at a time because it is a navigation strip
 * with a "load more" at the bottom; this page is the overview of the whole
 * vocabulary, so it follows `next_cursor` to the end before it renders. The
 * ordering is the server's own (by slug), re-sorted by name here because the
 * page promises an alphabetical list of names and a name can differ from the
 * slug it derived.
 */
const {
  data: subjects,
  loading,
  error,
  refresh
} = useAsyncResource<Subject[]>(async (signal) => {
  const all: Subject[] = []
  let cursor: string | undefined
  do {
    const page = await core.listSubjects({ cursor }, signal)
    all.push(...page.items)
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return all.sort((left, right) => left.name.localeCompare(right.name))
})

watch(subjectsRevision, () => void refresh())

const writing = useAsyncAction()
const writeError = ref('')
/** The subject the open confirmation is about, and nothing is deleted without one. */
const deleting = ref<Subject | null>(null)

const rows = computed<Subject[]>(() => subjects.value ?? [])
const firstLoad = computed(() => loading.value && subjects.value === null)
const empty = computed(() => !loading.value && error.value === null && rows.value.length === 0)

function linkWord(count: number): string {
  return count === 1 ? '1 link' : `${count} links`
}

/**
 * The toggle renders what the server answered, never what it sent: a row that
 * flipped itself and failed would be describing a state that does not exist.
 */
async function toggleFocus(subject: Subject): Promise<void> {
  writeError.value = ''
  const updated = await writing.run(() => core.patchSubject(subject.id, { focus: !subject.focus }))
  if (!updated) {
    writeError.value = `The focus could not be changed: ${writing.error.value ?? 'unknown error'}`
    return
  }
  subjects.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
  // The sidebar, the picker and the study home hold lists of their own, and no
  // write response can reach them.
  subjectsChanged()
}

function openDelete(subject: Subject): void {
  writeError.value = ''
  deleting.value = subject
}

function cancelDelete(): void {
  deleting.value = null
}

async function confirmDelete(): Promise<void> {
  const subject = deleting.value
  if (!subject) return
  const done = await writing.run(async () => {
    await core.deleteSubject(subject.id)
    return true
  })
  if (!done) {
    writeError.value = `Could not delete: ${writing.error.value ?? 'unknown error'}`
    return
  }
  deleting.value = null
  subjects.value = rows.value.filter((row) => row.id !== subject.id)
  subjectsChanged()
}

/**
 * A subject created from here stays here: the list is the screen the person
 * asked for, so the new row appears in place instead of the page jumping to it.
 */
function created(subject: Subject): void {
  subjects.value = [...rows.value, subject].sort((left, right) => left.name.localeCompare(right.name))
}
</script>

<template>
  <main class="subjects-view">
    <div class="subjects-inner">
      <PageTitle title="Subjects" objective="The topics everything else is filed under.">
        <template #actions>
          <NewSubjectButton :navigate="false" @created="created" />
        </template>
      </PageTitle>

      <p v-if="firstLoad" class="subjects-state" role="status">Loading the subjects…</p>

      <div v-else-if="error" class="subjects-state" role="alert">
        <p>The subjects could not be loaded: {{ error }}</p>
        <Button variant="secondary" @click="refresh()">Try again</Button>
      </div>

      <p v-if="writeError" class="subjects-error" role="alert">{{ writeError }}</p>

      <div v-if="empty" class="subjects-state subjects-empty" role="status">
        <p>No subject yet. A subject is a topic you file saved things under.</p>
        <NewSubjectButton :navigate="false" @created="created" />
      </div>

      <ul v-else-if="rows.length > 0" class="subjects-list">
        <li v-for="subject in rows" :key="subject.id" class="subjects-row">
          <RouterLink :to="{ name: 'subject', params: { slug: subject.slug } }" class="subjects-name">
            {{ subject.name }}
          </RouterLink>
          <span class="subjects-count">{{ linkWord(subject.link_count) }}</span>
          <button
            type="button"
            role="switch"
            class="subjects-switch"
            :class="{ 'is-on': subject.focus }"
            :aria-checked="subject.focus"
            :aria-label="`${subject.name} in focus`"
            :disabled="writing.pending.value"
            @click="toggleFocus(subject)"
          >
            <span class="subjects-switch-track" aria-hidden="true"><span class="subjects-switch-knob" /></span>
            <span>In focus</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="`Delete ${subject.name}`"
            :disabled="writing.pending.value"
            @click="openDelete(subject)"
          >
            Delete
          </Button>
        </li>
      </ul>

      <div v-if="deleting" class="subjects-backdrop" @mousedown.self="cancelDelete">
        <div class="subjects-dialog" role="dialog" aria-labelledby="subjects-delete-title">
          <h2 id="subjects-delete-title">
            Delete {{ deleting.name }} and its {{ linkWord(deleting.link_count) }}?
          </h2>
          <p>This cannot be undone. The saved items stay in the library.</p>
          <div class="subjects-dialog-buttons">
            <Button variant="secondary" @click="cancelDelete">Cancel</Button>
            <Button variant="primary" :disabled="writing.pending.value" @click="confirmDelete">
              Delete the subject
            </Button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.subjects-view {
  min-width: 0;
}
.subjects-inner {
  max-width: 880px;
  margin: 0 auto;
  padding-top: var(--space-16);
}
.subjects-state {
  margin: var(--space-8) 0 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 24px;
}
.subjects-state p {
  margin: 0 0 var(--space-2);
}
.subjects-error {
  margin: var(--space-4) 0 0;
  color: var(--danger);
  font-size: 14px;
  line-height: 22px;
}
.subjects-list {
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}
.subjects-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--line);
}
.subjects-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subjects-name:hover {
  color: var(--norte);
}
.subjects-count {
  flex: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.subjects-switch {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  height: 30px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
}
.subjects-switch.is-on {
  border-color: var(--norte);
  color: var(--norte);
}
.subjects-switch:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.subjects-switch-track {
  width: 26px;
  height: 14px;
  flex: none;
  display: block;
  border-radius: 999px;
  background: var(--line-strong);
}
.subjects-switch.is-on .subjects-switch-track {
  background: var(--norte);
}
.subjects-switch-knob {
  display: block;
  width: 10px;
  height: 10px;
  margin: 2px;
  border-radius: 999px;
  background: var(--surface);
  transition: transform 120ms cubic-bezier(0.2, 0, 0, 1);
}
.subjects-switch.is-on .subjects-switch-knob {
  transform: translateX(12px);
}
.subjects-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
  background: rgb(13 17 23 / 32%);
}
.subjects-dialog {
  display: grid;
  width: min(480px, calc(100vw - 32px));
  gap: var(--space-4);
  padding: 28px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}
.subjects-dialog h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 650;
  line-height: 28px;
}
.subjects-dialog p {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}
.subjects-dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
