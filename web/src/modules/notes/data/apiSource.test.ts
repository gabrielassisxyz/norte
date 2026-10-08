import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiNotesSource } from './apiSource'

// The browser resolves the real base ('/') against the page; Node's Request
// has no page and refuses a relative URL, so the test gives it an origin.
vi.mock('@/api/client', () => ({ apiBaseUrl: 'http://norte.test' }))

/**
 * `fetch` is stubbed, not the source: the thing under test is the request the
 * client builds and the way it reads the answer, which a fake source skips
 * entirely. A screen can pass every test against a fake while the wire is
 * wrong, and this is the suite that catches that.
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

function lastRequest(): Request {
  const request = fetchStub.mock.calls.at(-1)?.[0]
  if (!request) throw new Error('fetch was never called')
  return request
}

function lastUrl(): URL {
  return new URL(lastRequest().url, 'http://norte.test')
}

beforeEach(() => {
  fetchStub.mockReset()
})

describe('the notes API source: the four lists', () => {
  beforeEach(() => {
    fetchStub.mockImplementation(async () => json({ items: [], next_cursor: 'c2' }))
  })

  it('asks each list at its own path and sends no filter that was not set', async () => {
    const source = createApiNotesSource()

    for (const [call, path] of [
      [() => source.listHighlights({}, signal), '/api/notes/highlights'],
      [() => source.listAnnotations({}, signal), '/api/notes/annotations'],
      [() => source.listQuestions({}, signal), '/api/notes/questions'],
      [() => source.listQuestionSets({}, signal), '/api/notes/question-sets']
    ] as Array<[() => Promise<unknown>, string]>) {
      const page = await call()
      expect(lastUrl().pathname).toBe(path)
      expect(Object.fromEntries(lastUrl().searchParams)).toEqual({})
      expect(page).toEqual({ items: [], next_cursor: 'c2' })
    }
  })

  it('sends the item, the set, the state, the trimmed filter, the cursor and the limit', async () => {
    await createApiNotesSource().listQuestions(
      { item_id: 'item-1', set_id: 'set-1', status: 'open', q: '  parsing  ', cursor: 'c1', limit: 50 },
      signal
    )

    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({
      item_id: 'item-1',
      set_id: 'set-1',
      status: 'open',
      q: 'parsing',
      cursor: 'c1',
      limit: '50'
    })
  })

  it('sends no filter for a blank one, because that is not a narrowing', async () => {
    await createApiNotesSource().listHighlights({ item_id: '', q: '   ', cursor: '' }, signal)

    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({})
  })

  it('reports an absent next cursor as null', async () => {
    fetchStub.mockResolvedValue(json({ items: [] }))
    const page = await createApiNotesSource().listAnnotations({}, signal)

    expect(page.next_cursor).toBeNull()
  })

  it('throws the sentence the server wrote when the call fails', async () => {
    fetchStub.mockResolvedValue(json({ error: { code: 'invalid_cursor', message: 'cursor inválido' } }, 400))

    await expect(createApiNotesSource().listHighlights({ cursor: 'x' }, signal)).rejects.toThrow('cursor inválido')
  })

  it('falls back to the code, then to the status, when no sentence came', async () => {
    fetchStub.mockResolvedValueOnce(json({ error: { code: 'invalid_cursor' } }, 400))
    await expect(createApiNotesSource().listHighlights({}, signal)).rejects.toThrow('invalid_cursor')

    fetchStub.mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
    await expect(createApiNotesSource().listHighlights({}, signal)).rejects.toThrow('502')
  })
})

describe('the notes API source: a reader needs both lists of one item', () => {
  it('asks for the item highlights and the item annotations, each narrowed to it', async () => {
    fetchStub.mockImplementation(async () => json({ items: [{ id: 'row-1' }] }))

    const both = await createApiNotesSource().itemNotes('item-1', signal)

    const paths = fetchStub.mock.calls.map(([request]) => new URL(request.url, 'http://norte.test'))
    expect(paths.map((url) => url.pathname).sort()).toEqual([
      '/api/notes/annotations',
      '/api/notes/highlights'
    ])
    for (const url of paths) expect(url.searchParams.get('item_id')).toBe('item-1')
    expect(both.highlights).toHaveLength(1)
    expect(both.annotations).toHaveLength(1)
  })
})

describe('the notes API source: the one note an item carries', () => {
  it('reads it under the item in the path', async () => {
    fetchStub.mockResolvedValue(json({ item_id: 'item-1', text: '' }))

    const note = await createApiNotesSource().itemNote('item-1', signal)

    expect(lastUrl().pathname).toBe('/api/notes/items/item-1/note')
    expect(note).toEqual({ item_id: 'item-1', text: '' })
  })

  it('writes it with PUT and the text in the body', async () => {
    fetchStub.mockResolvedValue(json({ id: 'note-1', item_id: 'item-1', text: 'uma nota' }))

    const note = await createApiNotesSource().putItemNote('item-1', 'uma nota')

    expect(lastRequest().method).toBe('PUT')
    expect(lastUrl().pathname).toBe('/api/notes/items/item-1/note')
    expect(await lastRequest().clone().json()).toEqual({ text: 'uma nota' })
    expect(note).toMatchObject({ text: 'uma nota' })
  })
})

describe('the notes API source: the writes', () => {
  it('posts a highlight with the passage and the words around it', async () => {
    fetchStub.mockResolvedValue(json({ id: 'h-1', status: 'orphaned' }, 201))

    const created = await createApiNotesSource().addHighlight({
      item_id: 'item-1',
      exact: 'O trecho marcado.',
      prefix: 'Antes. ',
      suffix: ' Depois.'
    })

    expect(lastRequest().method).toBe('POST')
    expect(lastUrl().pathname).toBe('/api/notes/highlights')
    expect(await lastRequest().clone().json()).toEqual({
      item_id: 'item-1',
      exact: 'O trecho marcado.',
      prefix: 'Antes. ',
      suffix: ' Depois.'
    })
    // The record the server answered with, which is how a screen learns the
    // passage came back orphaned rather than anchored.
    expect(created).toMatchObject({ status: 'orphaned' })
  })

  it('deletes a highlight by its id and reports a failure to delete', async () => {
    fetchStub.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await createApiNotesSource().deleteHighlight('h-1')

    expect(lastRequest().method).toBe('DELETE')
    expect(lastUrl().pathname).toBe('/api/notes/highlights/h-1')

    fetchStub.mockResolvedValueOnce(json({ error: { code: 'not_found', message: 'sem highlight' } }, 404))
    await expect(createApiNotesSource().deleteHighlight('h-2')).rejects.toThrow('sem highlight')
  })

  it('posts an annotation, with the highlight it hangs on when it hangs on one', async () => {
    fetchStub.mockResolvedValue(json({ id: 'a-1' }, 201))

    await createApiNotesSource().addAnnotation({ item_id: 'item-1', text: 'anotar', highlight_id: 'h-1' })

    expect(lastUrl().pathname).toBe('/api/notes/annotations')
    expect(await lastRequest().clone().json()).toEqual({
      item_id: 'item-1',
      text: 'anotar',
      highlight_id: 'h-1'
    })
  })

  it('posts a question with only the fields it was given', async () => {
    fetchStub.mockResolvedValue(json({ id: 'q-1' }, 201))

    await createApiNotesSource().addQuestion({ text: 'Por que isto?' })

    expect(lastUrl().pathname).toBe('/api/notes/questions')
    expect(await lastRequest().clone().json()).toEqual({ text: 'Por que isto?' })
  })

  it('posts a question set with the prompts that were filled in', async () => {
    fetchStub.mockResolvedValue(json({ id: 'set-1', topic: 'Kubernetes', question_count: 1, questions: [] }, 201))

    const created = await createApiNotesSource().addQuestionSet({
      topic: 'Kubernetes',
      questions: [{ kind: 'why', text: 'Por que um pod?' }]
    })

    expect(lastUrl().pathname).toBe('/api/notes/question-sets')
    expect(await lastRequest().clone().json()).toEqual({
      topic: 'Kubernetes',
      questions: [{ kind: 'why', text: 'Por que um pod?' }]
    })
    expect(created).toMatchObject({ id: 'set-1' })
  })
})

describe('the notes API source: one question set', () => {
  it('reads the set by its id', async () => {
    fetchStub.mockResolvedValue(json({ id: 'set-1', topic: 'Kubernetes', question_count: 0, questions: [] }))

    const set = await createApiNotesSource().questionSet('set-1', signal)

    expect(lastUrl().pathname).toBe('/api/notes/question-sets/set-1')
    expect(set).toMatchObject({ id: 'set-1' })
  })

  it('answers null for not_found and throws for any other failure', async () => {
    fetchStub.mockResolvedValueOnce(json({ error: { code: 'not_found', message: 'sem conjunto' } }, 404))
    expect(await createApiNotesSource().questionSet('nope', signal)).toBeNull()

    fetchStub.mockResolvedValueOnce(json({ error: { code: 'internal', message: 'quebrou' } }, 500))
    await expect(createApiNotesSource().questionSet('set-1', signal)).rejects.toThrow('quebrou')
  })
})

describe('the notes API source: the counts', () => {
  it('reads the counts endpoint', async () => {
    const counts = { highlights: 3, anotacoes: 2, perguntas: 1, conjuntos: 0 }
    fetchStub.mockResolvedValue(json(counts))

    expect(await createApiNotesSource().counts(signal)).toEqual(counts)
    expect(lastUrl().pathname).toBe('/api/notes/counts')
  })
})
