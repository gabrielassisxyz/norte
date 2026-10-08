import { toValue, watch, type MaybeRefOrGetter } from 'vue'

import { useAsyncResource, type AsyncResource } from '@/lib/asyncResource'
import type { LibraryItem } from '@/mock/types'
import { useSources } from '@/sources'

import { countLibraryItems } from './counts'
import { libraryRevision } from './revision'
import type { LibraryList, LibraryListQuery, LibrarySummary } from './source'

export interface LibraryItemsResource extends AsyncResource<LibraryList> {
  /** Put a write's response into the page, in place of the row it replaces. */
  applyItem: (item: LibraryItem) => void
  /** Put a newly created item at the front, as a fresh read would. */
  prependItem: (item: LibraryItem) => void
}

/**
 * The library list, re-read whenever the query changes.
 *
 * A changed query supersedes the request in flight rather than racing it, which
 * is what keeps a fast typist from seeing the results of a search they have
 * already moved past. `enabled` is for a caller in another module, which may
 * only read the library while the mount rule allows that crossing.
 */
export function useLibraryItems(
  query: MaybeRefOrGetter<LibraryListQuery> = {},
  enabled: MaybeRefOrGetter<boolean> = true
): LibraryItemsResource {
  const { library } = useSources()
  const resource = useAsyncResource((signal) => library.listItems(toValue(query), signal), {
    immediate: toValue(enabled)
  })

  watch(
    [() => toValue(query), libraryRevision, () => toValue(enabled)],
    () => {
      if (toValue(enabled)) void resource.refresh()
    },
    { deep: true }
  )

  function replaceItems(items: LibraryItem[]): void {
    const page = resource.data.value
    if (!page) return
    resource.data.value = { ...page, items, counts: countLibraryItems(items) }
  }

  function applyItem(item: LibraryItem): void {
    const page = resource.data.value
    if (!page) return
    replaceItems(page.items.map((existing) => (existing.id === item.id ? item : existing)))
  }

  function prependItem(item: LibraryItem): void {
    const page = resource.data.value
    if (!page) return
    replaceItems([item, ...page.items.filter((existing) => existing.id !== item.id)])
  }

  return { ...resource, applyItem, prependItem }
}

export interface LibraryItemResource extends AsyncResource<LibraryItem | null> {
  apply: (item: LibraryItem) => void
}

/**
 * One library item. `data` is null for an item that does not exist, which the
 * screen renders as its own page — `loading` is how "not answered yet" is told
 * apart from "not there".
 *
 * `enabled` is for a caller in another module: an item is only readable from
 * there while the mount rule allows that crossing, so the read is not made at
 * all rather than made and discarded.
 */
export function useLibraryItem(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true
): LibraryItemResource {
  const { library } = useSources()
  const resource = useAsyncResource((signal) => library.getItem(toValue(id), signal), {
    immediate: toValue(enabled)
  })

  watch([() => toValue(id), () => toValue(enabled)], () => {
    if (toValue(enabled)) void resource.refresh()
  })

  function apply(item: LibraryItem): void {
    resource.data.value = item
  }

  return { ...resource, apply }
}

/** The counts the sidebar prints, without the rows behind them. */
export function useLibrarySummary(enabled: MaybeRefOrGetter<boolean> = true): AsyncResource<LibrarySummary> {
  const { library } = useSources()
  return useAsyncResource((signal) => library.summary(signal), { immediate: toValue(enabled) })
}
