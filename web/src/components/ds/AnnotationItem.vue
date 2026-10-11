<script setup lang="ts">
import { computed } from 'vue'

export type AnnotationKind = 'linked' | 'highlight' | 'loose' | 'question'

const props = defineProps<{
  kind?: AnnotationKind
  quote?: string
  note?: string
  n?: number
  location?: string
  time?: string
}>()

defineEmits<{ addNote: [] }>()

// A passage with a note is linked, a passage alone is a bare highlight, and neither is a loose note.
const resolvedKind = computed<AnnotationKind>(() => {
  if (props.kind) return props.kind
  if (!props.quote) return 'loose'
  return props.note ? 'linked' : 'highlight'
})

const badge = computed(() => {
  if (resolvedKind.value === 'loose') return 'No passage'
  if (resolvedKind.value === 'question') return 'No passage · became a question'
  return null
})
</script>

<template>
  <div class="nt-ann">
    <span v-if="badge" class="nt-ann-badge">{{ badge }}</span>
    <p v-if="quote" class="nt-ann-quote"><mark class="nt-mark">{{ quote }}</mark></p>
    <p v-if="note" class="nt-ann-note">{{ note }}</p>
    <div class="nt-ann-meta">
      <span v-if="n != null" class="nt-ann-n">{{ n }}</span>
      <span v-if="resolvedKind === 'highlight'">Highlight only</span>
      <span v-if="location">{{ location }}</span>
      <span v-if="time" class="nt-mono">{{ time }}</span>
    </div>
    <button
      v-if="resolvedKind === 'highlight'"
      type="button"
      class="nt-ann-add"
      @click="$emit('addNote')"
    >
      + Annotate this passage
    </button>
  </div>
</template>

<style scoped>
.nt-ann {
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--line);
}
.nt-ann-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-xs);
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 550;
  color: var(--muted);
}
.nt-ann-quote {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink);
}
.nt-mark {
  background: var(--lime);
  color: var(--on-lime);
  padding: 1px 2px;
  border-radius: var(--radius-xs);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.nt-ann-note {
  margin: var(--space-2) 0 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
}
.nt-ann-meta {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}
.nt-ann-n {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--norte);
}
.nt-ann-add {
  margin-top: var(--space-2);
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  color: var(--link);
  cursor: pointer;
  border-radius: var(--radius-xs);
}
.nt-ann-add:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
