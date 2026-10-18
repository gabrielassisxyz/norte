import { ref } from 'vue'

/**
 * The note waiting for a passage, while the person picks one in the article.
 *
 * It is module state rather than a prop for the same reason `revision` is: the
 * two halves of the reader that have to agree about it are separate slot
 * components with no parent between them. The notes panel under the article
 * starts the wait and makes the two requests; the passage layer over the
 * article has to know that the next selection is not its own to highlight.
 */
const waiting = ref<string | null>(null)

/** The annotation a passage is being picked for, or null when none is. */
export function annotationAwaitingPassage(): string | null {
  return waiting.value
}

export function beginPassageAttach(annotationId: string): void {
  waiting.value = annotationId
}

export function endPassageAttach(): void {
  waiting.value = null
}
