<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

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
import LibrarySuggestions from './LibrarySuggestions.vue'
import type {
  LibraryItemSummary,
  LibraryKind,
  LibraryListQuery,
  LibrarySort,
  LibraryShelf,
  LibraryStatus
} from '../data/source'

const VIEWS: LibraryShelf[] = ['inbox', 'depois', 'arquivo', 'tudo']
const VIEW_LABELS: Record<LibraryShelf, string> = {
  inbox: 'Inbox',
  depois: 'Depois',
  arquivo: 'Arquivo',
  tudo: 'Tudo'
}

/**
 * The review queue's tab, which is addressed like a shelf and is not one.
 *
 * It shares the `v` parameter with the shelves because it is one more thing the
 * Biblioteca shows, and a person switching to it and back expects the browser's
 * own back button to do that. It is not a `LibraryShelf`: no library list is
 * read for it, and sending `v=sugestoes` to `/api/library/items` would be
 * asking the server for a shelf that does not exist.
 */
const SUGGESTIONS_TAB = 'sugestoes'

/**
 * The spellings the `tipo` query parameter accepts.
 *
 * The addresses in the sidebar, the prototype and anything already bookmarked
 * use Portuguese plurals; the contract's kinds are singular and English-ish, so
 * the screen translates rather than making the server accept both.
 */
const KIND_BY_TYPE: Record<string, LibraryKind> = {
  artigo: 'post',
  artigos: 'post',
  post: 'post',
  posts: 'post',
  livro: 'livro',
  livros: 'livro',
  pdf: 'paper',
  pdfs: 'paper',
  paper: 'paper',
  papers: 'paper',
  video: 'video',
  videos: 'video',
  'vídeo': 'video',
  'vídeos': 'video',
  podcast: 'podcast',
  podcasts: 'podcast',
  newsletter: 'newsletter',
  newsletters: 'newsletter',
  curso: 'curso',
  cursos: 'curso'
}

const TYPE_TITLES: Record<LibraryKind, string> = {
  post: 'Artigos',
  livro: 'Livros',
  paper: 'PDFs',
  video: 'Vídeos',
  podcast: 'Podcasts',
  newsletter: 'Newsletters',
  curso: 'Cursos'
}

const KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Artigo',
  livro: 'Livro',
  paper: 'PDF',
  video: 'Vídeo',
  podcast: 'Podcast',
  newsletter: 'Newsletter',
  curso: 'Curso'
}

const route = useRoute()
const router = useRouter()
const { library, core, projects: projectsSource } = useSources()
const phone = usePhoneViewport()

const sort = ref<LibrarySort>('saved_desc')
const unreadOnly = ref(false)
const search = ref('')

/** The `v` parameter as it was written, whether or not it names anything. */
const requestedTab = computed<string>(() => {
  const raw = route.query.v
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : ''
})

const showSuggestions = computed(() => requestedTab.value === SUGGESTIONS_TAB)

/** Which tab the control shows as selected, the queue included. */
const activeTab = computed<string>(() => (showSuggestions.value ? SUGGESTIONS_TAB : activeView.value))

const activeView = computed<LibraryShelf>(() =>
  (VIEWS as string[]).includes(requestedTab.value) ? (requestedTab.value as LibraryShelf) : 'inbox'
)

/**
 * How the list is read: by the date each item was saved, or ranked by how
 * closely it relates to what the person is focused on.
 *
 * It is local state and not an address, unlike the shelf: the shelf is
 * something the sidebar links to and a bookmark should survive, while the
 * ranking is a way of looking at whatever shelf is open — and the ranked view
 * answers over every shelf at once, so there is no address it would belong to.
 */
type LibraryOrdering = 'data' | 'agora'

const ORDERING_OPTIONS: Array<{ value: LibraryOrdering; label: string }> = [
  { value: 'data', label: 'Por data' },
  { value: 'agora', label: 'O que ler agora' }
]

const ordering = ref<LibraryOrdering>('data')
// The review queue is not a list of shelf items, so the ranking does not apply
// to it: an ordering chosen on a shelf waits there instead of hiding the tabs
// on a screen whose own tools no longer include the control that would undo it.
const focusRanked = computed(() => ordering.value === 'agora' && !showSuggestions.value)

function setOrdering(value: string): void {
  if (value === 'data' || value === 'agora') ordering.value = value
}

/** The requested type filter, or null for every kind. */
const activeKind = computed<LibraryKind | null>(() => {
  const raw = route.query.tipo
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value === '') return null
  return KIND_BY_TYPE[value.toLowerCase()] ?? null
})

const title = computed(() => (activeKind.value === null ? 'Biblioteca' : TYPE_TITLES[activeKind.value]))

/**
 * A text search is active, which the server answers ranked by relevance.
 *
 * The server refuses an explicit `sort` alongside `q` because the rank is the
 * order, so while text is in the box the screen sends no sort and hides the
 * toggle that would set one — the same way the focus-ranked view hides the
 * controls it supersedes.
 */
const hasSearchText = computed(() => search.value.trim() !== '')

