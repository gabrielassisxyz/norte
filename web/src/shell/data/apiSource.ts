import { coreClient } from '@/api/client'

import type {
  CoreFocus,
  CoreLink,
  CoreLinkKind,
  CoreLinkPage,
  CoreLinkQuery,
  CoreSource,
  Subject,
  SubjectListQuery,
  SubjectPage,
  SubjectPatch
} from './source'

/**
 * The core's screens read through the client `@/api/client` already builds
 * from `api/openapi/core.yaml` — the same file the Go handlers are generated
 * from. A path the contract does not declare, or a field it does not name, is
 * a type error at build time rather than a blank screen at run time.
 */
interface ApiFailure {
  error?: { code?: string; message?: string }
}

/**
 * The message a failed call reports: the sentence the envelope carries, since
 * it was written for a person. A failure that arrived without one — a proxy, a
 * dropped connection — falls back to the status, which is still more than
 * "erro".
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

function unwrap<T>(answered: Answered<T>): T {
  if (answered.error !== undefined || answered.data === undefined) {
    throw new Error(failureMessage(answered.error, answered.response?.status ?? 0))
  }
  return answered.data
}

/**
 * The query as the contract spells it. An absent filter does not reach the
 * wire, so "do not narrow by this" is one request rather than two.
 */
function subjectQuery(query: SubjectListQuery): Record<string, string | number> {
  const sent: Record<string, string | number> = {}
  if (query.q?.trim()) sent.q = query.q.trim()
  if (query.cursor) sent.cursor = query.cursor
  if (query.limit) sent.limit = query.limit
  return sent
}

function linkQuery(query: CoreLinkQuery): Record<string, string | number> {
  const sent: Record<string, string | number> = {}
  if (query.src_id) sent.src_id = query.src_id
  if (query.dst_id) sent.dst_id = query.dst_id
  if (query.kind) sent.kind = query.kind
  if (query.status) sent.status = query.status
  if (query.cursor) sent.cursor = query.cursor
  if (query.limit) sent.limit = query.limit
  return sent
}

export function createApiCoreSource(): CoreSource {
  return {
    async listSubjects(query: SubjectListQuery, signal: AbortSignal): Promise<SubjectPage> {
      const answered = await coreClient.GET('/api/core/subjects', {
        params: { query: subjectQuery(query) },
        signal
      })
      const page = unwrap(answered as Answered<{ items: Subject[]; next_cursor?: string }>)
      return { items: page.items, next_cursor: page.next_cursor ?? null }
    },

    async getSubjectBySlug(slug: string, signal: AbortSignal): Promise<Subject | null> {
      const answered = await coreClient.GET('/api/core/subjects/by-slug/{slug}', {
        params: { path: { slug } },
        signal
      })
      // A slug that is not there is a page of its own, not a failure to report.
      if (failureCode(answered.error) === 'not_found') return null
      return unwrap(answered as Answered<Subject>)
    },

    async getSubject(id: string, signal: AbortSignal): Promise<Subject | null> {
      const answered = await coreClient.GET('/api/core/subjects/{id}', {
        params: { path: { id } },
        signal
      })
      if (failureCode(answered.error) === 'not_found') return null
      return unwrap(answered as Answered<Subject>)
    },

    async createSubject(name: string): Promise<Subject> {
      const answered = await coreClient.POST('/api/core/subjects', { body: { name } })
      return unwrap(answered as Answered<Subject>)
    },

    async patchSubject(id: string, patch: SubjectPatch): Promise<Subject> {
      const answered = await coreClient.PATCH('/api/core/subjects/{id}', {
        params: { path: { id } },
        body: patch
      })
      return unwrap(answered as Answered<Subject>)
    },

    async deleteSubject(id: string): Promise<void> {
      const answered = await coreClient.DELETE('/api/core/subjects/{id}', {
        params: { path: { id } }
      })
      // A 204 carries no body, so there is nothing to unwrap: only a failure
      // has to be turned into a thrown error here.
      if (answered.error !== undefined) {
        throw new Error(failureMessage(answered.error, answered.response?.status ?? 0))
      }
    },

    async focus(signal: AbortSignal): Promise<CoreFocus> {
      return unwrap((await coreClient.GET('/api/core/focus', { signal })) as Answered<CoreFocus>)
    },

    async listLinks(query: CoreLinkQuery, signal: AbortSignal): Promise<CoreLinkPage> {
      const answered = await coreClient.GET('/api/core/links', {
        params: { query: linkQuery(query) },
        signal
      })
      const page = unwrap(answered as Answered<{ items: CoreLink[]; next_cursor?: string }>)
      return { items: page.items, next_cursor: page.next_cursor ?? null }
    },

    async createLink(srcId: string, dstId: string, kind: CoreLinkKind = 'about'): Promise<CoreLink> {
      const answered = await coreClient.POST('/api/core/links', {
        body: { src_id: srcId, dst_id: dstId, kind }
      })
      return unwrap(answered as Answered<CoreLink>)
    },

    async decideLink(id: string, decision: 'accept' | 'reject'): Promise<CoreLink> {
      const answered = await coreClient.POST('/api/core/links/{id}/decide', {
        params: { path: { id } },
        body: { decision }
      })
      return unwrap(answered as Answered<CoreLink>)
    }
  }
}
