import { getCurrentScope, onScopeDispose, ref, shallowRef, type Ref } from 'vue'

/**
 * One asynchronous read, with the three states a screen has to render.
 *
 * `data` is null until the first answer arrives, which is what makes "loading"
 * and "empty" different states instead of the same empty array.
 */
export interface AsyncResource<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  refresh: () => Promise<void>
}

/** One write, kept apart from the read so a failed save leaves the page there. */
export interface AsyncAction {
  pending: Ref<boolean>
  error: Ref<string | null>
  run: <T>(work: () => Promise<T>) => Promise<T | null>
  clear: () => void
}

export function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  const text = String(cause ?? '')
  return text || 'erro desconhecido'
}

function wasAborted(signal: AbortSignal, cause: unknown): boolean {
  return signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')
}

/**
 * A read that supersedes itself.
 *
 * Every `refresh` aborts the request still in flight before starting its own,
 * so a second search, a filter change or a route change cannot be overtaken by
 * the answer to the question the user has already moved on from. The aborted
 * request writes nothing: neither its data nor its failure, which is why an
 * abort never surfaces as an error on screen.
 */
export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  options: { immediate?: boolean } = {}
): AsyncResource<T> {
  const immediate = options.immediate ?? true
  const data = shallowRef<T | null>(null)
  const loading = ref(immediate)
  const error = ref<string | null>(null)

  let inFlight: AbortController | null = null

  async function refresh(): Promise<void> {
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    loading.value = true
    error.value = null

    try {
      const value = await load(controller.signal)
      if (controller.signal.aborted) return
      data.value = value
    } catch (cause) {
      if (wasAborted(controller.signal, cause)) return
      error.value = describeFailure(cause)
    } finally {
      if (!controller.signal.aborted) loading.value = false
      if (inFlight === controller) inFlight = null
    }
  }

  if (getCurrentScope()) {
    // Leaving the screen is the same event as superseding its request: the
    // answer has nowhere to land once the view is gone.
    onScopeDispose(() => {
      inFlight?.abort()
      inFlight = null
    })
  }

  if (immediate) void refresh()

  return { data, loading, error, refresh }
}

/**
 * A write whose failure is reported without touching what is on screen.
 *
 * `run` answers with the source's own response, or with null when the write
 * failed — so a caller applies a value it was given and never one it sent.
 */
export function useAsyncAction(): AsyncAction {
  const pending = ref(false)
  const error = ref<string | null>(null)

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    pending.value = true
    error.value = null
    try {
      return await work()
    } catch (cause) {
      error.value = describeFailure(cause)
      return null
    } finally {
      pending.value = false
    }
  }

  function clear(): void {
    error.value = null
  }

  return { pending, error, run, clear }
}
