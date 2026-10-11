<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Menu from '@/components/ds/Menu.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import Icon from '@/components/ds/Icon.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatShortDate } from '@/lib/clock'
import { usePhoneViewport } from '@/lib/phoneViewport'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useProjectsSummary } from '@/modules/projects/data/composables'
import { coreLinksChanged } from '@/shell/data/revision'
import type { Subject } from '@/shell/data/source'
import SubjectPicker from '@/shell/SubjectPicker.vue'
import { useSources } from '@/sources'

import { useLibraryCounts, useLibraryItems } from '../data/composables'
import { libraryItemChanged } from '../data/revision'
import SaveLinkDialog from '../components/SaveLinkDialog.vue'
import LibrarySuggestions from './LibrarySuggestions.vue'
import type {
  LibraryItemSummary,
  LibraryKind,
  LibraryListQuery,
  LibraryLocation,
  LibraryLocationName,
  LibrarySort
} from '../data/source'

/**
 * The locations, in the one order the whole app lists them in.
 *
 * The sidebar lists the same six, and listing them in two different orders
 * made the same place move depending on where it was read. The order here is
 * the reading order of a saved link: it arrives in the inbox, is chosen for
 * next, is put off until later, ends up archived, or is kept with no intent to
 * read; `all` is the view over all five and sits last.
 */
const VIEWS: LibraryLocationName[] = ['inbox', 'up_next', 'later', 'archive', 'stash', 'all']
const VIEW_LABELS: Record<LibraryLocationName, string> = {
  inbox: 'Inbox',
  up_next: 'Up Next',
  later: 'Later',
  archive: 'Archive',
  stash: 'Stash',
  all: 'All'
}

/**
 * The pending-connections queue's tab, which is addressed like a location and
 * is not one.
 *
 * It shares the `v` parameter with the locations because it is one more thing
 * the library shows, and a person switching to it and back expects the
 * browser's own back button to do that. It is not a `LibraryLocationName`: no
 * library list is read for it, and sending `v=pending-connections` to
 * `/api/library/items` would be asking the server for a location that does not
 * exist.
 *
 * It is named for what it holds rather than for the word "suggestions", which
 * the focus-ranked view now carries: a screen with a Suggestions view and a
 * Suggestions tab meaning different things is a screen nobody can describe.
 */
const PENDING_CONNECTIONS_TAB = 'pending-connections'

/**
 * The spellings the `kind` query parameter accepts.
 *
 * The addresses in the sidebar, the prototype and anything already bookmarked
 * may carry a plural; the contract's kinds are singular, so the screen
 * translates rather than making the server accept both.
 */
const KIND_BY_TYPE: Record<string, LibraryKind> = {
  article: 'article',
  articles: 'article',
  book: 'book',
  books: 'book',
  pdf: 'paper',
  pdfs: 'paper',
  paper: 'paper',
  papers: 'paper',
  video: 'video',
  videos: 'video',
  podcast: 'podcast',
  podcasts: 'podcast',
  newsletter: 'newsletter',
  newsletters: 'newsletter',
  course: 'course',
  courses: 'course'
}

const TYPE_TITLES: Record<LibraryKind, string> = {
  article: 'Articles',
  book: 'Books',
  paper: 'PDFs',
  video: 'Videos',
  podcast: 'Podcasts',
  newsletter: 'Newsletters',
  course: 'Courses'
}

/**
 * The kinds as the sidebar's Kinds group names them, for the filter menu.
 *
 * Plural, because the menu picks a set and not an item -- which is also why
 * these are not the singular `KIND_LABELS` a row is tagged with. They are
 * spelled out here rather than imported from the module's `index.ts`: that
 * file pulls in the home blocks and is loaded with the shell, while this view
 * is loaded only when someone opens the Library.
 */
const KIND_FILTER_ORDER: LibraryKind[] = ['article', 'book', 'paper', 'video', 'podcast', 'newsletter', 'course']

const KIND_FILTER_LABELS: Record<LibraryKind, string> = {
  article: 'Posts',
  book: 'Books',
  paper: 'Papers',
  video: 'Videos',
  podcast: 'Podcasts',
  newsletter: 'Newsletters',
  course: 'Courses'
}

