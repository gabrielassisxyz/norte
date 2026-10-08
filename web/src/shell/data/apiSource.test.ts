import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiCoreSource } from './apiSource'

// The browser resolves the real base ('/') against the page; Node's Request
// has no page and refuses a relative URL, so the test gives it an origin.
vi.mock('@/api/client', async () => {
  const { default: createClient } = await import('openapi-fetch')
  return { apiBaseUrl: 'http://norte.test', coreClient: createClient({ baseUrl: 'http://norte.test' }) }
})

// `fetch` is stubbed, not the source: the thing under test is the request the
// client builds and the way it reads the answer, which a fake source skips.
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

function lastRequest(): Request {
  const request = fetchStub.mock.calls.at(-1)?.[0]
  if (!request) throw new Error('fetch was never called')
  return request
}

function lastUrl(): URL {
  return new URL(lastRequest().url, 'http://norte.test')
}

function failure(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status)
}

beforeEach(() => {
  fetchStub.mockReset()
})

describe('the core API source: subjects', () => {
  it('lists subjects and sends only the filters that were set, trimming the search', async () => {
    fetchStub.mockResolvedValue(json({ items: [{ id: 's1' }], next_cursor: 'c2' }))

    const page = await createApiCoreSource().listSubjects({ q: '  rust  ', cursor: 'c1', limit: 50 }, signal)

    expect(lastRequest().method).toBe('GET')
    expect(lastUrl().pathname).toBe('/api/core/subjects')
    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ q: 'rust', cursor: 'c1', limit: '50' })
    expect(page).toEqual({ items: [{ id: 's1' }], next_cursor: 'c2' })
  })

  it('sends no query at all for an empty search and reports an absent cursor as null', async () => {
    fetchStub.mockResolvedValue(json({ items: [] }))

    const page = await createApiCoreSource().listSubjects({ q: '   ' }, signal)

    expect(lastUrl().search).toBe('')
    expect(page.next_cursor).toBeNull()
  })

  it('throws the sentence the server wrote when listing fails', async () => {
    fetchStub.mockResolvedValue(failure('invalid_cursor', 'cursor de outra busca', 400))
    await expect(createApiCoreSource().listSubjects({ cursor: 'x' }, signal)).rejects.toThrow('cursor de outra busca')
  })

  it('falls back to the code, then to the status, when no sentence came', async () => {
    fetchStub.mockResolvedValueOnce(json({ error: { code: 'invalid_cursor' } }, 400))
    await expect(createApiCoreSource().listSubjects({}, signal)).rejects.toThrow('invalid_cursor')

    fetchStub.mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
    await expect(createApiCoreSource().listSubjects({}, signal)).rejects.toThrow('502')
  })

  it('reads a subject by its slug, answers null for not_found and throws otherwise', async () => {
    fetchStub.mockResolvedValueOnce(json({ id: 's1', slug: 'escrita' }))
    const subject = await createApiCoreSource().getSubjectBySlug('escrita', signal)
    expect(lastUrl().pathname).toBe('/api/core/subjects/by-slug/escrita')
    expect(subject).toMatchObject({ id: 's1' })

    fetchStub.mockResolvedValueOnce(failure('not_found', 'sem assunto', 404))
    expect(await createApiCoreSource().getSubjectBySlug('nada', signal)).toBeNull()

    fetchStub.mockResolvedValueOnce(failure('internal', 'quebrou', 500))
    await expect(createApiCoreSource().getSubjectBySlug('escrita', signal)).rejects.toThrow('quebrou')
  })

  it('reads a subject by its id, answers null for not_found and throws otherwise', async () => {
    fetchStub.mockResolvedValueOnce(json({ id: 's1', link_count: 4 }))
    const subject = await createApiCoreSource().getSubject('s1', signal)
    expect(lastUrl().pathname).toBe('/api/core/subjects/s1')
    expect(subject).toMatchObject({ link_count: 4 })

    fetchStub.mockResolvedValueOnce(failure('not_found', 'sem assunto', 404))
    expect(await createApiCoreSource().getSubject('nada', signal)).toBeNull()

    fetchStub.mockResolvedValueOnce(failure('internal', 'quebrou', 500))
    await expect(createApiCoreSource().getSubject('s1', signal)).rejects.toThrow('quebrou')
  })

  it('creates a subject with the name as the body and returns the record', async () => {
    fetchStub.mockResolvedValue(json({ id: 's2', name: 'Escrita' }, 201))

    const subject = await createApiCoreSource().createSubject('Escrita')

    expect(lastRequest().method).toBe('POST')
    expect(lastUrl().pathname).toBe('/api/core/subjects')
    expect(await lastRequest().clone().json()).toEqual({ name: 'Escrita' })
    expect(subject).toMatchObject({ id: 's2' })
  })

  it('throws the server sentence when the slug is taken', async () => {
    fetchStub.mockResolvedValue(failure('slug_taken', 'o slug "escrita" já existe', 409))
    await expect(createApiCoreSource().createSubject('Escrita')).rejects.toThrow('o slug "escrita" já existe')
  })

  it('patches a subject by id with only the fields given', async () => {
    fetchStub.mockResolvedValue(json({ id: 's1', focus: true }))

    const subject = await createApiCoreSource().patchSubject('s1', { focus: true })

    expect(lastRequest().method).toBe('PATCH')
    expect(lastUrl().pathname).toBe('/api/core/subjects/s1')
    expect(await lastRequest().clone().json()).toEqual({ focus: true })
    expect(subject).toMatchObject({ focus: true })
  })

  it('deletes by id, resolves on a 204 and throws the sentence on failure', async () => {
    fetchStub.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(createApiCoreSource().deleteSubject('s1')).resolves.toBeUndefined()
    expect(lastRequest().method).toBe('DELETE')
    expect(lastUrl().pathname).toBe('/api/core/subjects/s1')

    fetchStub.mockResolvedValueOnce(failure('not_found', 'sem assunto', 404))
    await expect(createApiCoreSource().deleteSubject('s1')).rejects.toThrow('sem assunto')
  })
})

