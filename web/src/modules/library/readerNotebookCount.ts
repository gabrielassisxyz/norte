import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/**
 * How many passages the article currently shows as highlighted.
 *
 * The reader holds no notes of its own, and asking the notes module for a count
 * would make the library name it, so the number is read off the text: the
 * panel in the `notes` slot marks every highlight it anchors, which is the one
 * place the reader already looks for them (`scrollToPassage`). Distinct passages
 * are counted, because one highlight that crosses a paragraph is several marks.
 *
 * The marks arrive after the text has rendered and change while the panel is
 * used, so the count follows the text's own mutations instead of being measured
 * once.
 */
export function useMarkedPassageCount(root: Ref<HTMLElement | null>): Ref<number> {
  const count = ref(0)
  let observer: MutationObserver | null = null

  function measure(): void {
    const passages = new Set<string>()
    for (const mark of root.value?.querySelectorAll<HTMLElement>('[data-notes-passage]') ?? []) {
      passages.add(mark.dataset.notesPassage ?? '')
    }
    count.value = passages.size
  }

  watch(
    root,
    (element) => {
      observer?.disconnect()
      observer = null
      measure()
      if (!element || typeof MutationObserver === 'undefined') return
      observer = new MutationObserver(measure)
      observer.observe(element, { childList: true, subtree: true })
    },
    { immediate: true }
  )

  onBeforeUnmount(() => observer?.disconnect())
  return count
}
