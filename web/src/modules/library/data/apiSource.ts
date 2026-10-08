import createClient from 'openapi-fetch'

import { apiBaseUrl } from '@/api/client'
import type { paths } from '@/api/library'

import type {
  ExtractAck,
  LibraryCounts,
  LibraryDrawQuery,
  LibraryItemList,
  LibraryItemRecord,
  LibraryItemSummary,
  LibraryListQuery,
  LibraryPatch,
  LibrarySource,
  NewSavedLink
} from './source'

/**
 * The library's own HTTP client, typed from `api/openapi/library.yaml`.
 *
 * It is constructed here rather than beside the core client so that the core
 * client does not carry the library's paths. `main.ts` installs this source
 * unconditionally; whether the server lists the module decides only whether
 * the library's screens are mounted, and an unmounted screen never calls it.
 */
const libraryClient = createClient<paths>({ baseUrl: apiBaseUrl })

interface ApiFailure {
  error?: { code?: string; message?: string }
}

/**
 * The message a failed call reports.
 *
 * The contract's envelope carries a sentence written for a person, so that is
 * what the screen shows; a failure that arrived without one (a proxy, a dropped
 * connection) falls back to the status, which is still more than "erro".
 */
function failureMessage(failure: unknown, status: number): string {
  const detail = (failure as ApiFailure | undefined)?.error
  if (detail?.message) return detail.message
  if (detail?.code) return detail.code
  return `a resposta do servidor foi ${status || 'vazia'}`
}

function failureCode(failure: unknown): string | undefined {
  return (failure as ApiFailure | undefined)?.error?.code
}

interface Answered<T> {
  data?: T
  error?: unknown
  response: Response
}

/** The body of a successful call, or a thrown error carrying the API's message. */
function unwrap<T>(answered: Answered<T>): T {
  if (answered.error !== undefined || answered.data === undefined) {
    throw new Error(failureMessage(answered.error, answered.response?.status ?? 0))
  }
  return answered.data
}

/**
 * The query as the contract spells it.
 *
 * An absent filter and a filter set to null are the same request — "do not
 * narrow by this" — so neither reaches the wire. `unread: false` is a filter
 * (read items only) and does reach it, which is why the check is against null
 * and undefined rather than falsiness.
 */
function listQuery(query: LibraryListQuery): Record<string, string | number | boolean> {
  const sent: Record<string, string | number | boolean> = {}
  if (query.view) sent.view = query.view
  if (query.tipo) sent.tipo = query.tipo
  if (query.unread !== null && query.unread !== undefined) sent.unread = query.unread
  if (query.sort) sent.sort = query.sort
  if (query.q?.trim()) sent.q = query.q.trim()
  if (query.cursor) sent.cursor = query.cursor
  if (query.limit) sent.limit = query.limit
  return sent
}

/**
 * A draw as the contract spells it.
 *
 * `away_from_focus: false` is a request for a uniform draw and does reach the
 * wire, so the check is against undefined rather than falsiness — the same
 * reason `unread: false` is sent above.
 */
function drawQuery(query: LibraryDrawQuery): Record<string, string | number | boolean> {
  const sent: Record<string, string | number | boolean> = {}
  if (query.away_from_focus !== undefined) sent.away_from_focus = query.away_from_focus
  if (query.n !== undefined) sent.n = query.n
  if (query.seed !== undefined) sent.seed = query.seed
  return sent
}

export function createApiLibrarySource(): LibrarySource {
  return {
    async listItems(query: LibraryListQuery, signal: AbortSignal): Promise<LibraryItemList> {
      const answered = await libraryClient.GET('/api/library/items', {
        params: { query: listQuery(query) },
        signal
      })
      const page = unwrap(answered as Answered<{ items: LibraryItemList['items']; next_cursor?: string }>)
      return { items: page.items, next_cursor: page.next_cursor ?? null }
    },

    async getItem(id: string, signal: AbortSignal): Promise<LibraryItemRecord | null> {
      const answered = await libraryClient.GET('/api/library/items/{id}', {
        params: { path: { id } },
        signal
      })
      // An id that is not there is a page of its own, not a failure to report.
      if (failureCode(answered.error) === 'not_found') return null
      return unwrap(answered as Answered<LibraryItemRecord>)
    },

    async counts(signal: AbortSignal): Promise<LibraryCounts> {
      return unwrap((await libraryClient.GET('/api/library/counts', { signal })) as Answered<LibraryCounts>)
    },

    async saveLink(link: NewSavedLink): Promise<LibraryItemRecord> {
      const answered = await libraryClient.POST('/api/library/items', {
        body: {
          url: link.url,
          ...(link.why?.trim() ? { why: link.why.trim() } : {}),
          ...(link.link_to?.length ? { link_to: link.link_to } : {})
        }
      })
      const saved = unwrap(answered as Answered<{ id: string }>)
      // The save answers with an id; the dialog has to show the item, and the
      // record it should show is the one the server now holds — including the
      // title and kind a deduplicated save kept.
      const record = await this.getItem(saved.id, new AbortController().signal)
      if (!record) throw new Error(`o item ${saved.id} foi salvo e não pôde ser lido`)
      return record
    },

    async patchItem(id: string, patch: LibraryPatch): Promise<LibraryItemRecord> {
      const answered = await libraryClient.PATCH('/api/library/items/{id}', {
        params: { path: { id } },
        body: patch
      })
      return unwrap(answered as Answered<LibraryItemRecord>)
    },

    async openItem(id: string): Promise<LibraryItemRecord> {
      const answered = await libraryClient.POST('/api/library/items/{id}/open', {
        params: { path: { id } }
      })
      return unwrap(answered as Answered<LibraryItemRecord>)
    },

    async extractItem(id: string): Promise<ExtractAck> {
      const answered = await libraryClient.POST('/api/library/items/{id}/extract', {
        params: { path: { id } },
        body: {}
      })
      return unwrap(answered as Answered<ExtractAck>)
    },

    async drawItems(query: LibraryDrawQuery, signal: AbortSignal): Promise<LibraryItemSummary[]> {
      const answered = await libraryClient.GET('/api/library/items/random', {
        params: { query: drawQuery(query) },
        signal
      })
      // Nothing unread is the library's own state, not a failure: the button
      // says so, and an error here would put that in the error panel.
      if (failureCode(answered.error) === 'not_found') return []
      return unwrap(answered as Answered<{ items: LibraryItemSummary[] }>).items
    }
  }
}