describe('the core API source: focus', () => {
  it('reads the focus endpoint', async () => {
    const focus = { subjects: [], targets: [{ id: 'c1', type: 'course', title: 'Rust' }] }
    fetchStub.mockResolvedValue(json(focus))

    expect(await createApiCoreSource().focus(signal)).toEqual(focus)
    expect(lastRequest().method).toBe('GET')
    expect(lastUrl().pathname).toBe('/api/core/focus')
  })

  it('throws when the focus cannot be read', async () => {
    fetchStub.mockResolvedValue(failure('internal', 'um módulo falhou', 500))
    await expect(createApiCoreSource().focus(signal)).rejects.toThrow('um módulo falhou')
  })
})

describe('the core API source: links', () => {
  it('sends every filter that was set, status included, and none that was not', async () => {
    fetchStub.mockResolvedValue(json({ items: [], next_cursor: 'n2' }))

    const page = await createApiCoreSource().listLinks(
      { dst_id: 'd1', src_id: 's1', kind: 'about', status: 'confirmed', cursor: 'c1', limit: 20 },
      signal
    )

    expect(lastRequest().method).toBe('GET')
    expect(lastUrl().pathname).toBe('/api/core/links')
    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({
      dst_id: 'd1',
      src_id: 's1',
      kind: 'about',
      status: 'confirmed',
      cursor: 'c1',
      limit: '20'
    })
    expect(page).toEqual({ items: [], next_cursor: 'n2' })
  })

  it('lists the suggestion queue with the status alone', async () => {
    fetchStub.mockResolvedValue(json({ items: [] }))

    const page = await createApiCoreSource().listLinks({ status: 'suggested' }, signal)

    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ status: 'suggested' })
    expect(page.next_cursor).toBeNull()
  })

  it('throws the server sentence when the cursor belongs to other filters', async () => {
    fetchStub.mockResolvedValue(failure('invalid_cursor', 'o cursor é de outro filtro', 400))
    await expect(createApiCoreSource().listLinks({ cursor: 'x' }, signal)).rejects.toThrow('o cursor é de outro filtro')
  })

  it('creates a link from the source to the target, about by default', async () => {
    fetchStub.mockResolvedValue(json({ id: 'l1', status: 'confirmed' }, 201))

    const link = await createApiCoreSource().createLink('item-1', 'subject-1')

    expect(lastRequest().method).toBe('POST')
    expect(lastUrl().pathname).toBe('/api/core/links')
    expect(await lastRequest().clone().json()).toEqual({ src_id: 'item-1', dst_id: 'subject-1', kind: 'about' })
    expect(link).toMatchObject({ id: 'l1' })
  })

  it('sends the kind it was given', async () => {
    fetchStub.mockResolvedValue(json({ id: 'l1' }, 201))
    await createApiCoreSource().createLink('a', 'b', 'material_of')
    expect(await lastRequest().clone().json()).toEqual({ src_id: 'a', dst_id: 'b', kind: 'material_of' })
  })

  it('throws the server sentence when an end is not in the registry', async () => {
    fetchStub.mockResolvedValue(failure('unknown_item', 'src_id não está no registro', 400))
    await expect(createApiCoreSource().createLink('x', 'y')).rejects.toThrow('src_id não está no registro')
  })

  it('decides a link by id with the decision as the body', async () => {
    fetchStub.mockResolvedValue(json({ id: 'l1', status: 'rejected' }))

    const link = await createApiCoreSource().decideLink('l1', 'reject')

    expect(lastRequest().method).toBe('POST')
    expect(lastUrl().pathname).toBe('/api/core/links/l1/decide')
    expect(await lastRequest().clone().json()).toEqual({ decision: 'reject' })
    expect(link).toMatchObject({ status: 'rejected' })
  })

  it('throws the server sentence when the link is not a suggestion', async () => {
    fetchStub.mockResolvedValue(failure('not_suggested', 'só uma sugestão pode ser decidida', 409))
    await expect(createApiCoreSource().decideLink('l1', 'accept')).rejects.toThrow('só uma sugestão pode ser decidida')
  })
})