/**
 * What the list is asked for — every filter of it a query parameter.
 *
 * None of this is applied over the rows already held. The server sends one page
 * at a time, so a shelf or an unread filter computed here would narrow the
 * first fifty rows and present the result as the whole shelf.
 */
const query = computed<LibraryListQuery>(() => {
  // The ranked view carries its own order over every shelf, and the server
  // refuses a sort, a text query or unread=false alongside it. The screen
  // sends none of the three rather than relying on that refusal, and hides
  // the controls that would produce them.
  if (focusRanked.value) {
    return { view: 'now', tipo: activeKind.value, unread: null }
  }
  const text = search.value.trim()
  // A text query orders by full-text rank, and the server refuses a sort
  // alongside it: while one is active no sort is sent.
  if (text) {
    return {
      view: activeView.value,
      tipo: activeKind.value,
      unread: unreadOnly.value ? true : null,
      q: text
    }
  }
  return {
    view: activeView.value,
    tipo: activeKind.value,
    unread: unreadOnly.value ? true : null,
    sort: sort.value,
    q: undefined
  }
})

// The shelf is not read while the review queue is on screen: the list is not
// rendered then, and asking for a page nothing displays is a request paid for
// twice over -- once on the way out and again when the person comes back.
const { data: page, loading, error, refresh, hasMore, loadingMore, loadMoreError, loadMore, applyItem } =
  useLibraryItems(query, () => !showSuggestions.value)
const { data: counts } = useLibraryCounts()
const writing = useAsyncAction()

const items = computed<LibraryItemSummary[]>(() => page.value?.items ?? [])

/**
 * The tabs, the shelves counted and the queue not.
 *
 * The queue carries no count on purpose. The only number this screen could
 * print is how many suggestions the first page happens to hold, and labelling
 * that as the size of the queue would be wrong on the second page; there is no
 * endpoint that counts links, and inventing one is not this bead's.
 */
const segOptions = computed(() => [
  ...VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view], count: counts.value?.views[view] ?? 0 })),
  { value: SUGGESTIONS_TAB, label: 'Sugestões' }
])

/** Nothing has arrived yet, as opposed to nothing matching what was asked. */
const firstLoad = computed(() => loading.value && page.value === null)

const emptyText = computed(() => {
  if (focusRanked.value) return 'Nada por ler ligado ao que está em foco agora.'
  if (search.value.trim()) return `Nada encontrado para “${search.value.trim()}”.`
  if (unreadOnly.value) return 'Tudo lido por aqui.'
  if (activeView.value === 'inbox') return 'Inbox vazia. O que entrar pela extensão, upload ou feed aparece aqui.'
  if (activeView.value === 'depois') return 'Nada guardado para depois.'
  if (activeView.value === 'arquivo') return 'Nada arquivado ainda.'
  return 'Nenhum item deste tipo.'
})

/**
 * How many rows are on screen, which is not how many the shelf holds.
 *
 * The total is the counts endpoint's answer; this line counts what has been
 * loaded, because that is the number "carregar mais" changes.
 */
const countText = computed(() => `${items.value.length} ${items.value.length === 1 ? 'item' : 'itens'}`)

const sortLabel = computed(() => (sort.value === 'title' ? 'Título' : 'Data salva'))

function setView(view: string): void {
  if ((VIEWS as string[]).includes(view) || view === SUGGESTIONS_TAB) {
    void router.push({ query: { ...route.query, v: view } })
  }
}

function toggleSort(): void {
  sort.value = sort.value === 'title' ? 'saved_desc' : 'title'
}

function readerTarget(item: LibraryItemSummary): { name: string; params: { id: string } } {
  return { name: 'leitor', params: { id: item.id } }
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
    return 'fonte desconhecida'
  }
}

function laterTitle(item: LibraryItemSummary): string {
  return item.status === 'depois' ? 'Voltar para a inbox' : 'Depois'
}

function archiveTitle(item: LibraryItemSummary): string {
  return item.status === 'arquivo' ? 'Desarquivar' : 'Arquivar'
}

function readTitle(item: LibraryItemSummary): string {
  return item.unread ? 'Marcar como lido' : 'Marcar como não lido'
}

/**
 * Every action here waits for the server and then shows what came back. A
 * failure leaves the row exactly as it was and says so above the list, because
 * a row that moves and then moves back is worse than a row that never moved.
 *
 * The counts are asked for again rather than adjusted here: they are totals
 * over the whole library, and the response to a write carries one row.
 */
async function patch(item: LibraryItemSummary, patchBody: { status?: LibraryStatus; unread?: boolean }): Promise<void> {
  const updated = await writing.run(() => library.patchItem(item.id, patchBody))
  if (!updated) return
  applyItem(updated)
  libraryItemChanged()
}

function toggleLater(item: LibraryItemSummary): Promise<void> {
  return patch(item, { status: item.status === 'depois' ? 'inbox' : 'depois' })
}

