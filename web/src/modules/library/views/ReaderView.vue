<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatShortDate } from '@/lib/clock'
import { usePhoneViewport } from '@/lib/phoneViewport'
import { useSources } from '@/sources'

import ArticleContent from '../components/ArticleContent.vue'
import { useLibraryItem } from '../data/composables'
import { libraryItemChanged } from '../data/revision'
import { readerSlotEntries, type ReaderLiveSelection, type ReaderNotesRequest } from '../readerSlots'
import { parseHeadings, type LibraryStatus, type ReadPosition } from '../data/source'
import ReaderActionBar from './ReaderActionBar.vue'
import ReaderNotesSheet from './ReaderNotesSheet.vue'

/**
 * How often the reader asks again while the text is still being extracted.
 *
 * Extraction of a page that is already downloaded takes well under a second, so
 * the first three asks are quick and catch the common case; after that the job
 * is queued behind something, waiting on the network, or stuck, and none of
 * those is helped by asking ten times a minute.
 */
const POLL_DELAYS_MS = [1000, 2000, 4000]
const STEADY_POLL_MS = 10_000

/**
 * How long the reader waits before recording where reading stopped.
 *
 * A scroll produces events continuously, and the position is only interesting
 * once movement has settled; two seconds is long enough that a flick through
 * the article writes once rather than forty times.
 */
const POSITION_DEBOUNCE_MS = 2000

/**
 * How far from the saved percent the saved heading may sit and still be taken
 * as the better answer, as a fraction of the article's scrollable extent.
 *
 * The anchor is the last heading *above* the viewport, so on a long section it
 * names a place far behind where reading stopped — following it put someone who
 * stopped at 45% back at the top of the section, and at 90% back at the middle
 * of the article. The percent is therefore the position, and the heading only
 * sharpens it when the two already agree, which is the case the anchor was
 * added for: a re-extraction that moved the text by a little and left the
 * percent pointing a line or two off.
 */
const ANCHOR_CORRECTION = 0.01

/**
 * How long a selection has to hold still before the reader reads it.
 *
 * A touch selection is the reason this exists: dragging a handle fires
 * `selectionchange` on every movement, and reading the range on each one makes
 * the highlight control flicker through every passage the finger passed over.
 * It is also the guard that makes tapping that control work at all, because the
 * tap collapses the selection and the pending read would otherwise clear the
 * passage out from under the handler.
 */
const SELECTION_SETTLE_MS = 200

const STATUS_ACTIONS: Array<{ status: LibraryStatus; label: string }> = [
  { status: 'inbox', label: 'Inbox' },
  { status: 'depois', label: 'Depois' },
  { status: 'arquivo', label: 'Arquivo' }
]

const route = useRoute()
const { library } = useSources()
const phone = usePhoneViewport()

const itemId = computed(() => (Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) ?? '')

const { data: item, loading, error, refresh, apply } = useLibraryItem(itemId)
const writing = useAsyncAction()

const scroller = ref<HTMLElement>()

/**
 * How much context travels with a selected passage, in code points.
 *
 * It matches what the server stores on each side of a highlight. Sending less
 * would make two occurrences of the same sentence indistinguishable, which is
 * exactly the case the server refuses to guess at.
 */
const SELECTION_CONTEXT = 32

/** Nothing has answered yet, as opposed to an answer saying the item is gone. */
const firstLoad = computed(() => loading.value && item.value === null)
const extracting = computed(() => item.value?.extract_status === 'pending')
const failed = computed(() => item.value?.extract_status === 'failed')
const articleHtml = computed(() => item.value?.content_html)
const selection = computed(() => {
  const exact = item.value?.selection?.exact?.trim()
  return exact ? exact : null
})
const readLabel = computed(() => (item.value?.unread ? 'Marcar como lido' : 'Marcar como não lido'))

/* ---------------------------------------------------------------- opening */

/**
 * Opening is recorded once per item, on entry.
 *
 * It is not reading: the server leaves `unread` exactly as it was, so this says
 * "was looked at" and the button below says "was read".
 */
