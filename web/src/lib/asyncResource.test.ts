import { describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { useAsyncAction, useAsyncResource } from './asyncResource'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

describe('useAsyncResource', () => {
  it('is loading with no data until the first answer arrives', async () => {
    const first = deferred<string[]>()
    const resource = useAsyncResource(() => first.promise)

    expect(resource.loading.value).toBe(true)
    expect(resource.data.value).toBeNull()

    first.resolve(['um'])
    await nextTick()

    expect(resource.loading.value).toBe(false)
    expect(resource.data.value).toEqual(['um'])
    expect(resource.error.value).toBeNull()
  })

  it('reports a failure and keeps the data it already had', async () => {
    let attempt = 0
    const resource = useAsyncResource(() => {
      attempt += 1
      return attempt === 1 ? Promise.resolve('primeiro') : Promise.reject(new Error('sem rede'))
    })

    await nextTick()
    expect(resource.data.value).toBe('primeiro')

    await resource.refresh()
    expect(resource.error.value).toBe('sem rede')
    expect(resource.data.value).toBe('primeiro')
    expect(resource.loading.value).toBe(false)
  })

  it('aborts the request in flight when a second one starts', async () => {
    const signals: AbortSignal[] = []
    const pending: Array<Deferred<string>> = []
    const resource = useAsyncResource((signal) => {
      signals.push(signal)
      const next = deferred<string>()
      pending.push(next)
      return next.promise
    })

    void resource.refresh()

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    // The superseded answer lands late and must be thrown away.
    pending[0].resolve('antigo')
    pending[1].resolve('novo')
    await nextTick()
    await nextTick()

    expect(resource.data.value).toBe('novo')
  })

  it('swallows the failure of a request that was superseded', async () => {
    const pending: Array<Deferred<string>> = []
    const resource = useAsyncResource(() => {
      const next = deferred<string>()
      pending.push(next)
      return next.promise
    })

    void resource.refresh()
    pending[0].reject(new Error('cancelado'))
    pending[1].resolve('novo')
    await nextTick()
    await nextTick()

    expect(resource.error.value).toBeNull()
    expect(resource.data.value).toBe('novo')
  })

  it('aborts in flight when the scope that owns it is disposed', () => {
    const signals: AbortSignal[] = []
    const scope = effectScope()
    scope.run(() => {
      useAsyncResource((signal) => {
        signals.push(signal)
        return deferred<string>().promise
      })
    })

    expect(signals[0].aborted).toBe(false)
    scope.stop()
    expect(signals[0].aborted).toBe(true)
  })

  it('waits for an explicit refresh when asked not to load immediately', async () => {
    let calls = 0
    const resource = useAsyncResource(
      () => {
        calls += 1
        return Promise.resolve('agora')
      },
      { immediate: false }
    )

    expect(calls).toBe(0)
    expect(resource.loading.value).toBe(false)

    await resource.refresh()
    expect(calls).toBe(1)
    expect(resource.data.value).toBe('agora')
  })
})

describe('useAsyncAction', () => {
  it('answers with the source\'s response', async () => {
    const action = useAsyncAction()
    const result = await action.run(() => Promise.resolve({ id: 'a-1' }))

    expect(result).toEqual({ id: 'a-1' })
    expect(action.error.value).toBeNull()
    expect(action.pending.value).toBe(false)
  })

  it('answers with null and the message when the write fails', async () => {
    const action = useAsyncAction()
    const result = await action.run(() => Promise.reject(new Error('conflito')))

    expect(result).toBeNull()
    expect(action.error.value).toBe('conflito')

    action.clear()
    expect(action.error.value).toBeNull()
  })
})
