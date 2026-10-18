import { ref } from 'vue'

/**
 * What the next selection in the article is for, while the person makes it.
 *
 * It is module state rather than a prop for the same reason `revision` is: the
 * parts of the reader that have to agree about it are separate slot components
 * with no parent between them. The notes panel under the article starts either
 * wait; the passage layer over the article has to know that the next selection
 * is not its own to highlight.
 *
 * The two waits are one value because they are the same gesture asked for by
 * two different rows, and a selection can only answer one of them: starting
 * either ends the other, instead of leaving two banners over the article and
 * two components racing for the same words.
 */
type PassageWait =
  /** A note that hangs on nothing, waiting for the passage it is about. */
  | { kind: 'attach'; id: string }
  /** A highlight whose passage is being corrected, waiting for the new one. */
  | { kind: 'reselect'; id: string }

const waiting = ref<PassageWait | null>(null)

/** The annotation a passage is being picked for, or null when none is. */
export function annotationAwaitingPassage(): string | null {
  return waiting.value?.kind === 'attach' ? waiting.value.id : null
}

export function beginPassageAttach(annotationId: string): void {
  waiting.value = { kind: 'attach', id: annotationId }
}

export function endPassageAttach(): void {
  waiting.value = null
}

/** The highlight whose passage is being re-selected, or null when none is. */
export function highlightAwaitingPassage(): string | null {
  return waiting.value?.kind === 'reselect' ? waiting.value.id : null
}

export function beginPassageReselect(highlightId: string): void {
  waiting.value = { kind: 'reselect', id: highlightId }
}

export function endPassageReselect(): void {
  waiting.value = null
}

/** Whether the next selection belongs to one of the waits rather than to the passage layer. */
export function passageSelectionIsAwaited(): boolean {
  return waiting.value !== null
}
