import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import { describeFailure, useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import { useSources } from '@/sources'

import { libraryCountsRevision, libraryRevision } from './revision'
import type {
  LibraryCounts,
  LibraryItemList,
  LibraryItemRecord,
  LibraryItemSummary,
  LibraryListQuery
} from './source'

/**
 * Whether a row still belongs to the list a query describes.
 *
 * Only the shelf and the unread flag can change under a write, so those are
 * the two checked; the kind and the search text are not touched by one.
 * `now` is not a shelf but a ranking over every unread item, so a row stays
 * on it while it is unread, whatever shelf a write moved it to.
 */
function matchesFilters(item: LibraryItemSummary, filters: LibraryListQuery): boolean {
  if (filters.view === 'now') {
    if (!item.unread) return false
    if (filters.unread !== null && filters.unread !== undefined && item.unread !== filters.unread) return false
    return true
  }
  if (filters.view && filters.view !== 'tudo' && item.status !== filters.view) return false
  if (filters.unread !== null && filters.unread !== undefined && item.unread !== filters.unread) return false
  return true
}

export interface LibraryItemsResource extends AsyncResource<LibraryItemList> {
  /** True while a further page is on its way, which is not the first load. */
  loadingMore: Ref<boolean>
  /** Why the last "carregar mais" failed, or null; the loaded rows stay. */
  loadMoreError: Ref<string | null>
  /** Whether the server said there is another page. */
  hasMore: ComputedRef<boolean>
  /** Ask for the page after the one being held, and append it. */
  loadMore: () => Promise<void>
  /**
   * Put a write's response into the page, in place of the row it replaces — or
   * take the row out when the write moved it off the shelf being shown.
   */
  applyItem: (item: LibraryItemSummary) => void
}

/**
 * The library list, re-read whenever the query changes.
 *
 * A changed query supersedes the request in flight rather than racing it, which
 * is what keeps a fast typist from seeing the results of a search they have
 * already moved past. `enabled` is for a caller in another module, which may
 * only read the library while the mount rule allows that crossing.
 *
 * `data.items` is every page loaded so far, not the last one: "carregar mais"
 * is how the screen grows a list, so the value it renders has to be the whole
 * list and `next_cursor` the frontier of it.
 */
export function useLibraryItems(
  query: MaybeRefOrGetter<LibraryListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): LibraryItemsResource {
  const { library } = useSources()
  const loadingMore = ref(false)
  const loadMoreError = ref<string | null>(null)

  const resource = useAsyncResource<LibraryItemList>(
    // A fresh read always starts at the first page: a cursor belongs to the
    // filters it was issued under, and the server refuses it under others.
    (signal) => library.listItems({ ...toValue(query), cursor: undefined }, signal),
    { immediate: toValue(enabled) }
  )

  watch(
    [() => toValue(query), libraryRevision, () => toValue(enabled)],
    () => {
      if (toValue(enabled)) void resource.refresh()
    },
    { deep: true }
  )

  const hasMore = computed(() => resource.data.value?.next_cursor !== null && resource.data.value !== null)

  async function loadMore(): Promise<void> {
    const held = resource.data.value
    if (!held?.next_cursor || loadingMore.value) return
    loadingMore.value = true
    loadMoreError.value = null
    const controller = new AbortController()
    try {
      const page = await library.listItems({ ...toValue(query), cursor: held.next_cursor }, controller.signal)
      const current = resource.data.value
      // The list may have been re-read under new filters while this page was in
      // flight; appending it then would mix two answers into one list.
      if (current !== held) return
      const known = new Set(held.items.map((item) => item.id))
      resource.data.value = {
        items: [...held.items, ...page.items.filter((item) => !known.has(item.id))],
        next_cursor: page.next_cursor
      }
    } catch (cause) {
      // Kept apart from `error`: that one replaces the whole list with the
      // load-error panel, and the rows already loaded are still good.
      loadMoreError.value = describeFailure(cause)
    } finally {
      loadingMore.value = false
    }
  }

  function applyItem(item: LibraryItemSummary): void {
    const held = resource.data.value
    if (!held) return
    const filters = toValue(query)
    const stays = matchesFilters(item, filters)
    resource.data.value = {
      ...held,
      items: stays
        ? held.items.map((existing) => (existing.id === item.id ? item : existing))
        : held.items.filter((existing) => existing.id !== item.id)
    }
  }

  return { ...resource, loadingMore, loadMoreError, hasMore, loadMore, applyItem }
}

export interface LibraryItemResource extends AsyncResource<LibraryItemRecord | null> {
  apply: (item: LibraryItemRecord) => void
}

/**
 * One library item. `data` is null for an item that does not exist, which the
 * screen renders as its own page — `loading` is how "not answered yet" is told
 * apart from "not there".
 *
 * Changing the id clears `data` before the new read starts. Without that, a
 * screen that renders its loading state only while `data` is empty keeps the
 * previous item on display, so moving from one article to the next shows the
 * one just left as though it were the one just asked for.
 */
export function useLibraryItem(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): LibraryItemResource {
  const { library } = useSources()
  const resource = useAsyncResource((signal) => library.getItem(toValue(id), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(id), () => toValue(enabled)], ([, nowEnabled], [previousId]) => {
    if (previousId !== toValue(id)) resource.data.value = null
    if (nowEnabled) void resource.refresh()
  })

  function apply(item: LibraryItemRecord): void {
    resource.data.value = item
  }

  return { ...resource, apply }
}

/**
 * The counts the sidebar and the screen print, straight from `/counts`.
 *
 * They are never derived from the rows on screen: a count over one page of a
 * paginated list is the size of that page, which is not what any of these
 * labels claims to be.
 */
export function useLibraryCounts(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<LibraryCounts> {
  const { library } = useSources()
  const resource = useAsyncResource((signal) => library.counts(signal), { immediate: toValue(enabled) })

  watch([libraryCountsRevision, () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  return resource
}