watch(
  itemId,
  async (id) => {
    if (!id) return
    const opened = await writing.run(() => library.openItem(id))
    // The reader may have moved to another item while this one was answering;
    // applying it would put the item just left on the screen of the one asked for.
    if (itemId.value !== id) return
    if (opened) apply(opened)
  },
  { immediate: true }
)

/* --------------------------------------------------------------- polling */

let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollAttempt = 0

function stopPolling(): void {
  if (pollTimer === null) return
  clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll(): void {
  stopPolling()
  const delay = POLL_DELAYS_MS[pollAttempt] ?? STEADY_POLL_MS
  pollAttempt += 1
  pollTimer = setTimeout(() => {
    pollTimer = null
    void (async () => {
      await refresh()
      // Scheduling the next ask from inside this one is what makes a run of
      // `pending` answers keep the backoff going: the status has not changed,
      // so nothing is watching it to start the timer again.
      if (item.value?.extract_status === 'pending') schedulePoll()
    })()
  }, delay)
}

/**
 * The status alone, not the record that carries it.
 *
 * Every poll replaces the held record with a new object, so a watcher over the
 * record — or over a tuple built fresh each time — fires on each answer even
 * when nothing changed, and each of those would schedule another ask on top of
 * the one the poll itself chained. Watching the string means this runs when the
 * extraction actually moves.
 */
watch(
  () => item.value?.extract_status,
  (status) => {
    if (status === 'pending') {
      if (pollTimer === null) schedulePoll()
      return
    }
    pollAttempt = 0
    stopPolling()
  },
  { immediate: true }
)

onBeforeUnmount(stopPolling)

/* ------------------------------------------------------- reading position */

let positionTimer: ReturnType<typeof setTimeout> | null = null
/**
 * The position waiting to be written, and the item it was measured on.
 *
 * The id travels with the position rather than being read when the write goes
 * out, because a write goes out from a move to another article and from the
 * reader being torn down — and by then the route already names somewhere else,
 * so reading the id at that moment stores one article's position on another.
 */
let pendingPosition: { id: string; position: ReadPosition } | null = null
/** True while the reader is putting the view back where it was left. */
let restoring = false
/** The id whose saved position has already been applied. */
let restoredFor = ''

function clearPositionTimer(): void {
  if (positionTimer === null) return
  clearTimeout(positionTimer)
  positionTimer = null
}

/**
 * Where an element sits inside the scroll container, in the container's own
 * scroll coordinates.
 *
 * `offsetTop` is measured from the nearest positioned ancestor, which is the
 * container only while the stylesheet happens to position it; the rectangles
 * do not depend on that.
 */
function offsetWithin(container: HTMLElement, element: HTMLElement): number {
  return container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top
}

/**
 * The heading nearest above the top of the viewport.
 *
 * It is stored beside the percent, not instead of it: a percent of an article
 * whose text changed points somewhere else, and the heading is what says where
 * that somewhere else moved to.
 */
function anchorAboveViewport(container: HTMLElement): string | undefined {
  const headings = parseHeadings(item.value?.content_headings)
  let found: string | undefined
  for (const heading of headings) {
    const element = container.querySelector(`[id="${CSS.escape(heading.anchor)}"]`)
    if (!(element instanceof HTMLElement)) continue
    if (offsetWithin(container, element) > container.scrollTop + 1) break
    found = heading.anchor
  }
  return found
}

function scrollFraction(container: HTMLElement): number {
  const scrollable = container.scrollHeight - container.clientHeight
  if (scrollable <= 0) return 0
  return Math.min(1, Math.max(0, container.scrollTop / scrollable))
}

async function writePosition(): Promise<void> {
  const waiting = pendingPosition
  pendingPosition = null
  if (!waiting) return
  // The response is not applied: a position is invisible on screen, and
  // replacing the record under the reader for it would restart the article's
  // decoration for no change the reader can see.
  await writing.run(() => library.patchItem(waiting.id, { read_position: waiting.position }))
}

/**
 * One position per burst of scrolling.
 *
 * The timer is started by the first event of a burst and not restarted by the
 * ones after it, so a continuous scroll writes on a fixed cadence instead of
 * never writing until the reader stops moving.
 */
function handleScroll(): void {
  if (restoring) return
  const container = scroller.value
  const id = itemId.value
  if (!container || !id) return
  const anchor = anchorAboveViewport(container)
  pendingPosition = {
    id,
    position: { v: 1, ...(anchor ? { anchor } : {}), percent: scrollFraction(container) }
  }
  if (positionTimer !== null) return
  positionTimer = setTimeout(() => {
    positionTimer = null
    void writePosition()
  }, POSITION_DEBOUNCE_MS)
}

/**
 * Put the view back where reading stopped, once and after the final text is on
 * the page.
 *
 * The scroll this causes is not a reading position: without the guard the
 * reader would record the place it had just restored, which over two visits
 * turns a saved anchor into whatever the browser rounded it to.
 */
async function restorePosition(): Promise<void> {
  const record = item.value
  const container = scroller.value
  if (!record || !container) return
  restoredFor = record.id
  const position = record.read_position
  if (!position) return

  restoring = true
  await nextTick()
  const scrollable = Math.max(0, container.scrollHeight - container.clientHeight)
  const anchor = position.anchor
    ? container.querySelector(`[id="${CSS.escape(position.anchor)}"]`)
    : null
  const anchorTop = anchor instanceof HTMLElement ? offsetWithin(container, anchor) : null
  if (typeof position.percent === 'number') {
    const fromPercent = Math.min(1, Math.max(0, position.percent)) * scrollable
    // The heading is taken only when it is already where the percent points.
    const corrects = anchorTop !== null && Math.abs(anchorTop - fromPercent) <= ANCHOR_CORRECTION * scrollable
    container.scrollTop = corrects ? (anchorTop as number) : fromPercent
  } else if (anchorTop !== null) {
    // A position from before the percent was recorded: the heading is all there is.
    container.scrollTop = anchorTop
  }
  // The guard outlives this task: the scroll event the assignment above causes
  // is delivered later, and it is exactly the one that must be ignored.
  // Two frames, because a browser delivers the scroll event at the next
  // rendering opportunity, which a zero-delay timer can beat.
  const settledFor = restoredFor
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (restoredFor === settledFor) restoring = false
    })
  })
}

