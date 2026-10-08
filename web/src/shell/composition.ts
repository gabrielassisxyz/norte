import { norteModules } from '@/modules'
import { isModuleMounted } from '@/modules/mounting'
import type {
  HomeBlock,
  ModuleName,
  ModuleSidebar,
  NorteModule,
  SidebarLink,
  SidebarRow,
  SidebarSection,
  SidebarShortcutGroup
} from '@/modules/types'

import { useSubjects } from './data/composables'

/** The mounted modules, in registry order. */
export function mountedModules(): NorteModule[] {
  return norteModules.filter((module) => isModuleMounted(module.manifest.name))
}

/** One mounted module's sidebar, already bound to that module's own read. */
export interface ModuleSidebarEntry {
  module: ModuleName
  sidebar: ModuleSidebar
}

/**
 * Every mounted module's sidebar, each bound to its module's source.
 *
 * It calls composables, so it belongs in the setup of the component that
 * renders the sidebar and nowhere else: calling it twice would start every
 * module's read twice.
 */
export function useModuleSidebars(modules: NorteModule[] = mountedModules()): ModuleSidebarEntry[] {
  return modules.map((module) => ({ module: module.manifest.name, sidebar: module.useSidebar() }))
}

/** A section that another module's section has swallowed, with its own rows after. */
export interface SidebarTree {
  section: SidebarSection
  nested: SidebarSection[]
}

/**
 * The sidebar the mounted modules add up to.
 *
 * A section asking to nest under a module gets its wish only while that module
 * is mounted and offers a section to nest in; otherwise it stands on its own,
 * which is what keeps Revisão reachable when Estudo is switched off.
 */
export function sidebarTree(entries: ModuleSidebarEntry[]): SidebarTree[] {
  const sections = entries.flatMap((entry) => entry.sidebar.sections.map((section) => ({ module: entry.module, section })))
  const hosts = new Map<ModuleName, SidebarSection>()
  for (const { module, section } of sections) {
    if (!section.nestUnder && !hosts.has(module)) hosts.set(module, section)
  }

  const trees: SidebarTree[] = []
  const nestedInto = new Map<string, SidebarSection[]>()
  for (const { section } of sections) {
    const host = section.nestUnder ? hosts.get(section.nestUnder) : undefined
    if (!host) {
      trees.push({ section, nested: [] })
      continue
    }
    const siblings = nestedInto.get(host.id) ?? []
    siblings.push(section)
    nestedInto.set(host.id, siblings)
  }

  for (const tree of trees) {
    tree.nested = (nestedInto.get(tree.section.id) ?? []).sort((left, right) => left.order - right.order)
  }
  return trees.sort((left, right) => left.section.order - right.section.order)
}

/** A nested section renders as one more row of its host. */
export function nestedRow(section: SidebarSection): SidebarLink {
  return { id: section.id, label: section.label, to: section.to, count: section.count?.() }
}

export function sectionRows(tree: SidebarTree): SidebarRow[] {
  return [...(tree.section.rows?.() ?? []), ...tree.nested.map(nestedRow)]
}

export function sidebarShortcuts(entries: ModuleSidebarEntry[]): SidebarShortcutGroup[] {
  return entries.flatMap((entry) => entry.sidebar.shortcuts).sort((left, right) => left.order - right.order)
}

export function homeBlocks(region: HomeBlock['region'], modules: NorteModule[] = mountedModules()): HomeBlock[] {
  return modules
    .flatMap((module) => module.homeBlocks)
    .filter((block) => block.region === region)
    .sort((left, right) => left.order - right.order)
}

/**
 * A top-level sidebar block the shell owns rather than a module.
 *
 * It carries no `to` of its own, which is the one way it differs from a
 * module's section: a module's line is a screen you can open, while this is a
 * grouping of addresses with no index page behind it. Subjects are the case —
 * every subject has a page, the set of them does not.
 */
export interface ShellSidebarSection {
  id: string
  label: string
  order: number
  count: () => number | undefined
  rows: () => SidebarRow[]
}

/**
 * The shell's own sidebar blocks: the subjects, which belong to the core and
 * so are there whatever modules the server lists.
 *
 * It calls a composable, so it belongs in the setup of the component that
 * renders the sidebar and nowhere else.
 */
export function useShellSidebarSections(): ShellSidebarSection[] {
  const { data: page } = useSubjects()

  return [
    {
      id: 'assuntos',
      label: 'Assuntos',
      // Ahead of every product: a subject is what the other lines are filed
      // under, and the core is on before any of them.
      order: 5,
      count: () => page.value?.items.length,
      rows: () =>
        (page.value?.items ?? []).map<SidebarRow>((subject) => ({
          id: `assunto-${subject.slug}`,
          label: subject.name,
          to: { name: 'assunto', params: { slug: subject.slug } },
          count: subject.counts.total
        }))
    }
  ]
}
