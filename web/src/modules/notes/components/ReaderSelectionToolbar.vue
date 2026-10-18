<script lang="ts">
/**
 * Where the toolbar has to put itself, in viewport coordinates.
 *
 * It is a plain object rather than a `DOMRect` because what it describes is the
 * first line of the selection, which may be one of several rectangles a range
 * covers, and because a test has to be able to state one.
 */
export interface ToolbarAnchor {
  top: number
  bottom: number
  left: number
  width: number
}

/** A selection whose top is nearer the top of the window than this flips below it. */
export const FLIP_BELOW_ABOVE_PX = 48

/** The gap between the selection's line and the toolbar. */
const GAP_PX = 8

/** How close to the window's edge the toolbar may be pushed. */
const EDGE_PX = 8
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import Menu from '@/components/ds/Menu.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import type { AnnotationRecord, HighlightRecord, QuestionRecord } from '../data/source'

/**
 * The actions a highlighted passage offers, floating over the passage itself.
 *
 * The passage already exists when this appears: selecting text highlights it,
 * and this is what is then done with the highlight — undo it, write a note on
 * it, ask a question about it, copy it. That is why the first button removes
 * rather than creates, and why Escape closes without undoing anything: the
 * highlight is the person's, not this component's.
 *
 * The four buttons are icon-only, which the design system otherwise refuses.
 * A floating toolbar over a line of text is the one place where a label would
 * cover the words being acted on, so each carries a tooltip and an aria-label
 * instead, and the labels are what the tests assert on.
 *
 * Where it sits is measured rather than stored: `measure` is asked again on
 * every scroll, so the toolbar follows the passage and closes once the passage
 * has left the window. The owner keeps the measurement because only it knows
 * what the anchor is — the selection's own rectangle before the mark exists,
 * and the mark itself afterwards.
 */
const props = defineProps<{
  itemId: string
  highlight: HighlightRecord
  /** The passage's first line now, or null once it is no longer on the page. */
  measure: () => ToolbarAnchor | null
  /** The item's notes that hang on no passage, offered as somewhere to attach this one. */
  looseNotes: AnnotationRecord[]
  /** How many notes already hang on this passage, which is what makes removing it ask first. */
  notesOnPassage: number
}>()

const emit = defineEmits<{
  close: []
  removed: [id: string]
  annotated: [annotation: AnnotationRecord]
  attached: [annotation: AnnotationRecord]
  questioned: [question: QuestionRecord]
  /** The passage is being corrected: the next selection in the article replaces it. */
  reselect: [id: string]
}>()

type Box = 'none' | 'annotate' | 'question'

const { notes } = useSources()
const writing = useAsyncAction()

const root = ref<HTMLElement | null>(null)
const anchor = ref<ToolbarAnchor | null>(props.measure())
const box = ref<Box>('none')
const draft = ref('')

/**
 * Below the selection when there is no room above it.
 *
 * The threshold is the toolbar's own height plus its gap: above that the
 * toolbar would be drawn partly outside the window, where nothing can be
 * clicked.
 */
const below = computed(() => (anchor.value?.top ?? 0) < FLIP_BELOW_ABOVE_PX)

const placement = computed(() => {
  const rect = anchor.value
  if (!rect) return { display: 'none' }
  const half = (root.value?.offsetWidth ?? 0) / 2
  const centre = rect.left + rect.width / 2
  const room = typeof window === 'undefined' ? 0 : window.innerWidth
  // Clamped to the window, so a passage at either margin still gets a toolbar
  // that is entirely on the screen.
  const left = room > 0 ? Math.min(Math.max(centre, half + EDGE_PX), Math.max(room - half - EDGE_PX, half + EDGE_PX)) : centre
  return {
    left: `${left}px`,
    top: below.value ? `${rect.bottom + GAP_PX}px` : `${rect.top - GAP_PX}px`,
    transform: below.value ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
  }
})

/**
 * Follow the passage, and give up once it has left the window.
 *
 * The listener is on the window in the capture phase because the article
 * scrolls inside a container of its own, and a scroll event does not bubble out
 * of it.
 */