watch(
  [() => item.value?.id, () => item.value?.extract_status, articleHtml],
  async ([id, status]) => {
    if (!id || status !== 'done' || restoredFor === id) return
    await nextTick()
    await restorePosition()
  },
  { immediate: true }
)

watch(itemId, () => {
  restoredFor = ''
  restoring = false
  clearPositionTimer()
  // The article being left keeps the place reading reached in it. Dropping what
  // the timer was holding is how moving straight to the next article used to
  // lose the last scroll of the previous one.
  void writePosition()
  // A new item is a new extraction to wait for, from the first short delay.
  pollAttempt = 0
  stopPolling()
})

/**
 * The place reading stopped is written on the way out, not dropped.
 *
 * Leaving the reader is exactly when the position matters most, and the
 * debounce means the last scroll of a reading is almost always still waiting:
 * clearing the timer without writing threw away the newest position every
 * time, and the article reopened at the one before it.
 */
onBeforeUnmount(() => {
  clearPositionTimer()
  void writePosition()
})

/* --------------------------------------------------------------- actions */

async function toggleRead(): Promise<void> {
  const record = item.value
  if (!record) return
  const updated = await writing.run(() => library.patchItem(record.id, { unread: !record.unread }))
  if (!updated) return
  apply(updated)
  libraryItemChanged()
}

async function moveTo(status: LibraryStatus): Promise<void> {
  const record = item.value
  if (!record || record.status === status) return
  const updated = await writing.run(() => library.patchItem(record.id, { status }))
  if (!updated) return
  apply(updated)
  libraryItemChanged()
}

/* ----------------------------------------------------------- reader slots */

/**
 * The article's root element and a counter of how many times it has rendered.
 *
 * Another module decorates the text from a slot, and `v-html` replaces the
 * whole subtree on every new value of `content_html`, so the counter is what
 * tells a slot that its decoration is gone and has to be applied again.
 */
