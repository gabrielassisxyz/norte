import { ref, type Ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import type { SearchResult } from '@/search'
import { useSources } from '@/sources'

import type { CoreSearchHit } from './data/source'

/** One row of the palette: a screen to go to, a thing to open, or an action. */
export interface PaletteRow {
  /** Unique within one rendering, which is what the ARIA option ids are built from. */
  key: string
  title: string
  subtitle: string
  kind: string
  to?: RouteLocationRaw
  action?: 'theme' | 'prefs'
}

export interface PaletteGroup {
  label: string
  items: PaletteRow[]
}

/**
 * The heading a module's hits are shown under. The module name is the key
 * because that is what the server sends; `core` covers the subjects, which
 * belong to no module.
 *
 * An unknown module falls back to its own name rather than being dropped: a
 * module added to the server before this map hears about it should show its
 * hits under something imperfect, not nothing.
 */
const GROUP_LABELS: Record<string, string> = {
  core: 'Assuntos',
  library: 'Biblioteca',
  notes: 'Notas',
  study: 'Estudo',
  projects: 'Projetos',
  review: 'Revisão'
}

/**
 * The word shown on the right of a row. The server sends the type as the
 * owning module spells it, which is English for the kinds the person never
 * typed themselves.
 */
const KIND_LABELS: Record<string, string> = {
  subject: 'subject',
  annotation: 'anotação',
  note: 'nota',
  question: 'pergunta'
}

export function paletteGroupLabel(module: string): string {
  return GROUP_LABELS[module] ?? module
}

export function paletteKindLabel(type: string): string {
  return KIND_LABELS[type] ?? type
}

/**
 * The palette's rows for a query: the shell's static screen index first, then
 * each source's hits as the server ordered them.
 *
 * The screens come first and unsorted against the hits on purpose. They are
 * the one thing the palette can answer with no round trip, so they are there
 * the moment a letter is typed and must not jump around as the server's
 * answers arrive. The hits keep the server's order, which is the merge's
 * documented one — score, then title, then id — and grouping them by module
 * in order of first appearance preserves it inside every group.
 */
export function mergePaletteResults(screens: SearchResult[], hits: CoreSearchHit[]): PaletteGroup[] {
  const groups: PaletteGroup[] = []
  if (screens.length > 0) {
    groups.push({
      label: 'Telas',
      items: screens.map((screen) => ({
        key: `tela:${screen.title}`,
        title: screen.title,
        subtitle: screen.subtitle,
        kind: screen.kind,
        to: screen.to
      }))
    })
  }
  for (const hit of hits) {
    const label = paletteGroupLabel(hit.module)
    const row: PaletteRow = {
      key: `${hit.module}:${hit.id}`,
      title: hit.title,
      subtitle: hit.subtitle ?? '',
      kind: paletteKindLabel(hit.type),
      to: hit.path
    }
    const group = groups.find((candidate) => candidate.label === label)
    if (group) group.items.push(row)
    else groups.push({ label, items: [row] })
  }
  return groups
}

export interface PaletteSearchState {
  hits: Ref<CoreSearchHit[]>
  pending: Ref<boolean>
  /** The server's own sentence when the last query failed, else null. */
  failure: Ref<string | null>
  search(query: string): Promise<void>
  reset(): void
}

/**
 * The palette's server-side half: one request per query, with the previous one
 * aborted.
 *
 * The abort is the whole point of this composable existing. Someone typing
 * "memória" sends seven queries, and the sixth answer may arrive after the
 * seventh — so without cancellation the palette settles on results for a word
 * that is no longer in the box. Aborting also frees the connection rather
 * than leaving the browser holding six it will throw away.
 *
 * Two guards, not one. The signal stops the request, and the identity check
 * (`controller !== current`) stops a reply that had already been handed over
 * by the time the abort fired from writing to `hits` on its way out.
 */
export function usePaletteSearch(): PaletteSearchState {
  const { core } = useSources()
  const hits = ref<CoreSearchHit[]>([])
  const pending = ref(false)
  const failure = ref<string | null>(null)
  let current: AbortController | null = null

  function abortCurrent(): void {
    current?.abort()
    current = null
  }

  function reset(): void {
    abortCurrent()
    hits.value = []
    pending.value = false
    failure.value = null
  }

  async function search(query: string): Promise<void> {
    const trimmed = query.trim()
    if (!trimmed) {
      reset()
      return
    }
    abortCurrent()
    const controller = new AbortController()
    current = controller
    pending.value = true
    failure.value = null
    try {
      const answered = await core.search(trimmed, controller.signal)
      if (controller !== current) return
      hits.value = answered
    } catch (error) {
      if (controller !== current) return
      hits.value = []
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (controller === current) {
        pending.value = false
        current = null
      }
    }
  }

  return { hits, pending, failure, search, reset }
}
