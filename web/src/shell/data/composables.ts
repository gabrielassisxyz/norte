import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import { describeFailure, useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { coreLinksRevision, subjectsRevision } from './revision'
import type { CoreFocus, CoreLinkPage, CoreLinkQuery, Subject, SubjectListQuery, SubjectPage } from './source'

/** What a list grown by "carregar mais" adds to the resource that holds its first page. */
interface PagedExtras {
  loadingMore: Ref<boolean>
  loadMoreError: Ref<string | null>
  hasMore: ComputedRef<boolean>
  loadMore: () => Promise<void>
}

/**
 * "Carregar mais" over a resource holding the first page: the next page is
 * appended to what is held, de-duplicated by id, with `next_cursor` as the
 * frontier. `readNext` reads the page after a cursor under the filters the
 * first page was read with.
 */
function withLoadMore<T extends { id: string }, P extends { items: T[]; next_cursor: string | null }>(
  resource: AsyncResource<P>,
  readNext: (cursor: string, signal: AbortSignal) => Promise<P>
): PagedExtras {
  const loadingMore = ref(false)
  const loadMoreError = ref<string | null>(null)
  const hasMore = computed(() => resource.data.value !== null && resource.data.value.next_cursor !== null)

  async function loadMore(): Promise<void> {
    const held = resource.data.value
    if (!held?.next_cursor || loadingMore.value) return
    loadingMore.value = true
    loadMoreError.value = null
    const controller = new AbortController()
    try {
      const page = await readNext(held.next_cursor, controller.signal)
      // The list may have been re-read while this page was in flight;
      // appending it then would mix two answers into one list.
      if (resource.data.value !== held) return
      const known = new Set(held.items.map((item) => item.id))
      resource.data.value = {
        ...page,
        items: [...held.items, ...page.items.filter((item) => !known.has(item.id))]
      }
    } catch (cause) {
      // Kept apart from `error`, which replaces the whole list with the
      // load-error panel: the rows already loaded are still good.
      loadMoreError.value = describeFailure(cause)
    } finally {
      loadingMore.value = false
    }
  }

  return { loadingMore, loadMoreError, hasMore, loadMore }
}

/** One page of subjects, plus the way a screen grows the list it is holding. */
export interface SubjectsResource extends AsyncResource<SubjectPage>, PagedExtras {}

/**
 * The subjects, re-read whenever the search changes or the vocabulary moves.
 *
 * A changed search supersedes the request in flight rather than racing it,
 * which is what keeps a fast typist from seeing the results of a search they
 * have already moved past. `enabled` is for a caller that reads the subjects
 * only in some state of its own -- the picker, which offers the focus until
 * something is typed, and must not pay for the first page of everything in the
 * meantime.
 *
 * `data.items` is every page loaded so far, not the last one: a list grown by
 * "carregar mais" has to render as the whole list, with `next_cursor` as the
 * frontier of it.
 */
export function useSubjects(
  query: MaybeRefOrGetter<SubjectListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): SubjectsResource {
  const { core } = useSources()

  const resource = useAsyncResource<SubjectPage>(
    (signal) =>
      // A fresh read always starts at the first page: a cursor belongs to the
      // search it was issued under, and the server refuses it under another.
      core.listSubjects({ ...toValue(query), cursor: undefined }, signal),
    { immediate: toValue(enabled) }
  )

  watch(
    [() => toValue(query), subjectsRevision, () => toValue(enabled)],
    () => {
      if (toValue(enabled)) void resource.refresh()
    },
    { deep: true }
  )

  const more = withLoadMore(resource, (cursor, signal) => core.listSubjects({ ...toValue(query), cursor }, signal))
  return { ...resource, ...more }
}

export interface SubjectResource extends AsyncResource<Subject | null> {
  apply: (subject: Subject) => void
}

/**
 * One subject by the slug its screen is addressed with.
 *
 * `data` is null for a subject that does not exist, which the screen renders
 * as its own page — `loading` is how "not answered yet" is told apart from
 * "not there". Changing the slug clears `data` first, so moving from one
 * subject to the next never shows the one just left as though it were the one
 * just asked for.
 */
export function useSubjectBySlug(slug: MaybeRefOrGetter<string>): SubjectResource {
  const { core } = useSources()
  const resource = useAsyncResource((signal) => core.getSubjectBySlug(toValue(slug), signal))

  watch([() => toValue(slug), subjectsRevision], ([nowSlug], [previousSlug]) => {
    if (previousSlug !== nowSlug) resource.data.value = null
    void resource.refresh()
  })

  function apply(subject: Subject): void {
    resource.data.value = subject
  }

  return { ...resource, apply }
}

/**
 * What the person is working on now.
 *
 * The picker offers these before it offers a search, because the subject a
 * link belongs to is usually one of the handful already in play — that is the
 * whole reason the focus flag exists.
 */
export function useCoreFocus(): AsyncResource<CoreFocus> {
  const { core } = useSources()
  const resource = useAsyncResource((signal) => core.focus(signal))
  watch(subjectsRevision, () => void resource.refresh())
  return resource
}

/** One page of links, plus the way a screen grows the list it is holding. */
export interface CoreLinksResource extends AsyncResource<CoreLinkPage>, PagedExtras {}

/**
 * The links into one target, by status and kind.
 *
 * The filters are the server's business and not the panel's: a panel that
 * dropped the suggested rows from the page it was handed would be showing one
 * page of every link, narrowed, and calling it the confirmed ones.
 */
export function useCoreLinks(query: MaybeRefOrGetter<CoreLinkQuery>): CoreLinksResource {
  const { core } = useSources()
  const resource = useAsyncResource((signal) => core.listLinks({ ...toValue(query), cursor: undefined }, signal))
  watch([() => toValue(query), coreLinksRevision], () => void resource.refresh(), { deep: true })
  const more = withLoadMore(resource, (cursor, signal) => core.listLinks({ ...toValue(query), cursor }, signal))
  return { ...resource, ...more }
}