function reanchor(): void {
  const rect = props.measure()
  if (!rect || rect.bottom < 0 || rect.top > (typeof window === 'undefined' ? 0 : window.innerHeight)) {
    emit('close')
    return
  }
  anchor.value = rect
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // Not stopped: the reader closes its own sheet on Escape, and the person
  // pressing it once wants the nearest thing gone, which is this.
  emit('close')
}

/**
 * A click outside closes, with the toolbar's own menu panel excluded.
 *
 * The design system's menu renders its panel inside this component, so
 * `contains` already covers it; what it does not cover is a click on the
 * article, which is how the toolbar for one passage is left for another.
 */
function onPointerDown(event: Event): void {
  const target = event.target as Node | null
  if (target && root.value?.contains(target)) return
  emit('close')
}

onMounted(() => {
  window.addEventListener('scroll', reanchor, true)
  window.addEventListener('resize', reanchor)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', reanchor, true)
  window.removeEventListener('resize', reanchor)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onPointerDown)
})

function openBox(which: Box): void {
  box.value = which
  draft.value = ''
  writing.clear()
}

async function remove(): Promise<void> {
  // A passage carrying notes takes them with it, as the schema does, so that
  // deletion is the one here that asks.
  if (props.notesOnPassage > 0 && !window.confirm('Delete this highlighted passage and its notes?')) return
  const done = await writing.run(async () => {
    await notes.deleteHighlight(props.highlight.id)
    return true
  })
  if (!done) return
  emit('removed', props.highlight.id)
}

async function saveAnnotation(): Promise<void> {
  const text = draft.value.trim()
  if (!text) return
  const created = await writing.run(() =>
    notes.addAnnotation({ item_id: props.itemId, text, highlight_id: props.highlight.id })
  )
  if (!created) return
  emit('annotated', created)
}

async function attachTo(note: AnnotationRecord): Promise<void> {
  const updated = await writing.run(() => notes.attachAnnotationPassage(note.id, props.highlight.id))
  if (!updated) return
  emit('attached', updated)
}

/**
 * A question about the passage.
 *
 * It does not demand a trailing "?" the way the panel's form does: there the
 * person is turning a note into a question and the mark is what says which of
 * the two it became, while here the button says it already.
 */
async function saveQuestion(): Promise<void> {
  const text = draft.value.trim()
  if (!text) return
  const created = await writing.run(() =>
    notes.addQuestion({ item_id: props.itemId, text, highlight_id: props.highlight.id })
  )
  if (!created) return
  emit('questioned', created)
}

const copied = ref(false)

async function copyText(): Promise<void> {
  copied.value = false
  await writing.run(async () => {
    await navigator.clipboard.writeText(props.highlight.exact)
    copied.value = true
    return true
  })
}
</script>

