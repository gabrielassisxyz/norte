import { reactive } from 'vue'

/**
 * A counter that says "the library has gained an item".
 *
 * A change to a row can be applied straight from the write's response, but a
 * creation cannot: a list that was read before the item existed has no row to
 * replace, and the two home blocks are separate components that cannot tell
 * each other anything. Bumping this makes every open library read ask again,
 * which is what a cache does after a write.
 */
const state = reactive({ revision: 0 })

export function libraryRevision(): number {
  return state.revision
}

export function libraryGainedItem(): void {
  state.revision += 1
}