const articleRoot = ref<HTMLElement | null>(null)
const renderedAt = ref(0)
const liveSelection = ref<ReaderLiveSelection | null>(null)

function handleArticleRendered(root: HTMLElement): void {
  articleRoot.value = root
  renderedAt.value += 1
}

/**
 * What the person has selected inside the article, as words rather than as
 * offsets.
 *
 * The context is measured against the article's own text: a range's offsets
 * belong to the DOM the browser built, and the server anchors against the text
 * it extracted, which is not the same string.
 */
function readSelection(): void {
  const root = articleRoot.value
  const selection = window.getSelection()
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    liveSelection.value = null
    return
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) {
    liveSelection.value = null
    return
  }
  const exact = range.toString().trim()
  if (!exact) {
    liveSelection.value = null
    return
  }
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.selectNodeContents(root)
  after.setStart(range.endContainer, range.endOffset)
  liveSelection.value = {
    exact,
    prefix: [...before.toString()].slice(-SELECTION_CONTEXT).join(''),
    suffix: [...after.toString()].slice(0, SELECTION_CONTEXT).join('')
  }
}

function clearSelection(): void {
  liveSelection.value = null
}

/**
 * Reading the selection from `selectionchange` as well as from a mouse.
 *
 * A long press and the handles that follow it do not produce a `mouseup`, which
 * was all the reader listened to, so a passage selected by touch was invisible
 * to the highlight control. `selectionchange` is the one event every way of
 * selecting fires, and it is on the document rather than on the article because
 * the browser only offers it there.
 */
let selectionTimer: ReturnType<typeof setTimeout> | null = null

function clearSelectionTimer(): void {
  if (selectionTimer === null) return
  clearTimeout(selectionTimer)
  selectionTimer = null
}

function handleSelectionChange(): void {
  clearSelectionTimer()
  selectionTimer = setTimeout(() => {
    selectionTimer = null
    readSelection()
  }, SELECTION_SETTLE_MS)
}

onMounted(() => document.addEventListener('selectionchange', handleSelectionChange))
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
  clearSelectionTimer()
})

/* ------------------------------------------------------------ phone sheet */

const sheetOpen = ref(false)
const notesSection = ref<ReaderNotesRequest | null>(null)
let notesAsks = 0

/**
 * Show the sheet, carrying the caller's own name for the part of it to show.
 *
 * The reader never reads that name: it belongs to whatever fills the `notes`
 * slot, and passing it through unexamined is what keeps the library from
 * learning another module's vocabulary.
 */
function openNotes(section?: string): void {
  sheetOpen.value = true
  if (section === undefined) return
  notesAsks += 1
  notesSection.value = { section, nth: notesAsks }
}

function closeNotes(): void {
  sheetOpen.value = false
}

function handleReaderKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && sheetOpen.value) closeNotes()
}

onMounted(() => window.addEventListener('keydown', handleReaderKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleReaderKeydown))

// A reader left for another item starts with its sheet shut.
watch(itemId, closeNotes)

/**
 * A search hit for an item's note lands here naming the reader's note
 * section, `?notas=nota`.
 *
 * The name travels through unexamined, the way `openNotes` carries it to
 * whatever fills the notes slot: the reader never learns the panel's
 * vocabulary. The ask waits a tick because the panel only answers a section
 * that changes while it is mounted, and on entry the panel mounts with the
 * item the ask arrived before.
 */
watch(
  [() => item.value?.id, () => route.query.notas],
  async ([id, section]) => {
    if (!id || typeof section !== 'string' || section === '') return
    await nextTick()
    openNotes(section)
  },
  { immediate: true }
)

/**
 * Put a passage in view.
 *
 * It measures with the same rectangles the reading position does, because
 * `offsetTop` is relative to the nearest positioned ancestor and that is the
 * scroll container only while the stylesheet happens to position it.
 */
