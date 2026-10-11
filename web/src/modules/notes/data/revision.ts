import { reactive } from 'vue'

/**
 * Two counters that say "ask the server again", and what each one is for.
 *
 * A created note comes back from the write itself, so a list already holding it
 * needs no new read — and must not make one, because re-reading a paginated
 * list would throw away every page after the first. The counts are the
 * opposite: they are totals over every note, no write response carries them,
 * and the sidebar and the Notes tabs hold separate copies that cannot tell each
 * other anything. So every write bumps `counts`, and only a creation on a
 * screen that is not holding the row bumps `notes`.
 */
const state = reactive({ notes: 0, counts: 0 })

export function notesRevision(): number {
  return state.notes
}

export function notesCountsRevision(): number {
  return state.counts
}

/** A write that changed a note the screen already holds. */
export function noteChanged(): void {
  state.counts += 1
}

/** A creation a screen cannot place itself: every open list is missing a row. */
export function notesGainedNote(): void {
  state.notes += 1
  state.counts += 1
}