function toggleArchive(item: LibraryItemSummary): Promise<void> {
  return patch(item, { status: item.status === 'arquivo' ? 'inbox' : 'arquivo' })
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
      title: `Ler "${item.title}"`,
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
        <h1>{{ title }}</h1>
        <SegmentedControl
          v-if="!focusRanked"
          :options="segOptions"
          :model-value="activeTab"
          label="Estado"
          @change="setView"
        />
      </div>
      <div v-if="!showSuggestions" class="library-tools">
        <SegmentedControl
          class="library-ordering"
          :options="ORDERING_OPTIONS"
          :model-value="ordering"
          label="Ordem"
          @change="setOrdering"
        />
        <button
          type="button"
          class="ghost library-surprise"
          :disabled="drawing.pending.value"
          title="Abrir um item não lido ao acaso, de preferência longe do foco"
          @click="openSurprise()"
        >
          {{ drawing.pending.value ? 'Sorteando…' : 'Surpresa' }}
        </button>
        <label v-if="!focusRanked" class="library-search-label" for="library-search">Buscar na biblioteca</label>
        <input
          v-if="!focusRanked"
          id="library-search"
          v-model="search"
          class="library-search"
          type="search"
          placeholder="Buscar por título ou autor…"
        />
        <button v-if="!focusRanked && !hasSearchText" type="button" class="ghost library-sort" @click="toggleSort">
          {{ sortLabel }}
          <Icon name="chevronDown" :size="14" />
        </button>
        <button
          v-if="!focusRanked"
          type="button"
          class="ghost ghost-icon"
          :class="{ 'is-active': unreadOnly }"
          title="Só não lidos"
          aria-label="Só não lidos"
          :aria-pressed="unreadOnly"
          @click="unreadOnly = !unreadOnly"
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
            <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="unreadOnly && !showSuggestions && !focusRanked" class="library-unread">
      Mostrando só não lidos
      <button type="button" class="ghost ghost-clear" @click="unreadOnly = false">Limpar</button>
    </div>

    <div v-if="focusRanked" class="library-unread">
      Não lidos, primeiro o que está ligado ao foco de agora
    </div>

    <p v-if="nothingToDraw" class="library-unread library-nothing" role="status">
      Nada para ler
    </p>

    <p v-if="drawing.error.value" class="library-write-error" role="alert">
      Não foi possível sortear: {{ drawing.error.value }}
      <button type="button" class="ghost ghost-clear" @click="drawing.clear()">Fechar</button>
    </p>

    <p v-if="writing.error.value" class="library-write-error" role="alert">
      Não foi possível salvar: {{ writing.error.value }}
      <button type="button" class="ghost ghost-clear" @click="writing.clear()">Fechar</button>
    </p>

    <LibrarySuggestions v-if="showSuggestions" />

    <div v-else-if="firstLoad" class="library-loading" role="status">Carregando a biblioteca…</div>

    <div v-else-if="error" class="library-error" role="alert">
      <p>Não foi possível carregar a biblioteca: {{ error }}</p>
      <button type="button" class="ghost" @click="refresh()">Tentar de novo</button>
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
          <Icon name="note" :size="18" />
          <span v-if="item.unread" class="item-dot" role="img" aria-label="Não lido" />
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
          data-action="mais"
          :title="`Ações de ${item.title}`"
          :aria-label="`Ações de ${item.title}`"
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
        <div v-if="rowActionsShown(item)" class="actions" role="group" aria-label="Ações">
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
              title="Ligar a um assunto"
              aria-label="Ligar a um assunto"
              :aria-expanded="openSubjectPicker === item.id"
              @click="toggleSubjectPicker(item)"
            >
              <Icon name="plus" :size="16" />
            </button>
            <div v-if="openSubjectPicker === item.id" class="act-menu act-menu-wide" aria-label="Assuntos">
              <SubjectPicker label="Assunto" @select="linkToSubject(item, $event)" />
            </div>
          </div>
          <div v-if="canMakeTask" class="act-wrap">
            <button
              type="button"
              class="act"
              title="Criar tarefa"
              aria-label="Criar tarefa"
              :aria-expanded="openAction === item.id"
              @click="toggleAction(item)"
            >
              <Icon name="check" :size="16" />
            </button>
            <div v-if="openAction === item.id" class="act-menu" role="menu" aria-label="Projetos">
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

    <div v-if="!showSuggestions && !firstLoad && !error" class="library-foot">
      <button
        v-if="hasMore"
        type="button"
        class="ghost library-more"
        :disabled="loadingMore"
        @click="loadMore()"
      >
        {{ loadingMore ? 'Carregando…' : 'Carregar mais' }}
      </button>
      <span v-if="loadMoreError" class="library-more-error" role="alert">
        Não foi possível carregar mais: {{ loadMoreError }}
      </span>
      <span class="mono library-count">{{ countText }}</span>
    </div>
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
  gap: var(--space-6);
  flex-wrap: wrap;
}

.library-title-row h1 {
  margin: 0;
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
  gap: var(--space-1);
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
  width: 220px;
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
.library-ordering { margin-right: var(--space-2); }
.library-surprise { height: 30px; border: 1px solid var(--line-strong); }
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
