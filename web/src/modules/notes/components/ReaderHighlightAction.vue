<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import Button from '@/components/ds/Button.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { useItemNotes } from '../data/composables'
import { notesGainedNote } from '../data/revision'
import { markPassage } from './passageMarking'

/**
 * Highlighting what the person has selected in the article, and marking in the
 * text what is already highlighted.
 *
 * It fills the reader's `bottom-actions` slot, which is the bar across the
 * bottom on a phone and the place under the article it has always been
 * otherwise. In the bar the control is there before anything is selected, so
 * that "Destacar" is a visible action rather than something that appears if you
 * happen to have selected the right thing first; under the article it stays
 * what it was, a box that shows up with the passage in it.
 *
 * The marking is redone on every render rather than once. `content_html` is
 * inserted with `v-html`, so a re-extraction replaces the whole subtree and
 * every wrapper this put in the text is gone with it; `renderedAt` is what says
 * so.
 */
const props = defineProps<ReaderSlotProps>()

const { notes } = useSources()
const allowed = computed(() => crossModuleActionAllowed('library', 'notes'))
const writing = useAsyncAction()

const { data: notesOfItem, applyHighlight } = useItemNotes(
  () => props.itemId,
  () => allowed.value
)

/** True after a create that the server stored without a position. */
const keptWithoutPosition = ref(false)

const anchored = computed(() =>
  (notesOfItem.value?.highlights ?? []).filter((highlight) => highlight.status === 'anchored')
)

async function highlightSelection(): Promise<void> {
  const selected = props.liveSelection
  if (!selected) return
  keptWithoutPosition.value = false
  const created = await writing.run(() =>
    notes.addHighlight({
      item_id: props.itemId,
      exact: selected.exact,
      prefix: selected.prefix,
      suffix: selected.suffix
    })
  )
  if (!created) return
  applyHighlight(created)
  keptWithoutPosition.value = created.ambiguous === true
  notesGainedNote()
  props.clearSelection()
}

/**
 * Wrap each anchored passage where it appears in the rendered article.
 *
 * The passage is located by its words and the context stored with it, not by
 * the first text that happens to contain it, and is wrapped one text node at a
 * time so it can cross an inline element. A passage the article no longer
 * singles out is left unmarked; it is still listed beside the text.
 */
function markPassages(): void {
  const root = props.articleRoot
  if (!root) return
  for (const existing of root.querySelectorAll('[data-notes-passage]')) {
    const text = existing.textContent ?? ''
    existing.replaceWith(document.createTextNode(text))
  }
  root.normalize()
  for (const highlight of anchored.value) {
    markPassage(root, highlight)
  }
}

watch([() => props.renderedAt, () => props.articleRoot, anchored], markPassages, { immediate: true })
</script>

<template>
  <div v-if="allowed" class="notes-highlight-action">
    <div v-if="liveSelection || phone" class="notes-selection-bar" role="group" aria-label="Trecho selecionado">
      <blockquote v-if="liveSelection" class="notes-selection-quote">{{ liveSelection.exact }}</blockquote>
      <Button
        data-action="destacar"
        variant="primary"
        size="sm"
        :disabled="!liveSelection || writing.pending.value"
        @click="highlightSelection"
      >
        Destacar
      </Button>
      <Button v-if="liveSelection" variant="secondary" size="sm" @click="clearSelection">Cancelar</Button>
    </div>
    <p v-if="keptWithoutPosition" class="notes-highlight-notice" role="status" data-notes-ambiguous>
      trecho repetido: destaque guardado sem posição
    </p>
    <p v-if="writing.error.value" class="notes-highlight-error" role="alert">
      Não foi possível destacar: {{ writing.error.value }}
    </p>
  </div>
</template>

<style scoped>
.notes-highlight-action { margin-top: var(--space-4); }
/* Inside the reader's bar the box is the bar's own cell, so it brings no frame. */
@media (max-width: 900px) {
  .notes-highlight-action { margin-top: 0; }
  .notes-selection-bar { padding: 0; border: 0; background: transparent; }
  .notes-selection-quote { display: none; }
  .notes-selection-bar :deep(.nt-btn) { flex: 1; min-width: 0; height: 40px; justify-content: center; }
}
.notes-selection-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.notes-selection-quote {
  flex: 1 1 240px;
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}
.notes-highlight-notice { margin: var(--space-2) 0 0; color: var(--ink-2); font-size: 13px; line-height: 20px; }
.notes-highlight-error { margin: var(--space-2) 0 0; color: var(--danger); font-size: 13px; line-height: 20px; }
</style>