const KIND_LABELS: Record<LibraryKind, string> = {
  article: 'Article',
  book: 'Book',
  paper: 'PDF',
  video: 'Video',
  podcast: 'Podcast',
  newsletter: 'Newsletter',
  course: 'Course'
}

const route = useRoute()
const router = useRouter()
const { library, core, projects: projectsSource } = useSources()
const phone = usePhoneViewport()

/**
 * One order for the list, whether the server takes it as a sort or as a view.
 *
 * `suggestions` is the focus ranking, which the contract spells as
 * `view=suggestions` rather than as a sort because it answers over every
 * location at once. It is one of these choices anyway: to the person reading,
 * "Suggestions" is one more answer to "in what order", and keeping it as a
 * control of its own is what made the header need a second row.
 */
type SortChoice = LibrarySort | 'suggestions'

const SORT_OPTIONS: Array<{ value: SortChoice; label: string }> = [
  { value: 'saved_desc', label: 'Newest' },
  { value: 'saved_asc', label: 'Oldest' },
  { value: 'title', label: 'Title' },
  { value: 'last_opened_desc', label: 'Recently opened' },
  { value: 'suggestions', label: 'Suggestions' }
]

const DEFAULT_SORT: SortChoice = 'saved_desc'

const sortChoice = ref<SortChoice>(DEFAULT_SORT)
const unreadOnly = ref(false)
const search = ref('')
const saveOpen = ref(false)

function openLibrarySaveDialog(): void {
  saveOpen.value = true
}

function onLibraryShortcutKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 'a') return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  ) {
    return
  }
  event.preventDefault()
  openLibrarySaveDialog()
}

onMounted(() => document.addEventListener('keydown', onLibraryShortcutKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onLibraryShortcutKeydown))

/** The `v` parameter as it was written, whether or not it names anything. */
const requestedTab = computed<string>(() => {
  const raw = route.query.v
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : ''
})

const showPendingConnections = computed(() => requestedTab.value === PENDING_CONNECTIONS_TAB)

/**
 * Which tab the control shows as selected, the queue included.
 *
 * Nothing is selected while the focus ranking is on: that list is drawn from
 * every location, so marking one of them would name a location the rows are
 * not from. The tabs stay on screen, because they are then the only way back.
 */
const activeTab = computed<string>(() => {
  if (showPendingConnections.value) return PENDING_CONNECTIONS_TAB
  if (focusRanked.value) return ''
  return activeView.value
})

const activeView = computed<LibraryLocationName>(() =>
  (VIEWS as string[]).includes(requestedTab.value) ? (requestedTab.value as LibraryLocationName) : 'inbox'
)

/**
 * The focus ranking is on.
 *
 * The order is local state and not an address, unlike the location: the
 * location is something the sidebar links to and a bookmark should survive,
 * while the order is a way of looking at whatever is open -- and this one
 * answers over every location at once, so there is no address it would belong
 * to.
 *
 * The pending-connections queue is not a list of saved items, so the ranking
 * never applies to it: it is reached from the sidebar as well as from the
 * tabs, and the sidebar does not go through the tabs that put the order back.
 */
const focusRanked = computed(() => sortChoice.value === 'suggestions' && !showPendingConnections.value)

/** The requested type filter, or null for every kind. */
const activeKind = computed<LibraryKind | null>(() => {
  const raw = route.query.kind
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value === '') return null
  return KIND_BY_TYPE[value.toLowerCase()] ?? null
})

const title = computed(() => (activeKind.value === null ? 'Library' : TYPE_TITLES[activeKind.value]))

/**
 * A text search is active, which the server answers ranked by relevance.
 *
 * The server refuses an explicit `sort` alongside `q` because the rank is the
 * order, so while text is in the box the screen sends no sort and disables the
 * menu that would set one.
 */
const hasSearchText = computed(() => search.value.trim() !== '')

/**
 * What the list is asked for — every filter of it a query parameter.
 *
 * None of this is applied over the rows already held. The server sends one page
 * at a time, so a location or an unread filter computed here would narrow the
 * first fifty rows and present the result as the whole location.
 */
