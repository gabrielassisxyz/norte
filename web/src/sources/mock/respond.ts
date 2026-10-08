/**
 * How a mock source answers.
 *
 * Two properties matter and neither is about pretending to be slow. The answer
 * arrives on a later microtask, so a screen really does render its loading
 * state first instead of being handed data during setup; and it is detached
 * from the store, so a screen cannot reach through a response into the data
 * behind it. That second one is what keeps "update only from the response"
 * meaningful: with a shared reactive object, every write would appear to work
 * even when nothing applied it.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export function detach<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export async function answer<T>(produce: () => T, signal?: AbortSignal): Promise<T> {
  await Promise.resolve()
  throwIfAborted(signal)
  return detach(produce())
}

/** Lower-case and unaccented, which is how every search here compares text. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

export function searchMatches(term: string, ...fields: Array<string | undefined>): boolean {
  const needle = normalizeSearch(term)
  if (!needle) return true
  return normalizeSearch(fields.filter(Boolean).join(' ')).includes(needle)
}
