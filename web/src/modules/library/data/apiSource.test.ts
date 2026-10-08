import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiLibrarySource } from './apiSource'

// The browser resolves the real base ('/') against the page; Node's Request
// has no page and refuses a relative URL, so the test gives it an origin.
vi.mock('@/api/client', () => ({ apiBaseUrl: 'http://norte.test' }))

/**
 * `fetch` is stubbed, not the source: the thing under test is the request the
 * client builds and the way it reads the answer, which a fake source skips.
 */
// The client captures `fetch` when it is built, which is when the module under
// test is imported, so the stub has to be in place before that import runs.
const fetchStub = vi.hoisted(() => {
  const stub = vi.fn<(request: Request) => Promise<Response>>()
  globalThis.fetch = ((input: Request) => stub(input)) as typeof fetch
  return stub
})
const signal = new AbortController().signal

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function lastUrl(): URL {
  const request = fetchStub.mock.calls.at(-1)?.[0]
  if (!request) throw new Error('fetch was never called')
  return new URL(request.url, 'http://norte.test')
}

beforeEach(() => {
  fetchStub.mockReset()
})

describe('the library API source: list', () => {
  beforeEach(() => {
    fetchStub.mockImplementation(async () => json({ items: [], next_cursor: 'c2' }))
  })

  it('asks for the shelf and sends no filter that was not set', async () => {
    const page = await createApiLibrarySource().listItems({ view: 'depois', tipo: null, unread: null }, signal)

    const url = lastUrl()
    expect(url.pathname).toBe('/api/library/items')
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'depois' })
    expect(page).toEqual({ items: [], next_cursor: 'c2' })
  })

  it('sends the cursor of the page after the one held', async () => {
    await createApiLibrarySource().listItems({ view: 'tudo', cursor: 'c1', limit: 50 }, signal)

    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ view: 'tudo', cursor: 'c1', limit: '50' })
  })

  it('sends unread=false, which is a filter, and unread=true', async () => {
    const source = createApiLibrarySource()
    await source.listItems({ unread: false }, signal)
    expect(lastUrl().searchParams.get('unread')).toBe('false')

    await source.listItems({ unread: true }, signal)
    expect(lastUrl().searchParams.get('unread')).toBe('true')
  })

  it('sends the kind, the sort and the trimmed search text', async () => {
    await createApiLibrarySource().listItems({ tipo: 'post', sort: 'saved_desc', q: '  rust  ' }, signal)

    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ tipo: 'post', sort: 'saved_desc', q: 'rust' })
  })

  it('reports an absent next cursor as null', async () => {
    fetchStub.mockResolvedValue(json({ items: [] }))
    const page = await createApiLibrarySource().listItems({}, signal)
    expect(page.next_cursor).toBeNull()
  })

  it('throws the sentence the server wrote when the call fails', async () => {
    fetchStub.mockResolvedValue(json({ error: { code: 'bad_cursor', message: 'cursor inválido' } }, 400))

    await expect(createApiLibrarySource().listItems({ cursor: 'x' }, signal)).rejects.toThrow('cursor inválido')
  })

  it('falls back to the code, then to the status, when no sentence came', async () => {
    fetchStub.mockResolvedValueOnce(json({ error: { code: 'bad_cursor' } }, 400))
    await expect(createApiLibrarySource().listItems({}, signal)).rejects.toThrow('bad_cursor')

    fetchStub.mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
    await expect(createApiLibrarySource().listItems({}, signal)).rejects.toThrow('502')
  })
})

describe('the library API source: one item', () => {
  it('reads the item by its id', async () => {
    fetchStub.mockResolvedValue(json({ id: 'item-1', title: 'Um texto' }))
    const record = await createApiLibrarySource().getItem('item-1', signal)

    expect(lastUrl().pathname).toBe('/api/library/items/item-1')
    expect(record).toMatchObject({ id: 'item-1' })
  })

  it('answers null for not_found and throws for any other failure', async () => {
    fetchStub.mockResolvedValueOnce(json({ error: { code: 'not_found', message: 'sem item' } }, 404))
    expect(await createApiLibrarySource().getItem('nope', signal)).toBeNull()

    fetchStub.mockResolvedValueOnce(json({ error: { code: 'internal', message: 'quebrou' } }, 500))
    await expect(createApiLibrarySource().getItem('item-1', signal)).rejects.toThrow('quebrou')
  })
})

describe('the library API source: counts and writes', () => {
  it('reads the counts endpoint', async () => {
    const counts = { views: { inbox: 3, depois: 1, arquivo: 0, tudo: 4 }, kinds: {} }
    fetchStub.mockResolvedValue(json(counts))

    expect(await createApiLibrarySource().counts(signal)).toEqual(counts)
    expect(lastUrl().pathname).toBe('/api/library/counts')
  })

  it('saves, then reads the saved item again and returns that record', async () => {
    fetchStub.mockImplementation(async (request) => {
      const url = new URL(request.url, 'http://norte.test')
      if (request.method === 'POST') return json({ id: 'item-9' }, 201)
      return json({ id: url.pathname.split('/').at(-1), title: 'lido do servidor' })
    })

    const saved = await createApiLibrarySource().saveLink({ url: 'https://example.test/a', why: '  porque ' })

    const [post, get] = fetchStub.mock.calls.map(([request]) => request)
    expect(post.method).toBe('POST')
    expect(await post.clone().json()).toEqual({ url: 'https://example.test/a', why: 'porque' })
    expect(get.method).toBe('GET')
    expect(new URL(get.url, 'http://norte.test').pathname).toBe('/api/library/items/item-9')
    expect(saved).toMatchObject({ id: 'item-9', title: 'lido do servidor' })
  })

  it('sends link_to as the body field, and omits it when there is nothing to link', async () => {
    fetchStub.mockImplementation(async (request) => {
      const url = new URL(request.url, 'http://norte.test')
      if (request.method === 'POST') return json({ id: 'item-9' }, 201)
      return json({ id: url.pathname.split('/').at(-1) })
    })
    const source = createApiLibrarySource()

    await source.saveLink({ url: 'https://example.test/a', link_to: ['subject-1', 'subject-2'] })
    expect(await fetchStub.mock.calls[0][0].clone().json()).toEqual({
      url: 'https://example.test/a',
      link_to: ['subject-1', 'subject-2']
    })

    fetchStub.mockClear()
    await source.saveLink({ url: 'https://example.test/b', link_to: [] })
    expect(await fetchStub.mock.calls[0][0].clone().json()).toEqual({ url: 'https://example.test/b' })
  })

  it('patches the item and returns the record the server answered', async () => {
    fetchStub.mockResolvedValue(json({ id: 'item-1', unread: false }))
    const record = await createApiLibrarySource().patchItem('item-1', { unread: false })

    const request = fetchStub.mock.calls[0][0]
    expect(request.method).toBe('PATCH')
    expect(await request.clone().json()).toEqual({ unread: false })
    expect(record).toMatchObject({ unread: false })
  })
})
