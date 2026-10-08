import type { ReaderSlotProps } from './readerSlots'

/**
 * One set of reader slot props, with everything the contract requires filled in.
 *
 * A slot component is mounted on its own by several suites — the notes module's
 * reader actions, and the library's own reader tests — and every one of them had
 * to spell out the whole prop object. Adding a prop to the contract then breaks
 * each of those in turn rather than in one place, which is what this exists to
 * stop. Tests name it; nothing in the application does.
 */
export function readerSlotProps(overrides: Partial<ReaderSlotProps> = {}): ReaderSlotProps {
  return {
    itemId: 'item-1',
    savedSelection: null,
    liveSelection: null,
    clearSelection: () => {},
    articleRoot: null,
    renderedAt: 1,
    scrollToPassage: () => {},
    phone: false,
    openNotes: () => {},
    notesSection: null,
    ...overrides
  }
}
