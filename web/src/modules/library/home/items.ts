import type { LibraryItem, LibraryKind, MaterialKind } from '@/mock/types'

/** The day the mock data is written against; the next bead replaces it with the clock. */
export const LIBRARY_TODAY = '2026-10-03'

const MATERIAL_KINDS = new Set<MaterialKind>(['post', 'livro', 'paper'])
const PORTUGUESE_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Artigo',
  livro: 'Livro',
  paper: 'PDF',
  video: 'Vídeo',
  podcast: 'Podcast',
  curso: 'Curso'
}

function calendarTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return timestamp
}

export function formatRelativeDate(savedAt: string, now: string): string {
  const savedTimestamp = calendarTimestamp(savedAt)
  const nowTimestamp = calendarTimestamp(now)
  if (savedTimestamp === null || nowTimestamp === null) return savedAt

  const daysAgo = Math.floor((nowTimestamp - savedTimestamp) / DAY_IN_MILLISECONDS)
  if (daysAgo <= 0) return 'hoje'
  if (daysAgo === 1) return 'ontem'

  const day = savedAt.slice(8, 10).replace(/^0/, '')
  const month = Number(savedAt.slice(5, 7))
  return `${day} ${PORTUGUESE_MONTHS[month - 1] ?? savedAt.slice(5, 7)}`
}

export function isMaterial(item: LibraryItem): item is LibraryItem & { kind: MaterialKind } {
  return MATERIAL_KINDS.has(item.kind as MaterialKind)
}

export function materialHref(item: LibraryItem & { kind: MaterialKind }): string {
  return `/material/${item.kind}/${item.id}`
}

export function domainFor(item: LibraryItem): string {
  if (item.domain) return item.domain
  try {
    return new URL(item.url).hostname.replace(/^www\./, '')
  } catch {
    return 'fonte desconhecida'
  }
}

export function minutesFor(item: LibraryItem): number {
  return item.minutes ?? 8
}
