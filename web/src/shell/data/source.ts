import type { components } from '@/api/core'

/**
 * The core's records, as `api/openapi/core.yaml` defines them.
 *
 * Nothing is renamed on the way in: a field called `link_count` on the wire
 * stays `link_count` in the screens, so a view can be checked against the
 * contract by eye.
 *
 * The core is not a module. It is always there, whatever `/api/config` lists,
 * so nothing here is behind the mount rule and no screen has to ask whether
 * subjects exist before reading them.
 */
export type Subject = components['schemas']['Subject']
export type SubjectCounts = components['schemas']['SubjectCounts']
export type SubjectTypeCount = components['schemas']['SubjectTypeCount']
export type CoreLink = components['schemas']['Link']
export type CoreLinkKind = components['schemas']['LinkKind']
export type CoreLinkStatus = components['schemas']['LinkStatus']
export type RegistryItem = components['schemas']['RegistryItem']
export type CoreFocus = components['schemas']['Focus']
export type CoreSearchHit = components['schemas']['SearchHit']

/** The filters a subject list is read with — each one a query parameter. */
export interface SubjectListQuery {
  /** Matches the name or an alias, accents and case ignored. */
  q?: string
  cursor?: string
  limit?: number
}

/**
 * One page of subjects. `next_cursor` is null on the last page rather than
 * absent, because a page a screen is holding always answers "is there more"
 * with a value.
 */
export interface SubjectPage {
  items: Subject[]
  next_cursor: string | null
}

/** The filters a link list is read with. Every one of them is optional. */
export interface CoreLinkQuery {
  src_id?: string
  dst_id?: string
  kind?: CoreLinkKind
  status?: CoreLinkStatus
  cursor?: string
  limit?: number
}

export interface CoreLinkPage {
  items: CoreLink[]
  next_cursor: string | null
}

/** What a rename or a focus toggle sends; an absent field is left alone. */
export interface SubjectPatch {
  name?: string
  focus?: boolean
}

/**
 * Everything the shell's own screens read and write.
 *
 * Every mutation answers with the record as the server now holds it, which is
 * the only value a screen may display afterwards.
 */
export interface CoreSource {
  listSubjects(query: SubjectListQuery, signal: AbortSignal): Promise<SubjectPage>
  /** Null when there is no such subject, which is a "not found" page rather than an error. */
  getSubjectBySlug(slug: string, signal: AbortSignal): Promise<Subject | null>
  getSubject(id: string, signal: AbortSignal): Promise<Subject | null>
  createSubject(name: string): Promise<Subject>
  patchSubject(id: string, patch: SubjectPatch): Promise<Subject>
  deleteSubject(id: string): Promise<void>
  focus(signal: AbortSignal): Promise<CoreFocus>
  /**
   * One query across every enabled module and the subjects, best first.
   *
   * The signal is not a convenience here. The palette asks on every keystroke,
   * so the answer to a word someone has already finished typing over must
   * never be allowed to land: the caller aborts the previous request and this
   * one rejects rather than resolving with stale rows.
   */
  search(query: string, signal: AbortSignal): Promise<CoreSearchHit[]>
  listLinks(query: CoreLinkQuery, signal: AbortSignal): Promise<CoreLinkPage>
  createLink(srcId: string, dstId: string, kind?: CoreLinkKind): Promise<CoreLink>
  decideLink(id: string, decision: 'accept' | 'reject'): Promise<CoreLink>
}

/**
 * The address a registry item is opened at.
 *
 * The registry stores a url per item precisely so a link stays followable when
 * the module owning the other end is switched off, and a screen that rebuilt
 * the address from the module and the type would be a second place for that
 * rule to live. An item saved before its module stored one falls back to
 * nothing, and the row renders unlinked rather than pointing at the home page.
 */
export function registryHref(item: RegistryItem): string | null {
  return item.url ?? null
}