const query = computed<LibraryListQuery>(() => {
  // The ranked view carries its own order over every location, and the server
  // refuses a sort or a text query alongside it. The screen sends neither
  // rather than relying on that refusal, and hides the controls that would
  // produce them.
  if (focusRanked.value) {
    // unread is not one of the refusals: the view reads every location and
    // orders unread first, so the flag narrows it like it narrows any other
    // view, and the toggle does the same thing here as everywhere else.
    return { view: 'suggestions', kind: activeKind.value, unread: unreadOnly.value ? true : null }
  }
  const text = search.value.trim()
  // A text query orders by full-text rank, and the server refuses a sort
  // alongside it: while one is active no sort is sent.
  if (text) {
    return {
      view: activeView.value,
      kind: activeKind.value,
      unread: unreadOnly.value ? true : null,
      q: text
    }
  }
  return {
    view: activeView.value,
    kind: activeKind.value,
    unread: unreadOnly.value ? true : null,
    // `suggestions` is not a sort the contract takes, and it cannot be the
    // choice on this branch: it is either focus-ranked, which returned above,
    // or the pending-connections queue, which reads no list at all.
    sort: sortChoice.value === 'suggestions' ? 'saved_desc' : sortChoice.value,
    q: undefined
  }
})

// The list is not read while the pending-connections queue is on screen: it is
// not rendered then, and asking for a page nothing displays is a request paid
// for twice over -- once on the way out and again when the person comes back.
const { data: page, loading, error, refresh, hasMore, loadingMore, loadMoreError, loadMore, applyItem } =
  useLibraryItems(query, () => !showPendingConnections.value)
const { data: counts } = useLibraryCounts()
const writing = useAsyncAction()

const items = computed<LibraryItemSummary[]>(() => page.value?.items ?? [])
const failedLibraryThumbnailSources = ref<Record<string, string>>({})

/**
 * The tabs, the locations counted and the queue not.
 *
 * The queue carries no count on purpose. The only number this screen could
 * print is how many suggestions the first page happens to hold, and labelling
 * that as the size of the queue would be wrong on the second page; there is no
 * endpoint that counts links, and inventing one is not this bead's.
 */
const segOptions = computed(() => [
  ...VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view], count: counts.value?.views[view] ?? 0 })),
  { value: PENDING_CONNECTIONS_TAB, label: 'Pending connections' }
])

/** Nothing has arrived yet, as opposed to nothing matching what was asked. */
const firstLoad = computed(() => loading.value && page.value === null)

const emptyText = computed(() => {
  if (focusRanked.value) return 'Nothing to read linked to what is in focus right now.'
  if (search.value.trim()) return `Nothing found for “${search.value.trim()}”.`
  if (unreadOnly.value) return 'Everything here is read.'
  if (activeView.value === 'inbox') return 'The inbox is empty. Whatever arrives through the extension, an upload or a feed shows up here.'
  if (activeView.value === 'up_next') return 'Nothing chosen to read next.'
  if (activeView.value === 'later') return 'Nothing kept for later.'
  if (activeView.value === 'archive') return 'Nothing archived yet.'
  if (activeView.value === 'stash') return 'Nothing stashed yet.'
  return 'No item of this kind.'
})

/**
 * How many rows are on screen, which is not how many the location holds.
 *
 * The total is the counts endpoint's answer; this line counts what has been
 * loaded, because that is the number "load more" changes.
 */
const countText = computed(() => `${items.value.length} ${items.value.length === 1 ? 'item' : 'items'}`)

const sortLabel = computed(
  () => SORT_OPTIONS.find((option) => option.value === sortChoice.value)?.label ?? ''
)

/** The icon has no text, so the order it is set to is said in its name. */
const sortButtonLabel = computed(() => `Sort: ${sortLabel.value}`)

/** Any filter is set, which is what the filter icon's colour reports. */
const filtered = computed(() => unreadOnly.value || activeKind.value !== null)

function setView(view: string): void {
  if (!(VIEWS as string[]).includes(view) && view !== PENDING_CONNECTIONS_TAB) return
  // Picking a tab is picking what is on screen, and the focus ranking reads
  // every location at once: left on, it would answer a location's tab with a
  // list that is not that location. The tabs are the one control that is never
  // hidden, so they are what puts the order back.
  sortChoice.value = DEFAULT_SORT
  void router.push({ query: { ...route.query, v: view } })
}

function setSort(value: SortChoice): void {
  sortChoice.value = value
}

/**
 * Narrow to one kind, or to none.
 *
 * The kind is an address and not local state: the sidebar's Kinds rows link to
 * it, the title names it, and a bookmark of "my papers" has to survive a
 * reload. So the menu writes the same `kind` parameter those links carry.
 */
