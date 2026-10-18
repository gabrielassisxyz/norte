<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { useCoreFocus, useSubjects } from './data/composables'
import { subjectsChanged } from './data/revision'
import type { Subject } from './data/source'

/**
 * Choose the subject something is about, or name one that does not exist yet.
 *
 * One field, not a search box above a list: the focus comes first and the
 * search second, because the subject a link belongs to is usually one of the
 * handful already in play — that is the whole reason the focus flag exists.
 * Typing switches to the search, so the full vocabulary is still one field
 * away, and a name the vocabulary does not have is offered as a subject to
 * create, because otherwise the first subject of a fresh install can only be
 * made on the command line.
 */
const props = withDefaults(defineProps<{ label?: string; chosen?: readonly string[] }>(), {
  label: 'Subject',
  chosen: () => []
})

const emit = defineEmits<{ select: [subject: Subject] }>()

/** What a listbox option offers: a subject that exists, or one to create. */
type PickerEntry = { kind: 'subject'; subject: Subject } | { kind: 'create'; name: string }

const { core } = useSources()
const creating = useAsyncAction()

const fieldId = useId()
const listboxId = `${fieldId}-listbox`
const entryId = (position: number): string => `${fieldId}-option-${position}`

const search = ref('')
// Open from the start, because both callers mount the picker at the moment the
// person asked for it — the row's subject menu and the save dialog — and a list
// that waited for a click there would cost a click to show what was asked for.
const open = ref(true)
const highlighted = ref(0)

const { data: focus } = useCoreFocus()
// The search only runs once something was typed: before that the offer is the
// focus, and asking the server for the first page of everything would be a
// read whose answer nothing renders.
const searching = computed(() => search.value.trim().length > 0)
const { data: found } = useSubjects(() => ({ q: search.value.trim() }), searching)

const subjects = computed<Subject[]>(() => {
  const source = searching.value ? (found.value?.items ?? []) : (focus.value?.subjects ?? [])
  const taken = new Set(props.chosen)
  return source.filter((subject) => !taken.has(subject.id))
})

const typed = computed(() => search.value.trim())

/**
 * The create option is offered only while no listed subject carries the typed
 * name, so the answer to "it already exists" is choosing it rather than a 409.
 */
const creatable = computed(
  () =>
    typed.value.length > 0 &&
    !subjects.value.some((subject) => subject.name.toLowerCase() === typed.value.toLowerCase())
)

const entries = computed<PickerEntry[]>(() => {
  const listed: PickerEntry[] = subjects.value.map((subject) => ({ kind: 'subject', subject }))
  return creatable.value ? [...listed, { kind: 'create', name: typed.value }] : listed
})

const activeDescendant = computed(() =>
  open.value && entries.value[highlighted.value] ? entryId(highlighted.value) : undefined
)

const emptyText = computed(() =>
  searching.value ? 'No subject by that name.' : 'No subject in focus. Search by name.'
)

watch(search, () => {
  highlighted.value = 0
  open.value = true
  creating.clear()
})

function choose(subject: Subject): void {
  emit('select', subject)
  search.value = ''
  highlighted.value = 0
}

/**
 * Create the typed name and choose it in one step. The vocabulary moved, so
 * every other subject list on screen is told; a refused name reports the
 * server's own words and chooses nothing.
 */
async function createAndChoose(name: string): Promise<void> {
  if (creating.pending.value) return
  const created = await creating.run(() => core.createSubject(name))
  if (!created) return
  subjectsChanged()
  choose(created)
}

function run(entry: PickerEntry): void {
  if (entry.kind === 'subject') choose(entry.subject)
  else void createAndChoose(entry.name)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    open.value = true
    highlighted.value = Math.min(entries.value.length - 1, highlighted.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    open.value = true
    highlighted.value = Math.max(0, highlighted.value - 1)
  } else if (event.key === 'Enter') {
    // Prevented whether or not an option is current: the save dialog wraps the
    // picker in a form, where a bare Enter would submit the save instead.
    event.preventDefault()
    const entry = entries.value[highlighted.value]
    if (open.value && entry) run(entry)
  } else if (event.key === 'Escape') {
    // Kept from the dialog around it, which closes on Escape too: the first
    // Escape belongs to the list that is open, and the input keeps the focus.
    event.stopPropagation()
    open.value = false
  }
}
</script>

<template>
  <div class="subject-picker">
    <label :for="fieldId" class="subject-picker-label">{{ label }}</label>
    <input
      :id="fieldId"
      v-model="search"
      class="subject-picker-input"
      type="text"
      placeholder="Search for a subject…"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-activedescendant="activeDescendant"
      @focus="open = true"
      @click="open = true"
      @keydown="handleKeydown"
    />
    <div v-if="open" :id="listboxId" class="subject-picker-list" role="listbox" :aria-label="label">
      <p v-if="entries.length === 0" class="subject-picker-empty">{{ emptyText }}</p>
      <button
        v-for="(entry, position) in entries"
        :id="entryId(position)"
        :key="entry.kind === 'subject' ? entry.subject.id : 'create'"
        type="button"
        role="option"
        class="subject-picker-option"
        :class="{ 'is-highlighted': position === highlighted }"
        :aria-selected="position === highlighted"
        @mouseenter="highlighted = position"
        @mousedown.prevent
        @click="run(entry)"
      >
        <template v-if="entry.kind === 'subject'">
          <span class="subject-picker-name">{{ entry.subject.name }}</span>
          <span v-if="entry.subject.focus && !searching" class="subject-picker-badge">in focus</span>
        </template>
        <span v-else class="subject-picker-name">Create “{{ entry.name }}”</span>
      </button>
    </div>
    <p v-if="creating.error.value" class="subject-picker-failure" role="alert">{{ creating.error.value }}</p>
  </div>
</template>

<style scoped>
.subject-picker {
  display: grid;
  gap: var(--space-2);
}
.subject-picker-label {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.subject-picker-input {
  display: block;
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 22px;
}
.subject-picker-input::placeholder {
  color: var(--muted);
}
.subject-picker-input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.subject-picker-empty {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}
.subject-picker-list {
  max-height: 220px;
  overflow: auto;
  display: grid;
  gap: 1px;
}
.subject-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-align: left;
}
.subject-picker-option:hover,
.subject-picker-option.is-highlighted {
  background: var(--sunken);
}
.subject-picker-option:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.subject-picker-badge {
  flex: none;
  color: var(--norte);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
}
.subject-picker-failure {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}
</style>
