import type { MaterialStatus } from '@/components/ds/MaterialRow.vue'
import type { ModuleStatus } from '@/components/ds/ModuleItem.vue'
import type { Curriculum, CurriculumModule, LibraryItem, LibraryKind, MaterialKind } from '@/mock/types'
import { crossModuleActionAllowed } from '@/modules/mounting'

/** The slug that opens the screen as an empty "new curriculum" form. */
export const NEW_CURRICULUM_SLUG = 'new'

const KIND_LABELS: Record<LibraryKind, string> = {
  article: 'Post',
  book: 'Livro',
  paper: 'Paper',
  video: 'Vídeo',
  podcast: 'Podcast',
  course: 'Curso'
}

const READABLE_KINDS: MaterialKind[] = ['article', 'book', 'paper']

export interface EditableModule {
  id: string
  title: string
}

export interface CurriculumDraft {
  title: string
  goal: string
  modules: EditableModule[]
}

export interface MaterialView {
  id: string
  n: number
  title: string
  by: string
  /** The O/P marker the curriculum uses, followed by the kind: "O · Livro". */
  type: string
  optional: boolean
  status: MaterialStatus
  /** Where the title leads: the reading screen for readable kinds, the source otherwise. */
  href: string
  /** The external source, shown as the trailing icon only when the title stays in the app. */
  url?: string
}

export interface ModuleView {
  id: string
  label: string
  title: string
  short: string
  summary: string
  duration: string
  meta: string
  status: ModuleStatus
  statusText: string
  materials: MaterialView[]
  exercises: { n: string; title: string; prompt: string }[]
  instrument?: CurriculumModule['instrument']
  evaluation?: string
}

export interface CurriculumView {
  modules: ModuleView[]
  /** Required materials finished over required materials in the whole curriculum. */
  requiredDone: number
  requiredTotal: number
  materialCount: number
  exerciseCount: number
  weeks: number
  /** The first unfinished required material, the one "Continuar" points at. */
  next?: MaterialView
  summaryLine: string
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** A material is done once its library item has been read, and skipped once it is archived unread. */
function libraryStatus(item: LibraryItem | undefined): MaterialStatus | undefined {
  if (!item) return undefined
  if (!item.unread) return 'done'
  if (item.location === 'archive') return 'skipped'
  return undefined
}

/**
 * Where a material's title leads.
 *
 * A readable kind opens in the app, but only while the library reads from the
 * same place this module does: these ids come from the study slice, and the
 * library's own reader resolves ids against the server. Sending a mock id to
 * an API-backed screen produces a reader with nothing in it, so the crossing
 * is gated by the same rule as any other, and the source stands in for it.
 */
export function materialHref(item: LibraryItem): string {
  const readable = (READABLE_KINDS as LibraryKind[]).includes(item.kind)
  if (readable && crossModuleActionAllowed('study', 'library')) return `/material/${item.kind}/${item.id}`
  return item.url
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function buildCurriculumView(curriculum: Curriculum, libraryItems: LibraryItem[]): CurriculumView {
  const byId = new Map(libraryItems.map((item) => [item.id, item]))
  let currentTaken = false
  let requiredDone = 0
  let requiredTotal = 0
  let materialCount = 0
  let exerciseCount = 0
  let weeks = 0
  let next: MaterialView | undefined

  const modules = curriculum.modules.map((module, moduleIndex) => {
    let moduleRequired = 0
    let moduleRequiredDone = 0

    const materials = module.materials.flatMap<MaterialView>((material, index) => {
      const item = byId.get(material.libraryItemId)
      if (!item) return []
      const resolved = libraryStatus(item)
      // Exactly one material is "current": the first required one still waiting to be read.
      const isCurrent = resolved === undefined && material.required && !currentTaken
      if (isCurrent) currentTaken = true
      const status: MaterialStatus = resolved ?? (isCurrent ? 'current' : 'next')
      const href = materialHref(item)
      // The trailing source icon only makes sense beside a title that stays in
      // the app; when the title already leads to the source, it would repeat it.
      const staysInApp = href !== item.url
      const view: MaterialView = {
        id: material.id,
        n: index + 1,
        title: item.title,
        by: item.author,
        type: `${material.required ? 'O' : 'P'} · ${KIND_LABELS[item.kind]}`,
        optional: !material.required,
        status,
        href,
        ...(staysInApp ? { url: item.url } : {})
      }
      if (material.required) {
        moduleRequired += 1
        if (status === 'done') moduleRequiredDone += 1
      }
      if (isCurrent && !next) next = view
      return [view]
    })

    requiredTotal += moduleRequired
    requiredDone += moduleRequiredDone
    materialCount += materials.length
    exerciseCount += module.exercises.length
    weeks += module.weeks ?? 0

    const done = moduleRequired > 0 && moduleRequiredDone === moduleRequired
    const holdsCurrent = materials.some((material) => material.status === 'current')
    const status: ModuleStatus = done ? 'done' : holdsCurrent ? 'current' : 'next'
    const duration = module.weeks ? `${plural(module.weeks, 'semana', 'semanas')}` : ''
    const metaParts = [duration]
    if (materials.length > 0) metaParts.push(`${plural(materials.length, 'material', 'materiais')}, ${moduleRequired} obrigatórios`)
    if (module.exercises.length > 0) metaParts.push(plural(module.exercises.length, 'exercício', 'exercícios'))

    return {
      id: module.id,
      label: pad(moduleIndex + 1),
      title: module.title,
      short: module.title,
      summary: module.summary,
      duration,
      meta: metaParts.filter(Boolean).join(' · '),
      status,
      statusText: done ? 'Concluído' : status === 'current' ? `Em andamento · ${moduleRequiredDone}/${moduleRequired}` : '',
      materials,
      exercises: module.exercises.map((exercise, index) => ({ n: pad(index + 1), title: exercise.title, prompt: exercise.prompt })),
      ...(module.instrument ? { instrument: module.instrument } : {}),
      ...(module.evaluation ? { evaluation: module.evaluation } : {})
    }
  })

  const summaryParts = [
    weeks > 0 ? `≈ ${plural(weeks, 'semana', 'semanas')}` : '',
    plural(modules.length, 'módulo', 'módulos'),
    materialCount > 0 ? `${plural(materialCount, 'material', 'materiais')}, ${requiredTotal} obrigatórios` : 'sem materiais ainda'
  ]

  return {
    modules,
    requiredDone,
    requiredTotal,
    materialCount,
    exerciseCount,
    weeks,
    ...(next ? { next } : {}),
    summaryLine: summaryParts.filter(Boolean).join(' · ')
  }
}