<template>
  <div ref="root" class="notes-seltool" :class="{ 'is-below': below }" :style="placement">
    <div class="notes-seltool-row" role="toolbar" aria-label="Actions for the highlighted passage">
      <button
        type="button"
        class="notes-seltool-btn"
        data-action="toolbar-remove"
        aria-label="Remove highlight"
        title="Remove highlight"
        :disabled="writing.pending.value"
        @click="remove"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
      <button
        type="button"
        class="notes-seltool-btn"
        :class="{ 'is-open': box === 'annotate' }"
        data-action="toolbar-annotate"
        aria-label="Annotate"
        title="Annotate"
        @click="openBox(box === 'annotate' ? 'none' : 'annotate')"
      >
        <Icon name="comment" :size="14" />
      </button>
      <button
        type="button"
        class="notes-seltool-btn"
        :class="{ 'is-open': box === 'question' }"
        data-action="toolbar-question"
        aria-label="Ask a question"
        title="Ask a question"
        @click="openBox(box === 'question' ? 'none' : 'question')"
      >
        <span class="notes-seltool-glyph" aria-hidden="true">?</span>
      </button>
      <Menu label="More" menu-label="More actions for this passage">
        <template #trigger>
          <span class="notes-seltool-glyph" aria-hidden="true">···</span>
        </template>
        <button type="button" role="menuitem" class="notes-seltool-item" data-action="toolbar-copy" @click="copyText">
          <span>Copy text</span>
          <span class="notes-seltool-hint">Ctrl+C</span>
        </button>
        <!--
          Re-selecting is the owner's to run, not this component's: the words
          are picked in the article, and the toolbar is gone by the time they
          are. So this only says which passage is being corrected.
        -->
        <button
          type="button"
          role="menuitem"
          class="notes-seltool-item"
          data-action="toolbar-reselect"
          @click="emit('reselect', props.highlight.id)"
        >
          <span>Re-select passage</span>
        </button>
      </Menu>
    </div>

    <form v-if="box !== 'none'" class="notes-seltool-box" @submit.prevent="box === 'annotate' ? saveAnnotation() : saveQuestion()">
      <textarea
        v-model="draft"
        class="notes-seltool-field"
        rows="3"
        :aria-label="box === 'annotate' ? 'Note on this passage' : 'Question about this passage'"
        :placeholder="box === 'annotate' ? 'What does this passage change?' : 'What does this passage raise?'"
      />
      <div class="notes-seltool-submit">
        <Button variant="secondary" size="sm" type="button" data-action="toolbar-cancel" @click="openBox('none')">
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          :data-action="box === 'annotate' ? 'toolbar-save-annotation' : 'toolbar-save-question'"
          :disabled="!draft.trim() || writing.pending.value"
        >
          Save
        </Button>
      </div>

      <div v-if="box === 'annotate' && looseNotes.length > 0" class="notes-seltool-attach">
        <p class="notes-seltool-attach-title">Or attach to an existing note</p>
        <button
          v-for="note in looseNotes"
          :key="note.id"
          type="button"
          class="notes-seltool-attach-note"
          data-action="toolbar-attach"
          :data-note="note.id"
          :disabled="writing.pending.value"
          @click="attachTo(note)"
        >
          {{ note.text }}
        </button>
      </div>
    </form>

    <p v-if="copied" class="notes-seltool-said" role="status">Passage copied.</p>
    <p v-if="writing.error.value" class="notes-seltool-error" role="alert">{{ writing.error.value }}</p>
  </div>
</template>

<style scoped>
/*
  Fixed, because the toolbar is placed against the window: the article scrolls
  inside a container and an absolutely placed toolbar would scroll out of the
  passage it belongs to as soon as the column moved under it.
*/
.notes-seltool {
  position: fixed;
  z-index: 50;
  display: grid;
  gap: var(--space-2);
  width: max-content;
  max-width: min(360px, calc(100vw - 16px));
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.notes-seltool-row { display: inline-flex; gap: 2px; }

.notes-seltool-btn {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}

.notes-seltool-btn:hover:not(:disabled) { background: var(--sunken); }
.notes-seltool-btn.is-open { background: var(--norte-soft); color: var(--norte); }
.notes-seltool-btn:disabled { color: var(--muted); cursor: default; }
.notes-seltool-btn:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }

.notes-seltool-glyph { font-family: var(--font-display); font-size: 14px; font-weight: 700; line-height: 1; }

.notes-seltool-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
}

.notes-seltool-item:hover { background: var(--sunken); }
.notes-seltool-hint { color: var(--muted); font-family: var(--font-mono); font-size: 11px; }

.notes-seltool-box { display: grid; gap: var(--space-2); padding: 0 4px 4px; }

/* Not resizable: the box floats over the text, and a dragged corner would push it off. */
.notes-seltool-field {
  width: 100%;
  min-width: 260px;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 22px;
  resize: none;
}

.notes-seltool-field:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.notes-seltool-submit { display: flex; justify-content: flex-end; gap: var(--space-2); }
.notes-seltool-attach { display: grid; gap: 2px; padding-top: var(--space-2); border-top: 1px solid var(--line); }
.notes-seltool-attach-title { margin: 0; color: var(--muted); font-size: 12px; line-height: 16px; }

.notes-seltool-attach-note {
  overflow: hidden;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notes-seltool-attach-note:hover:not(:disabled) { background: var(--sunken); color: var(--ink); }
.notes-seltool-said { margin: 0 4px 4px; color: var(--muted); font-size: 12px; line-height: 16px; }
.notes-seltool-error { margin: 0 4px 4px; color: var(--danger); font-size: 12px; line-height: 16px; }
</style>
