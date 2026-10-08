import type { Component } from 'vue'

import type { TextSelection } from './data/source'

/**
 * The passage the person has selected in the article right now, measured
 * against the article's own text rather than against the DOM.
 *
 * The offsets of a DOM selection have no relation to the offsets of the text
 * the server extracted, so what travels is the words: the passage and the 32
 * code points on each side of it. The server anchors from those.
 */
export interface ReaderLiveSelection {
  exact: string
  prefix: string
  suffix: string
}

/** What the reader hands whatever fills one of its slots. */
export interface ReaderSlotProps {
  /** The item being read, by its registry id. */
  itemId: string
  /** The passage captured when the link was saved, or null. */
  savedSelection: TextSelection | null
  /** What is selected in the article now, or null. */
  liveSelection: ReaderLiveSelection | null
  /** Drop the live selection, which is what a slot does once it has used it. */
  clearSelection: () => void
  /** The article's root element, or null before the text has rendered. */
  articleRoot: HTMLElement | null
  /**
   * Bumped every time the article's markup is re-rendered.
   *
   * A slot that decorated the text has to decorate it again: a re-extraction
   * replaces `content_html`, Vue replaces the markup wholesale, and every node
   * a slot had wrapped is gone with it.
   */
  renderedAt: number
  /** Put the passage in view, using the reader's own measurement of the column. */
  scrollToPassage: (exact: string) => void
}

/** The places the reader lets another module render into. */
export type ReaderSlotName = 'selection-actions' | 'notes'

export interface ReaderSlotEntry {
  id: string
  name: ReaderSlotName
  order: number
  component: Component
}

/**
 * What the reader renders in each of its slots.
 *
 * The library owns the registry and the props; another module fills a slot from
 * its own `index.ts`, which is the only place a module's wiring happens. The
 * direction matters: the library never names the module that fills a slot, so a
 * reader with that module switched off simply has nothing registered and
 * renders none of it.
 */
const entries: ReaderSlotEntry[] = []

export function registerReaderSlot(entry: ReaderSlotEntry): void {
  const existing = entries.findIndex((candidate) => candidate.id === entry.id)
  // Registering twice is a module's `index.ts` being imported twice, which the
  // shell does; the second one replaces the first rather than doubling it.
  if (existing >= 0) entries.splice(existing, 1, entry)
  else entries.push(entry)
}

export function readerSlotEntries(name: ReaderSlotName): ReaderSlotEntry[] {
  return entries.filter((entry) => entry.name === name).sort((first, second) => first.order - second.order)
}

/** Test seam: a test that mounts the reader decides what is registered. */
export function clearReaderSlots(): void {
  entries.length = 0
}
