import { reactive } from 'vue'

/**
 * Two counters that say "ask the server again", and what each one is for.
 *
 * A change to a row comes back from the write itself, so a list already holding
 * that row needs no new read — and must not make one, because re-reading a
 * paginated list would throw away every page after the first. The counts are
 * the opposite: they are totals over the whole library, no write response
 * carries them, and the sidebar and the screen hold separate copies that cannot
 * tell each other anything. So every write bumps `counts`, and only a creation
 * bumps `items`: a list read before the item existed has no row to replace.
 */
const state = reactive({ items: 0, counts: 0 })

export function libraryRevision(): number {
  return state.items
}

export function libraryCountsRevision(): number {
  return state.counts
}

/** A write that changed a row: the totals may have moved, the pages have not. */
export function libraryItemChanged(): void {
  state.counts += 1
}

/** A creation: every open list is now missing a row, and the totals have moved. */
export function libraryGainedItem(): void {
  state.items += 1
  state.counts += 1
}
