import { norteModules } from '@/modules'
import { isModuleMounted } from '@/modules/mounting'
import type { HomeBlock, ModuleName, NorteModule, SidebarLink, SidebarRow, SidebarSection, SidebarShortcutGroup } from '@/modules/types'

/** The mounted modules, in registry order. */
export function mountedModules(): NorteModule[] {
  return norteModules.filter((module) => isModuleMounted(module.manifest.name))
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
export function sidebarTree(modules: NorteModule[] = mountedModules()): SidebarTree[] {
  const sections = modules.flatMap((module) => module.sidebar.sections.map((section) => ({ module: module.manifest.name, section })))
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

export function sidebarShortcuts(modules: NorteModule[] = mountedModules()): SidebarShortcutGroup[] {
  return modules.flatMap((module) => module.sidebar.shortcuts).sort((left, right) => left.order - right.order)
}

export function homeBlocks(region: HomeBlock['region'], modules: NorteModule[] = mountedModules()): HomeBlock[] {
  return modules
    .flatMap((module) => module.homeBlocks)
    .filter((block) => block.region === region)
    .sort((left, right) => left.order - right.order)
}
