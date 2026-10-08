import { readonly, ref, type Ref } from 'vue'

/**
 * A screen asking the shell to open the command palette, with what the person
 * had already typed.
 *
 * It is module state rather than a prop or an emit because the asker and the
 * palette are nowhere near each other: a search box lives inside a route view
 * — Início's, Estudo's — and the palette lives in `AppShell`, above the router
 * outlet. Threading an event up through whatever view happens to be mounted
 * would make every screen in between know about a palette it does not own.
 *
 * The counter is what makes the same text asked for twice two requests. A box
 * holding "memória" that is submitted again has to reopen the palette, and a
 * watcher on the text alone would see no change and do nothing.
 */
const requested = ref<{ query: string; count: number } | null>(null)
let count = 0

/** Ask the shell to open the palette, carrying the text to search for. */
export function requestPaletteSearch(query = ''): void {
  count += 1
  requested.value = { query, count }
}

/** The outstanding request, for the shell to watch. */
export function paletteRequest(): Readonly<Ref<{ query: string; count: number } | null>> {
  return readonly(requested)
}

/**
 * Forget the outstanding request. It is a test seam: the shell never clears
 * what it only consumes, so without this one case's hand-over would still be
 * standing in the next one.
 */
export function clearPaletteRequest(): void {
  requested.value = null
}
