import { reactive } from 'vue'

/**
 * A navigation that never arrived, so that the shell can say so.
 *
 * Every screen behind the sidebar is a dynamic import, which means a click on a
 * screen nobody has visited yet is a network request. With the server gone that
 * request fails, vue-router abandons the navigation, and the address bar, the
 * sidebar and the main area all keep showing the screen the person was already
 * on — the click looks ignored. This records the address that failed so the
 * shell can offer the one action that can still work: ask for it again.
 */
export const shellNavigationFailure = reactive<{ path: string | null }>({ path: null })

export function reportShellNavigationFailure(path: string): void {
  shellNavigationFailure.path = path
}

export function clearShellNavigationFailure(): void {
  shellNavigationFailure.path = null
}

/**
 * Whether an error vue-router reported is a chunk that would not load.
 *
 * A guard that throws, a redirect loop and a failed import all reach
 * `router.onError`, and only the last one is worth offering a retry for: the
 * other two would fail again identically. Browsers disagree on the message
 * ("Failed to fetch dynamically imported module", "error loading dynamically
 * imported module"), so the match is on the words they share rather than on a
 * whole sentence, and `vite:preloadError` carries its own marker.
 */
export function isShellChunkLoadFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const message = String((error as { message?: unknown }).message ?? '')
  if (/dynamically imported module/i.test(message)) return true
  if (/importing a module script failed/i.test(message)) return true
  return /loading chunk/i.test(message)
}
