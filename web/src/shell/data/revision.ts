import { reactive } from 'vue'

/**
 * Two counters that say "ask the core again", and what each one is for.
 *
 * `subjects` moves when the vocabulary itself changed — a subject created,
 * renamed, deleted, or flagged as a focus. Every list of subjects on screen is
 * then stale: the sidebar holds one, the Estudo home another, the picker a
 * third, and none can tell the others anything.
 *
 * `links` moves when something was linked or unlinked. It is kept apart so
 * linking an item does not re-read the subject lists, which would throw away
 * every page after the first on any of them.
 */
const state = reactive({ subjects: 0, links: 0 })

export function subjectsRevision(): number {
  return state.subjects
}

export function coreLinksRevision(): number {
  return state.links
}

/** The vocabulary changed: every subject list on screen is stale. */
export function subjectsChanged(): void {
  state.subjects += 1
}

/**
 * Something was linked. The per-subject counts come from the subject read, so
 * that is stale too -- which is why this bumps both.
 */
export function coreLinksChanged(): void {
  state.links += 1
  state.subjects += 1
}