function scrollToPassage(exact: string): void {
  const container = scroller.value
  const root = articleRoot.value
  if (!container || !root) return
  const marked = root.querySelectorAll('[data-notes-passage]')
  for (const element of marked) {
    if (!(element instanceof HTMLElement)) continue
    if (element.dataset.notesPassage !== exact) continue
    container.scrollTop = offsetWithin(container, element) - 80
    return
  }
}

const selectionSlots = computed(() => readerSlotEntries('selection-actions'))
const notesSlots = computed(() => readerSlotEntries('notes'))
const bottomSlots = computed(() => readerSlotEntries('bottom-actions'))

const slotProps = computed(() => ({
  itemId: itemId.value,
  savedSelection: item.value?.selection ?? null,
  liveSelection: liveSelection.value,
  clearSelection,
  articleRoot: articleRoot.value,
  renderedAt: renderedAt.value,
  scrollToPassage,
  phone: phone.value,
  openNotes,
  notesSection: notesSection.value
}))

async function retryExtraction(): Promise<void> {
  const record = item.value
  if (!record) return
  const queued = await writing.run(() => library.extractItem(record.id))
  if (!queued) return
  // The ack carries the job, not the text; the item says what happened next.
  await refresh()
}
</script>

<template>
  <main v-if="firstLoad" class="reader reader-state" role="status">
    <p>Carregando o material…</p>
  </main>

  <main v-else-if="error" class="reader reader-state" role="alert">
    <p>Não foi possível carregar o material: {{ error }}</p>
    <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
  </main>

  <main v-else-if="!item" class="reader reader-state">
    <p>Este item não está na biblioteca.</p>
    <RouterLink :to="{ name: 'biblioteca', query: { v: 'tudo' } }">Voltar para a Biblioteca</RouterLink>
  </main>

  <main v-else class="reader">
    <header class="reader-top">
      <RouterLink class="reader-back" :to="{ name: 'biblioteca', query: { v: 'tudo' } }">
        <Icon name="arrowLeft" />
        <span>Biblioteca</span>
      </RouterLink>
      <div v-if="!phone" class="reader-top-actions">
        <button
          v-for="action in STATUS_ACTIONS"
          :key="action.status"
          type="button"
          class="reader-chip"
          :class="{ 'is-current': item.status === action.status }"
          :aria-pressed="item.status === action.status"
          @click="moveTo(action.status)"
        >
          {{ action.label }}
        </button>
        <Button
          data-action="read"
          :variant="item.unread ? 'primary' : 'secondary'"
          icon="check"
          @click="toggleRead"
        >
          {{ readLabel }}
        </Button>
      </div>
    </header>

    <p v-if="writing.error.value" class="reader-write-error" role="alert">
      Não foi possível salvar: {{ writing.error.value }}
      <button type="button" class="reader-clear" @click="writing.clear()">Fechar</button>
    </p>

    <div ref="scroller" class="reader-scroll" @scroll="handleScroll" @mouseup="readSelection" @keyup="readSelection">
      <div class="reader-column">
        <div class="reader-meta">
          <span class="reader-mono">{{ item.site ?? item.canonical_url }}</span>
          <span class="reader-mono">{{ formatShortDate(item.saved_at) }}</span>
          <span v-if="item.minutes">{{ item.minutes }} min de leitura</span>
        </div>
        <h1 class="reader-title">{{ item.title }}</h1>
        <p class="reader-byline">
          <span v-if="item.author">{{ item.author }} · </span>
          <a :href="item.url" target="_blank" rel="noopener noreferrer">Abrir original</a>
        </p>

        <section v-if="selection" class="reader-selection" aria-labelledby="reader-selection-label">
          <h2 id="reader-selection-label">Trecho selecionado ao salvar</h2>
          <blockquote>{{ selection }}</blockquote>
          <component
            :is="entry.component"
            v-for="entry in selectionSlots"
            :key="entry.id"
            v-bind="slotProps"
          />
        </section>

        <p v-if="item.why" class="reader-why">{{ item.why }}</p>

        <div class="reader-rule" />

        <p v-if="extracting" class="reader-pending" role="status">
          Extraindo o texto deste material…
          <span v-if="item.extract_error" class="reader-retrying">
            A última tentativa falhou ({{ item.extract_error }}) e o servidor está tentando de novo.
          </span>
        </p>

        <div v-else-if="failed" class="reader-failed" role="alert">
          <p>A extração falhou: {{ item.extract_error ?? 'motivo não informado' }}</p>
          <Button data-action="retry-extraction" variant="secondary" @click="retryExtraction">
            Tentar extrair de novo
          </Button>
        </div>

        <p v-else-if="!articleHtml" class="reader-pending">Este material não tem texto extraído.</p>

        <ArticleContent v-else :html="articleHtml" @rendered="handleArticleRendered" />

        <template v-if="!phone">
          <component :is="entry.component" v-for="entry in bottomSlots" :key="entry.id" v-bind="slotProps" />
          <component :is="entry.component" v-for="entry in notesSlots" :key="entry.id" v-bind="slotProps" />
        </template>
      </div>
    </div>

    <!--
      On a phone the same two slots are rendered somewhere else, not twice: the
      sheet holds what a wide screen puts under the article, and the bar holds
      the actions. The sheet keeps its contents mounted while shut, because they
      are what marks the highlighted passages in the text behind it.
    -->
    <template v-if="phone">
      <ReaderNotesSheet :open="sheetOpen" @close="closeNotes">
        <component :is="entry.component" v-for="entry in notesSlots" :key="entry.id" v-bind="slotProps" />
      </ReaderNotesSheet>
      <ReaderActionBar
        :status="item.status"
        :unread="item.unread"
        :statuses="STATUS_ACTIONS"
        :busy="writing.pending.value"
        @toggle-read="toggleRead"
        @move="moveTo"
      >
        <component :is="entry.component" v-for="entry in bottomSlots" :key="entry.id" v-bind="slotProps" />
      </ReaderActionBar>
    </template>
  </main>
