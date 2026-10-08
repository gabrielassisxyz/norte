<script setup lang="ts">
import { computed, watch } from 'vue'

import Button from '@/components/ds/Button.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { useItemNotes } from '../data/composables'
import { notesGainedNote } from '../data/revision'

/**
 * Highlighting what the person has selected in the article, and marking in the
 * text what is already highlighted.
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

const anchored = computed(() =>
  (notesOfItem.value?.highlights ?? []).filter((highlight) => highlight.status === 'anchored')
)

async function highlightSelection(): Promise<void> {
  const selected = props.liveSelection
  if (!selected) return
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
  notesGainedNote()
  props.clearSelection()
}

/**
 * Wrap each anchored passage where it appears in the rendered article.
 *
 * Only a passage that sits inside one text node is wrapped. A selection
 * dragged across two paragraphs has no single node to wrap, and splitting the
 * markup to cover it would rewrite the article's own structure; such a
 * highlight is still listed beside the text, which is where an orphaned one is
 * listed too.
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
    markOnePassage(root, highlight.exact)
  }
}

function markOnePassage(root: HTMLElement, exact: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    const at = text.indexOf(exact)
    if (at >= 0 && node.parentElement) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + exact.length)
      const mark = document.createElement('mark')
      mark.className = 'notes-passage'
      mark.dataset.notesPassage = exact
      range.surroundContents(mark)
      return
    }
    node = walker.nextNode()
  }
}

watch([() => props.renderedAt, () => props.articleRoot, anchored], markPassages, { immediate: true })
</script>

<template>
  <div v-if="allowed" class="notes-highlight-action">
    <div v-if="liveSelection" class="notes-selection-bar" role="group" aria-label="Trecho selecionado">
      <blockquote class="notes-selection-quote">{{ liveSelection.exact }}</blockquote>
      <Button
        data-action="destacar"
        variant="primary"
        size="sm"
        :disabled="writing.pending.value"
        @click="highlightSelection"
      >
        Destacar
      </Button>
      <Button variant="secondary" size="sm" @click="clearSelection">Cancelar</Button>
    </div>
    <p v-if="writing.error.value" class="notes-highlight-error" role="alert">
      Não foi possível destacar: {{ writing.error.value }}
    </p>
  </div>
</template>

<style scoped>
.notes-highlight-action { margin-top: var(--space-4); }
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
.notes-highlight-error { margin: var(--space-2) 0 0; color: var(--danger); font-size: 13px; line-height: 20px; }
</style>
