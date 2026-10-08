import type { LibraryItem, LibraryKind, MaterialKind } from '@/mock/types'

const MATERIAL_KINDS = new Set<MaterialKind>(['post', 'livro', 'paper'])

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  post: 'Artigo',
  livro: 'Livro',
  paper: 'PDF',
  video: 'Vídeo',
  podcast: 'Podcast',
  curso: 'Curso'
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