function setKind(kind: LibraryKind | null): void {
  const next = { ...route.query }
  if (kind === null) delete next.kind
  else next.kind = kind
  void router.push({ query: next })
}

function readerTarget(item: LibraryItemSummary): { name: string; params: { id: string } } {
  return { name: 'reader', params: { id: item.id } }
}

function openItem(item: LibraryItemSummary, event: MouseEvent): void {
  if ((event.target as HTMLElement).closest('button, a')) return
  void router.push(readerTarget(item))
}

/**
 * The serendipity button: one unread item, drawn at random and weighted away
 * from the focus, opened in the reader.
 *
 * `away_from_focus` is sent explicitly rather than left to the server's
 * default, because the button exists for the bored moment and the focused
 * items already have the ranked view. An empty draw is the library's own
 * state, not a failure, so it gets its own sentence next to the button.
 */
const drawing = useAsyncAction()
const nothingToDraw = ref(false)

async function openSurprise(): Promise<void> {
  nothingToDraw.value = false
  const drawn = await drawing.run(() =>
    library.drawItems({ away_from_focus: true }, new AbortController().signal)
  )
  if (drawn === null) return
  const [item] = drawn
  if (!item) {
    nothingToDraw.value = true
    return
  }
  void router.push(readerTarget(item))
}

