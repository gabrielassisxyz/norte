<script setup lang="ts">
import { computed, ref } from 'vue'

import TextField from '@/components/ds/TextField.vue'

import { useCoreFocus, useSubjects } from './data/composables'
import type { Subject } from './data/source'

/**
 * Choose the subject something is about.
 *
 * The focus comes first and the search second, because the subject a link
 * belongs to is usually one of the handful already in play — that is the whole
 * reason the focus flag exists. Typing switches to the search, so the full
 * vocabulary is still one field away.
 */
const props = withDefaults(defineProps<{ label?: string; chosen?: readonly string[] }>(), {
  label: 'Assunto',
  chosen: () => []
})

const emit = defineEmits<{ select: [subject: Subject] }>()

const search = ref('')

const { data: focus } = useCoreFocus()
// The search only runs once something was typed: before that the offer is the
// focus, and asking the server for the first page of everything would be a
// read whose answer nothing renders.
const searching = computed(() => search.value.trim().length > 0)
const { data: found } = useSubjects(() => ({ q: search.value.trim() }), searching)

const options = computed<Subject[]>(() => {
  const source = searching.value ? (found.value?.items ?? []) : (focus.value?.subjects ?? [])
  const taken = new Set(props.chosen)
  return source.filter((subject) => !taken.has(subject.id))
})

const emptyText = computed(() =>
  searching.value ? 'Nenhum assunto com esse nome.' : 'Nenhum assunto em foco. Busque pelo nome.'
)

function choose(subject: Subject): void {
  emit('select', subject)
  search.value = ''
}
</script>

<template>
  <div class="subject-picker">
    <TextField
      v-model="search"
      :label="label"
      placeholder="Buscar assunto…"
      :hide-label="false"
    />
    <p v-if="options.length === 0" class="subject-picker-empty">{{ emptyText }}</p>
    <ul v-else class="subject-picker-list" role="listbox" :aria-label="label">
      <li v-for="subject in options" :key="subject.id">
        <button
          type="button"
          role="option"
          :aria-selected="false"
          class="subject-picker-option"
          @click="choose(subject)"
        >
          <span class="subject-picker-name">{{ subject.name }}</span>
          <span v-if="subject.focus && !searching" class="subject-picker-badge">em foco</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.subject-picker {
  display: grid;
  gap: var(--space-3);
}
.subject-picker-empty {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}
.subject-picker-list {
  margin: 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
  list-style: none;
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
.subject-picker-option:hover {
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
</style>
