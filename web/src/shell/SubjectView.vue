<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import SavedAboutPanel from './SavedAboutPanel.vue'
import { useSubjectBySlug } from './data/composables'
import { subjectsChanged } from './data/revision'
import type { SubjectTypeCount } from './data/source'

const route = useRoute()
const router = useRouter()
const { core } = useSources()

const slug = computed(() => {
  const raw = route.params.slug
  return Array.isArray(raw) ? (raw[0] ?? '') : raw
})

const { data: subject, loading, error, refresh, apply } = useSubjectBySlug(slug)

const writing = useAsyncAction()
const writeError = ref('')
const deleteOpen = ref(false)
/** The links the subject has when the dialog opened, not when the page loaded. */
const deleteLinkCount = ref(0)

const firstLoad = computed(() => loading.value && subject.value === null)
const counts = computed<SubjectTypeCount[]>(() => subject.value?.counts.by_type ?? [])
const total = computed(() => subject.value?.counts.total ?? 0)

/**
 * The focus switch writes and then renders what came back, never what it sent:
 * a switch that flipped itself optimistically and failed would be describing a
 * server state that does not exist.
 */
async function toggleFocus(): Promise<void> {
  const current = subject.value
  if (!current) return
  writeError.value = ''
  const updated = await writing.run(() => core.patchSubject(current.id, { focus: !current.focus }))
  if (!updated) {
    writeError.value = `The focus could not be changed: ${writing.error.value ?? 'unknown error'}`
    return
  }
  apply(updated)
  // The sidebar and the study home hold their own lists, and no write
  // response can reach them.
  subjectsChanged()
}

/**
 * Deleting names the number of links first. The page may have been open for a
 * while and links are added and removed elsewhere, so the figure is read again
 * when the dialog opens: the count the person confirms must be the one the
 * delete will take with it. Nothing is deleted until the dialog is confirmed,
 * and cancelling sends nothing at all.
 */
async function openDelete(): Promise<void> {
  const current = subject.value
  if (!current) return
  writeError.value = ''
  const fresh = await writing.run(() => core.getSubject(current.id, new AbortController().signal))
  if (!fresh) {
    writeError.value = writing.error.value
      ? `The links could not be counted: ${writing.error.value}`
      : 'This subject no longer exists.'
    return
  }
  apply(fresh)
  deleteLinkCount.value = fresh.link_count
  deleteOpen.value = true
}

function cancelDelete(): void {
  deleteOpen.value = false
}

async function confirmDelete(): Promise<void> {
  const current = subject.value
  if (!current) return
  const done = await writing.run(async () => {
    await core.deleteSubject(current.id)
    return true
  })
  if (!done) {
    writeError.value = `Could not delete: ${writing.error.value ?? 'unknown error'}`
    return
  }
  deleteOpen.value = false
  subjectsChanged()
  await router.push({ name: 'home' })
}
</script>

<template>
  <main class="subject-view">
    <div class="subject-inner">
      <p v-if="firstLoad" class="subject-state" role="status">Loading the subject…</p>

      <div v-else-if="error" class="subject-state" role="alert">
        <p>The subject could not be loaded: {{ error }}</p>
        <Button variant="secondary" @click="refresh()">Try again</Button>
      </div>

      <div v-else-if="subject === null" class="subject-state" role="status">
        <p>No subject at the address <span class="mono">{{ slug }}</span>.</p>
        <!-- Creating is on the subjects page, which is also where every other
             subject is: the address that answered nothing is more likely a
             stale link than a subject still to be named. -->
        <RouterLink :to="{ name: 'subjects' }" class="subject-link">All subjects</RouterLink>
      </div>

      <template v-else>
        <PageTitle :title="subject.name" :objective="`${total} ${total === 1 ? 'saved item' : 'saved items'}`">
          <template #actions>
            <div class="subject-actions">
              <button
                type="button"
                role="switch"
                class="subject-switch"
                :class="{ 'is-on': subject.focus }"
                :aria-checked="subject.focus"
                :disabled="writing.pending.value"
                @click="toggleFocus"
              >
                <span class="subject-switch-track" aria-hidden="true"><span class="subject-switch-knob" /></span>
                <span>In focus</span>
              </button>
              <Button variant="secondary" :disabled="writing.pending.value" @click="openDelete">Delete</Button>
            </div>
          </template>
        </PageTitle>

        <p v-if="writeError" class="subject-error" role="alert">{{ writeError }}</p>

        <section aria-labelledby="subject-counts" class="subject-section">
          <h2 id="subject-counts">What is already here</h2>
          <p v-if="counts.length === 0" class="subject-state">No item linked to this subject yet.</p>
          <ul v-else class="subject-counts">
            <li v-for="count in counts" :key="`${count.module}-${count.type}`" class="subject-count">
              <span class="subject-count-value">{{ count.count }}</span>
              <span class="subject-count-label">{{ count.type }}</span>
            </li>
          </ul>
        </section>

        <section class="subject-section">
          <SavedAboutPanel :target-id="subject.id" />
        </section>

        <div v-if="deleteOpen" class="subject-backdrop" @mousedown.self="cancelDelete">
          <div class="subject-dialog" role="dialog" aria-labelledby="subject-delete-title">
            <h2 id="subject-delete-title">Delete “{{ subject.name }}”?</h2>
            <p>
              This deletes the subject and
              {{ deleteLinkCount === 1 ? '1 link' : `${deleteLinkCount} links` }}
              to it. The saved items stay in the library. There is no undo.
            </p>
            <div class="subject-dialog-buttons">
              <Button variant="secondary" @click="cancelDelete">Cancel</Button>
              <Button variant="primary" :disabled="writing.pending.value" @click="confirmDelete">
                Delete the subject
              </Button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.subject-view {
  min-width: 0;
}
.subject-inner {
  max-width: 880px;
  margin: 0 auto;
  padding-top: var(--space-16);
}
.subject-state {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 24px;
}
.subject-state p {
  margin: 0 0 var(--space-2);
}
.subject-link {
  color: var(--norte);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
}
.subject-link:hover {
  text-decoration: underline;
}
.subject-error {
  margin: var(--space-4) 0 0;
  color: var(--danger);
  font-size: 14px;
  line-height: 22px;
}
.subject-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.subject-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}
.subject-switch.is-on {
  border-color: var(--norte);
  color: var(--norte);
}
.subject-switch:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.subject-switch-track {
  width: 28px;
  height: 16px;
  flex: none;
  display: block;
  border-radius: 999px;
  background: var(--line-strong);
}
.subject-switch.is-on .subject-switch-track {
  background: var(--norte);
}
.subject-switch-knob {
  display: block;
  width: 12px;
  height: 12px;
  margin: 2px;
  border-radius: 999px;
  background: var(--surface);
  transition: transform 120ms cubic-bezier(0.2, 0, 0, 1);
}
.subject-switch.is-on .subject-switch-knob {
  transform: translateX(12px);
}
.subject-section {
  margin-top: 56px;
}
.subject-section h2 {
  margin: 0 0 var(--space-4);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 26px;
}
.subject-counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
}
.subject-count {
  display: grid;
  gap: 2px;
}
.subject-count-value {
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  line-height: 30px;
}
.subject-count-label {
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 13px;
  line-height: 18px;
}
.subject-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
  background: rgb(13 17 23 / 32%);
}
.subject-dialog {
  display: grid;
  width: min(480px, calc(100vw - 32px));
  gap: var(--space-4);
  padding: 28px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}
.subject-dialog h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 650;
  line-height: 28px;
}
.subject-dialog p {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}
.subject-dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