function sourceOf(item: LibraryItemSummary): string {
  if (item.author) return item.author
  if (item.site) return item.site
  try {
    return new URL(item.canonical_url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}

function libraryThumbnailSource(item: LibraryItemSummary): string | undefined {
  if (!item.lead_image || failedLibraryThumbnailSources.value[item.id] === item.lead_image) return undefined
  return item.lead_image
}

function markLibraryThumbnailFailed(item: LibraryItemSummary): void {
  if (!item.lead_image) return
  failedLibraryThumbnailSources.value = {
    ...failedLibraryThumbnailSources.value,
    [item.id]: item.lead_image
  }
}

function laterTitle(item: LibraryItemSummary): string {
  return item.location === 'later' ? 'Back to the inbox' : 'Later'
}

function archiveTitle(item: LibraryItemSummary): string {
  return item.location === 'archive' ? 'Unarchive' : 'Archive'
}

function readTitle(item: LibraryItemSummary): string {
  return item.unread ? 'Mark as read' : 'Mark as unread'
}

/**
 * Every action here waits for the server and then shows what came back. A
 * failure leaves the row exactly as it was and says so above the list, because
 * a row that moves and then moves back is worse than a row that never moved.
 *
 * The counts are asked for again rather than adjusted here: they are totals
 * over the whole library, and the response to a write carries one row.
 */
async function patch(item: LibraryItemSummary, patchBody: { location?: LibraryLocation; unread?: boolean }): Promise<void> {
  const updated = await writing.run(() => library.patchItem(item.id, patchBody))
  if (!updated) return
  applyItem(updated)
  libraryItemChanged()
}

function toggleLater(item: LibraryItemSummary): Promise<void> {
  return patch(item, { location: item.location === 'later' ? 'inbox' : 'later' })
}

function toggleArchive(item: LibraryItemSummary): Promise<void> {
  return patch(item, { location: item.location === 'archive' ? 'inbox' : 'archive' })
}

function toggleRead(item: LibraryItemSummary): Promise<void> {
  return patch(item, { unread: !item.unread })
}

/**
 * Turning an item into a task is offered only while the projects module is
 * mounted and reads from the same place. A real id is a UUID and a mock id is a
 * string like `task-backup`, so offering it across that line would write a
 * reference neither side resolves.
 */
const canMakeTask = computed(() => crossModuleActionAllowed('library', 'projects'))

const { data: projectsSummary } = useProjectsSummary(canMakeTask)

const projectOptions = computed(() => projectsSummary.value?.projects ?? [])

const openAction = ref<string | null>(null)

function toggleAction(item: LibraryItemSummary): void {
  openAction.value = openAction.value === item.id ? null : item.id
}

async function makeTask(item: LibraryItemSummary, projectId: string): Promise<void> {
  await writing.run(() =>
    projectsSource.addTask({
      projectId,
      title: `Read "${item.title}"`,
      description: item.url,
      priority: 'P2',
      bucket: 'next'
    })
  )
  openAction.value = null
}

/**
 * Which item's subject picker is open.
 *
 * Unlike the task action this one is never gated by `crossModuleActionAllowed`:
 * a subject belongs to the core, which is always on and always reads from the
 * same place the library does, so there is no crossing to withhold.
 */
const openSubjectPicker = ref<string | null>(null)

function toggleSubjectPicker(item: LibraryItemSummary): void {
  openSubjectPicker.value = openSubjectPicker.value === item.id ? null : item.id
}

/**
 * Link the item to the chosen subject.
 *
 * The item is the source and the subject the target, which is the direction
 * `about` is read in: the panel on a subject's page lists what points at it.
 */
async function linkToSubject(item: LibraryItemSummary, subject: Subject): Promise<void> {
  const linked = await writing.run(() => core.createLink(item.id, subject.id))
  if (!linked) return
  openSubjectPicker.value = null
  // Nothing on this screen holds the subject counts, and no write response
  // carries them, so every list of subjects asks again.
  coreLinksChanged()
}

/**
 * Which row has its actions open, on a viewport with no hover to reveal them.
 *
 * A phone has no pointer that can be over a row, so the actions are not there
 * until a tap on the row's "more" button puts them there -- and they are
 * genuinely absent rather than transparent, because an invisible control that
 * still answers a tap is worse than no control at all.
 */
const openRowMenu = ref<string | null>(null)

function rowActionsShown(item: LibraryItemSummary): boolean {
  return !phone.value || openRowMenu.value === item.id
}

function toggleRowMenu(item: LibraryItemSummary): void {
  const closing = openRowMenu.value === item.id
  openRowMenu.value = closing ? null : item.id
  // The two menus inside the group hang off the row's actions; closing the
  // group has to take them with it or they come back open on the next tap.
  if (closing) {
    openAction.value = null
    openSubjectPicker.value = null
  }
}
</script>

<template>
  <main class="library">
    <div class="library-head">
      <div class="library-title-row">
        <Menu class="library-add" label="Add" menu-label="Add" align="left">
          <template #trigger>
            <Icon name="plus" :size="16" />
          </template>
          <button type="button" role="menuitem" class="library-menu-row library-add-row" @click="openLibrarySaveDialog">
            <span>URL</span>
            <kbd class="library-menu-shortcut">A</kbd>
          </button>
        </Menu>
        <h1>{{ title }}</h1>
        <SegmentedControl
          class="library-tabs"
          :options="segOptions"
          :model-value="activeTab"
          label="Status"
          @change="setView"
        />
        <button
          v-if="!showPendingConnections"
          type="button"
          class="ghost library-surprise"
          :disabled="drawing.pending.value"
          title="Open a random unread item, preferably away from the focus"
          @click="openSurprise()"
        >
          {{ drawing.pending.value ? 'Drawing…' : 'Surprise' }}
        </button>
      </div>
      <div v-if="!showPendingConnections" class="library-tools">
        <label class="library-search-label" for="library-search">Search the library</label>
        <input
          id="library-search"
          v-model="search"
          class="library-search"
          type="search"
          :disabled="focusRanked"
          placeholder="Search by title or author…"
        />
        <Menu
          class="library-sort"
          :label="sortButtonLabel"
          menu-label="Sort"
          :disabled="hasSearchText"
        >
          <template #trigger>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 4h7M2.5 8h5M2.5 12h3M12.5 3.5v8M10.5 9.5l2 2 2-2" />
            </svg>
          </template>
          <button
            v-for="option in SORT_OPTIONS"
            :key="option.value"
            type="button"
            role="menuitemradio"
            :aria-checked="option.value === sortChoice"
            class="library-menu-row"
            :data-sort="option.value"
            @click="setSort(option.value)"
          >
            <span class="library-menu-mark" aria-hidden="true">
              <Icon v-if="option.value === sortChoice" name="check" :size="14" />
            </span>
            {{ option.label }}
          </button>
        </Menu>
        <Menu class="library-filter" label="Filter" menu-label="Filters" :active="filtered">
          <template #trigger>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
            </svg>
          </template>
          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="unreadOnly"
            class="library-menu-row"
            data-filter="unread"
            @click="unreadOnly = !unreadOnly"
          >
            <span class="library-menu-mark" aria-hidden="true">
              <Icon v-if="unreadOnly" name="check" :size="14" />
            </span>
            Unread only
          </button>
          <span class="library-menu-head">Kind</span>
          <button
            type="button"
            role="menuitemradio"
            :aria-checked="activeKind === null"
            class="library-menu-row"
            data-kind=""
            @click="setKind(null)"
          >
            <span class="library-menu-mark" aria-hidden="true">
              <Icon v-if="activeKind === null" name="check" :size="14" />
            </span>
            Every kind
          </button>
          <button
            v-for="kind in KIND_FILTER_ORDER"
            :key="kind"
            type="button"
            role="menuitemradio"
            :aria-checked="activeKind === kind"
            class="library-menu-row"
            :data-kind="kind"
            @click="setKind(kind)"
          >
            <span class="library-menu-mark" aria-hidden="true">
              <Icon v-if="activeKind === kind" name="check" :size="14" />
            </span>
            {{ KIND_FILTER_LABELS[kind] }}
          </button>
        </Menu>
      </div>
    </div>

    <div v-if="unreadOnly && !showPendingConnections" class="library-unread">
      Showing unread only
      <button type="button" class="ghost ghost-clear" @click="unreadOnly = false">Clear</button>
    </div>

    <div v-if="focusRanked" class="library-unread">
      First what is linked to the current focus, with unread before read
    </div>

    <p v-if="nothingToDraw" class="library-unread library-nothing" role="status">
      Nothing to read
    </p>

    <p v-if="drawing.error.value" class="library-write-error" role="alert">
      Could not draw: {{ drawing.error.value }}
      <button type="button" class="ghost ghost-clear" @click="drawing.clear()">Close</button>
    </p>

    <p v-if="writing.error.value" class="library-write-error" role="alert">
      Could not save: {{ writing.error.value }}
      <button type="button" class="ghost ghost-clear" @click="writing.clear()">Close</button>
    </p>

    <LibrarySuggestions v-if="showPendingConnections" />

    <div v-else-if="firstLoad" class="library-loading" role="status">Loading the library…</div>

    <div v-else-if="error" class="library-error" role="alert">
      <p>The library could not be loaded: {{ error }}</p>
      <button type="button" class="ghost" @click="refresh()">Try again</button>
    </div>

    <div v-else class="library-list">
      <article
        v-for="item in items"
        :key="item.id"
        class="item"
        :class="{ 'is-menu-open': openRowMenu === item.id }"
        @click="openItem(item, $event)"
      >
        <div class="item-thumb" aria-hidden="true">
          <img
            v-if="libraryThumbnailSource(item)"
            class="item-thumb-image"
            :src="libraryThumbnailSource(item)"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="markLibraryThumbnailFailed(item)"
          />
          <Icon v-else name="note" :size="18" />
          <span v-if="item.unread" class="item-dot" role="img" aria-label="Unread" />
        </div>
        <div class="item-main">
          <RouterLink class="item-title" :to="readerTarget(item)">{{ item.title }}</RouterLink>
          <div class="item-meta">
            <span>{{ sourceOf(item) }}</span>
            <span aria-hidden="true">·</span>
            <span class="mono">{{ formatShortDate(item.saved_at) }}</span>
            <span v-if="activeKind === null" class="item-kind">{{ KIND_LABELS[item.kind] }}</span>
          </div>
        </div>
        <span class="mono item-date">{{ formatShortDate(item.saved_at) }}</span>
        <button
          v-if="phone"
          type="button"
          class="act item-more"
          data-action="more"
          :title="`Actions for ${item.title}`"
          :aria-label="`Actions for ${item.title}`"
          :aria-expanded="openRowMenu === item.id"
          @click="toggleRowMenu(item)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="8" cy="3.5" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="8" cy="12.5" r="1.3" />
          </svg>
        </button>
        <div v-if="rowActionsShown(item)" class="actions" role="group" aria-label="Actions">
          <button type="button" class="act" :title="laterTitle(item)" :aria-label="laterTitle(item)" @click="toggleLater(item)">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 5v3.2l2 1.3" />
            </svg>
          </button>
          <button
            type="button"
            class="act"
            :title="archiveTitle(item)"
            :aria-label="archiveTitle(item)"
            @click="toggleArchive(item)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="2.5" y="3" width="11" height="3" rx="1" />
              <path d="M3.5 6v6.5h9V6M6.5 9h3" />
            </svg>
          </button>
          <button type="button" class="act" :title="readTitle(item)" :aria-label="readTitle(item)" @click="toggleRead(item)">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 8.5l3 3 7-7" />
            </svg>
          </button>
          <div class="act-wrap">
            <button
              type="button"
              class="act"
              title="Link to a subject"
              aria-label="Link to a subject"
              :aria-expanded="openSubjectPicker === item.id"
              @click="toggleSubjectPicker(item)"
            >
              <Icon name="plus" :size="16" />
            </button>
            <div v-if="openSubjectPicker === item.id" class="act-menu act-menu-wide" aria-label="Subjects">
              <SubjectPicker label="Subject" @select="linkToSubject(item, $event)" />
            </div>
          </div>
          <div v-if="canMakeTask" class="act-wrap">
            <button
              type="button"
              class="act"
              title="Create a task"
              aria-label="Create a task"
              :aria-expanded="openAction === item.id"
              @click="toggleAction(item)"
            >
              <Icon name="check" :size="16" />
            </button>
            <div v-if="openAction === item.id" class="act-menu" role="menu" aria-label="Projects">
              <button
                v-for="project in projectOptions"
                :key="project.id"
                type="button"
                role="menuitem"
                class="act-menu-row"
                @click="makeTask(item, project.id)"
              >
                {{ project.title }}
              </button>
            </div>
          </div>
        </div>
      </article>
      <div v-if="items.length === 0" class="library-empty">{{ emptyText }}</div>
    </div>

    <div v-if="!showPendingConnections && !firstLoad && !error" class="library-foot">
      <button
        v-if="hasMore"
        type="button"
        class="ghost library-more"
        :disabled="loadingMore"
        @click="loadMore()"
      >
        {{ loadingMore ? 'Loading…' : 'Load more' }}
      </button>
      <span v-if="loadMoreError" class="library-more-error" role="alert">
        Could not load more: {{ loadMoreError }}
      </span>
      <span class="mono library-count">{{ countText }}</span>
    </div>
    <SaveLinkDialog v-model:open="saveOpen" />
  </main>
</template>

<style scoped>
.act-wrap { position: relative; }
.act-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; display: grid; min-width: 220px; padding: 4px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow-pop); }
.act-menu-row { padding: 7px 10px; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--ink); font-family: var(--font-sans); font-size: 13px; text-align: left; cursor: pointer; }
.act-menu-row:hover { background: var(--norte-soft); color: var(--norte); }
.act-menu-wide { width: 280px; padding: 10px; }