</template>

<style scoped>
.reader {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
}

.reader-state {
  display: grid;
  gap: var(--space-4);
  justify-items: start;
  align-content: start;
  max-width: 48ch;
  padding: 48px 24px;
  color: var(--muted);
  font-size: 15px;
  line-height: 24px;
}

.reader-state p { margin: 0; }

.reader-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: 14px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.reader-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
}

.reader-back:hover { color: var(--norte); }

.reader-top-actions { display: flex; align-items: center; gap: var(--space-2); }

.reader-chip {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.reader-chip.is-current { border-color: var(--norte); background: var(--norte-soft); color: var(--norte); }

.reader-write-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 10px 24px;
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}

.reader-clear {
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.reader-scroll { flex: 1; min-height: 0; overflow-y: auto; }

.reader-column { max-width: 72ch; margin: 0 auto; padding: 40px 24px 96px; }

/* Room under the text for the bar and the sheet, which float over the column. */
@media (max-width: 900px) {
  .reader-column { padding: 20px 16px 180px; }
  .reader-top { padding: 10px 16px; }
  .reader-title { font-size: 26px; line-height: 32px; }
}

.reader-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.reader-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.reader-title {
  margin: 12px 0 8px;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 700;
  line-height: 40px;
  letter-spacing: -0.03em;
}

.reader-byline { margin: 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.reader-byline a { color: var(--norte); }

.reader-selection {
  margin: 24px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--sunken);
}

.reader-selection h2 {
  margin: 0 0 6px;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.reader-selection blockquote {
  margin: 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 24px;
}

.reader-why { margin: 16px 0 0; color: var(--ink-2); font-size: 14px; line-height: 22px; }

.reader-rule { margin: 28px 0; border-top: 1px solid var(--line); }

.reader-pending { margin: 0; color: var(--muted); font-size: 15px; line-height: 24px; }

.reader-retrying { display: block; margin-top: 6px; color: var(--danger); font-size: 13px; line-height: 20px; }

.reader-failed { display: grid; gap: var(--space-3); justify-items: start; }
.reader-failed p { margin: 0; color: var(--danger); font-size: 15px; line-height: 24px; }
</style>
