import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarRow } from '../types'
import { useProjectsSearchIndex, useProjectsSummary } from './data/composables'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/projetos',
    name: 'projetos',
    component: () => import('./views/ProjectsView.vue'),
    meta: { title: 'Projetos' }
  },
  {
    path: '/areas/:id',
    name: 'area',
    component: () => import('./views/AreaView.vue'),
    meta: { title: 'Área' },
    props: (route: { params: Record<string, unknown> }) => ({ id: String(route.params.id ?? '') })
  },
  {
    path: '/projetos/:id',
    name: 'projeto',
    component: () => import('./views/ProjectView.vue'),
    meta: { title: 'Projeto' },
    props: (route: { params: Record<string, unknown>; query: Record<string, unknown> }) => ({
      id: String(route.params.id ?? ''),
      tasksExpanded: route.query.tasksExpanded === '1'
    })
  },
  {
    path: '/decisoes/:id',
    name: 'decisao',
    component: () => import('./views/DecisionView.vue'),
    meta: { title: 'Decisão' },
    props: (route: { params: Record<string, unknown>; query: Record<string, unknown> }) => ({
      id: String(route.params.id ?? ''),
      preselect: route.query.preselect === '1' || route.query.preselect === 'true'
    })
  },
  {
    path: '/tarefas/:id',
    name: 'tarefa',
    component: () => import('./views/TaskView.vue'),
    meta: { title: 'Tarefa' },
    props: (route: { params: Record<string, unknown> }) => ({ id: String(route.params.id ?? '') })
  }
]

export function useSidebar(): ModuleSidebar {
  const { data: summary } = useProjectsSummary()

  function areaRows(): SidebarRow[] {
    const rows: SidebarRow[] = (summary.value?.areas ?? [])
      .filter((area) => !area.archived)
      .map((area) => ({
        id: `area-${area.id}`,
        label: area.title,
        to: { name: 'area', params: { id: area.id } },
        count: area.projects
      }))
    rows.push({ id: 'nova-area', label: 'Nova área', to: { name: 'projetos' }, icon: 'plus', trackActive: false })
    return rows
  }

  return {
    sections: [
      {
        id: 'projetos',
        label: 'Projetos',
        to: { name: 'projetos' },
        order: 30,
        activeRouteNames: ['projetos', 'projeto', 'area'],
        count: () => summary.value?.counts.projects ?? 0,
        rows: areaRows
      }
    ],
    shortcuts: []
  }
}

export const homeBlocks = []

const SCREEN_ENTRY: SearchEntry = {
  group: 'Projetos',
  title: 'Projetos',
  subtitle: 'Áreas, decisões e tarefas',
  kind: 'tela',
  keywords: 'areas decisoes tarefas',
  to: { name: 'projetos' }
}

/** The projects screen plus every area, project, decision and task it holds. */
export function useSearchEntries(): ComputedRef<SearchEntry[]> {
  const { data: index } = useProjectsSearchIndex()

  return computed(() => {
    const current = index.value
    if (!current) return [SCREEN_ENTRY]
    return [
      SCREEN_ENTRY,
      ...current.areas.map<SearchEntry>((area) => ({
        group: 'Projetos',
        title: area.title,
        subtitle: area.intention,
        kind: 'área',
        keywords: area.archived ? 'arquivada' : 'ativa',
        to: { name: 'area', params: { id: area.id } }
      })),
      ...current.projects.map<SearchEntry>((project) => ({
        group: 'Projetos',
        title: project.title,
        subtitle: project.purpose,
        kind: 'projeto',
        keywords: `${project.status} ${project.priority}`,
        to: { name: 'projeto', params: { id: project.id } }
      })),
      ...current.decisions.map<SearchEntry>((decision) => ({
        group: 'Projetos',
        title: decision.title,
        subtitle: decision.context,
        kind: 'decisão',
        keywords: decision.status,
        to: { name: 'decisao', params: { id: decision.id } }
      })),
      ...current.tasks.map<SearchEntry>((task) => ({
        group: 'Projetos',
        title: task.title,
        subtitle: task.description,
        kind: 'tarefa',
        keywords: `${task.bucket} ${task.priority}`,
        to: { name: 'tarefa', params: { id: task.id } }
      }))
    ]
  })
}

const projectsModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default projectsModule