.library {
  max-width: 1120px;
  margin: 0 auto;
}

/*
  The header is one row: the title, the tabs and Surprise on the left, the
  search box and the two menus on the right.

  It fits because the search box is the only elastic thing in it -- it is laid
  out from a basis narrow enough that the row has room at the widths this app
  is used at, and grows into whatever is left over. Everything else is
  `flex: none`, so a tight row shrinks the search box instead of wrapping the
  tabs, which is the one control here that cannot afford to lose its line.
*/
.library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-top: 28px;
}

.library-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  min-width: 0;
}

.library-tabs,
.library-add,
.library-sort,
.library-filter {
  flex: none;
}

.library-title-row h1 {
  margin: 0;
  white-space: nowrap;
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 36px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}

.library-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  /*
    Laid out from the width of the two menus plus a narrow search box, not from
    the box's own ceiling: `auto` here measures the ceiling, which made the
    whole group wrap to a second line while there was still room for it.
  */
  flex: 1 1 180px;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
}

.library-menu-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.library-menu-row:hover {
  background: var(--norte-soft);
  color: var(--norte);
}

.library-menu-row[aria-checked='true'] {
  color: var(--norte);
}

.library-menu-row:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.library-add-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.library-menu-shortcut {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
}

.library-menu-mark {
  display: grid;
  place-items: center;
  width: 18px;
}

