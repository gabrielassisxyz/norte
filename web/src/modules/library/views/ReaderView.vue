<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { formatShortDate } from '@/lib/clock'
import { useSources } from '@/sources'

import ArticleContent from '../components/ArticleContent.vue'
import { useLibraryItem } from '../data/composables'
import { libraryItemChanged } from '../data/revision'
import { parseHeadings, type LibraryStatus, type ReadPosition } from '../data/source'

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

const STATUS_ACTIONS: Array<{ status: LibraryStatus; label: string }> = [
  { status: 'inbox', label: 'Inbox' },
  { status: 'depois', label: 'Depois' },
  { status: 'arquivo', label: 'Arquivo' }
]

const route = useRoute()
const { library } = useSources()

const itemId = computed(() => (Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) ?? '')

const { data: item, loading, error, refresh, apply } = useLibraryItem(itemId)
const writing = useAsyncAction()

const scroller = ref<HTMLElement>()

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

watch(
  () => [itemId.value, item.value?.extract_status] as const,
  ([, status], previous) => {
    if (previous && previous[0] !== itemId.value) pollAttempt = 0
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
let pendingPosition: ReadPosition | null = null
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
 * The heading nearest above the top of the viewport.
 *
 * The anchor is what survives a re-extraction — a percent of an article whose
 * text changed points somewhere else — so it is the position's first answer and
 * the percent is the fallback.
 */
function anchorAboveViewport(container: HTMLElement): string | undefined {
  const headings = parseHeadings(item.value?.content_headings)
  let found: string | undefined
  for (const heading of headings) {
    const element = container.querySelector(`[id="${CSS.escape(heading.anchor)}"]`)
    if (!(element instanceof HTMLElement)) continue
    if (element.offsetTop > container.scrollTop + 1) break
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
  const id = itemId.value
  const position = pendingPosition
  pendingPosition = null
  if (!id || !position) return
  // The response is not applied: a position is invisible on screen, and
  // replacing the record under the reader for it would restart the article's
  // decoration for no change the reader can see.
  await writing.run(() => library.patchItem(id, { read_position: position }))
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
  if (!container) return
  const anchor = anchorAboveViewport(container)
  pendingPosition = { v: 1, ...(anchor ? { anchor } : {}), percent: scrollFraction(container) }
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
  const anchor = position.anchor
    ? container.querySelector(`[id="${CSS.escape(position.anchor)}"]`)
    : null
  if (anchor instanceof HTMLElement) {
    container.scrollTop = anchor.offsetTop
  } else if (typeof position.percent === 'number') {
    const scrollable = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = Math.min(1, Math.max(0, position.percent)) * scrollable
  }
  // The guard outlives this task: the scroll event the assignment above causes
  // is delivered later, and it is exactly the one that must be ignored.
  setTimeout(() => {
    restoring = false
  }, 0)
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
  pendingPosition = null
  clearPositionTimer()
})

onBeforeUnmount(clearPositionTimer)

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
      <div class="reader-top-actions">
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

    <div ref="scroller" class="reader-scroll" @scroll="handleScroll">
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
        </section>

        <p v-if="item.why" class="reader-why">{{ item.why }}</p>

        <div class="reader-rule" />

        <p v-if="extracting" class="reader-pending" role="status">Extraindo o texto deste material…</p>

        <div v-else-if="failed" class="reader-failed" role="alert">
          <p>A extração falhou: {{ item.extract_error ?? 'motivo não informado' }}</p>
          <Button data-action="retry-extraction" variant="secondary" @click="retryExtraction">
            Tentar extrair de novo
          </Button>
        </div>

        <p v-else-if="!articleHtml" class="reader-pending">Este material não tem texto extraído.</p>

        <ArticleContent v-else :html="articleHtml" />
      </div>
    </div>
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

.reader-failed { display: grid; gap: var(--space-3); justify-items: start; }
.reader-failed p { margin: 0; color: var(--danger); font-size: 15px; line-height: 24px; }
</style>