.library-menu-head {
  padding: 8px 10px 4px;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 550;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.ghost:hover {
  background: var(--sunken);
  color: var(--ink);
}

.ghost-icon {
  padding: 0 7px;
}

.ghost-icon.is-active {
  color: var(--norte);
}

.ghost-clear {
  height: 24px;
  padding: 0 6px;
}

.ghost:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.library-unread {
  margin-top: var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--muted);
}

.library-list {
  margin-top: 20px;
  border-top: 1px solid var(--line);
}

.item {
  position: relative;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 72px;
  gap: 20px;
  align-items: start;
  padding: 16px 12px;
  border-bottom: 1px solid var(--line);
  color: inherit;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.item:hover {
  background: var(--surface);
}

.item:hover .item-title {
  color: var(--norte);
}

.item:hover .actions,
.item:focus-within .actions {
  opacity: 1;
  pointer-events: auto;
}

.item-thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-sm);
  background: var(--sunken);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--muted);
}

.item-thumb-image {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.item-dot {
  position: absolute;
  left: -10px;
  top: 28px;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--norte);
}

.item-main {
  min-width: 0;
}

.item-title {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  text-decoration: none;
  border-radius: var(--radius-xs);
  transition: color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.item-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.item-meta > span {
  white-space: nowrap;
}

.item-kind {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
}

.tag-cur {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--norte-soft);
  color: var(--norte);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.item-date {
  justify-self: end;
  font-size: 12px;
  line-height: 20px;
  color: var(--muted);
}

.actions {
  position: absolute;
  right: 12px;
  top: 14px;
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.act {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.act:hover {
  background: var(--sunken);
  color: var(--ink);
}

.item-title:focus-visible,
.act:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.library-search {
  /*
    Narrow basis, wide ceiling: the row is laid out as if the box were 140px,
    which is what leaves the tabs their line, and the box then grows into the
    space nothing else claimed.
  */
  flex: 1 1 140px;
  min-width: 96px;
  max-width: 240px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 13px;
}

.library-search::placeholder {
  color: var(--muted);
}

.library-search:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

/* The ranked list answers over every shelf and takes no text query. */
.library-search:disabled {
  color: var(--muted);
  cursor: default;
}

.library-search-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.library-loading,
.library-error {
  padding: 48px 12px;
  font-size: 15px;
  line-height: 24px;
  color: var(--muted);
  max-width: 48ch;
}

.library-error p {
  margin: 0 0 var(--space-2);
}

.library-write-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: 13px;
  line-height: 20px;
  color: var(--danger);
}

.library-empty {
  padding: 48px 12px;
  font-size: 15px;
  line-height: 24px;
  color: var(--muted);
  max-width: 48ch;
}

.library-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 12px;
}

.library-more-error { color: var(--danger); font-size: 12px; }
.library-surprise { flex: none; height: 30px; border: 1px solid var(--line-strong); }
.library-nothing { margin-top: var(--space-4); }
.library-more { height: 32px; border: 1px solid var(--line-strong); }

.library-count {
  margin-left: auto;
  text-align: right;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}

@media (max-width: 900px) {
  /*
    The whole head is one wrapping column on a phone: the row of five tabs and
    the row of tools are each wider than the screen, and `space-between` on a
    wrapped line leaves the second one starting halfway across.
  */
  .library-head,
  .library-title-row {
    align-items: flex-start;
    gap: var(--space-2);
  }

  .library-head {
    flex-direction: column;
  }

  .library-tools {
    width: 100%;
    justify-content: flex-start;
  }

  /*
    The tabs give up their `flex: none` here: five of them are wider than a
    phone, and holding their line means holding a width the screen has to
    scroll sideways to show. Allowed to shrink, the control wraps its own
    options instead -- which is what it is built to do.
  */
  .library-tabs {
    flex: 0 1 auto;
    min-width: 0;
  }

  /*
    No floor and no ceiling on a phone: the box takes whatever is left on its
    line, and a minimum of 96px is what pushed the two menus off the screen.
  */
  .library-search {
    min-width: 0;
    max-width: none;
  }

  .item {
    grid-template-columns: 48px minmax(0, 1fr) 40px;
  }

  .item-date {
    display: none;
  }

  .item-thumb {
    width: 48px;
    height: 48px;
  }

  .item-more {
    width: 40px;
    height: 40px;
    justify-self: end;
  }

  /*
    Tapped open, not hovered open: the group is a popover under the button it
    came from, and hover plays no part in it because there is no pointer to
    hover with.
  */
  .actions {
    top: 56px;
    z-index: 25;
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
