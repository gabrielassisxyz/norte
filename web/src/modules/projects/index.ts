import { computed, type ComputedRef } from 'vue'

import type { SearchEntry } from '@/search'

import type { ModuleSidebar, NorteModule, SidebarRow } from '../types'
import { useProjectsSearchIndex, useProjectsSummary } from './data/composables'
import { manifest } from './manifest'

export { manifest }

export const routes = [
  {
    path: '/projects',
    name: 'projects',
    component: () => import('./views/ProjectsView.vue'),
    meta: { title: 'Projects' }
  },
  {
    path: '/areas/:id',
    name: 'area',
    component: () => import('./views/AreaView.vue'),
    meta: { title: 'Area' },
    props: (route: { params: Record<string, unknown> }) => ({ id: String(route.params.id ?? '') })
  },
  {
    path: '/projects/:id',
    name: 'project',
    component: () => import('./views/ProjectView.vue'),
    meta: { title: 'Project' },
    props: (route: { params: Record<string, unknown>; query: Record<string, unknown> }) => ({
      id: String(route.params.id ?? ''),
      tasksExpanded: route.query.tasksExpanded === '1'
    })
  },
  {
    path: '/decisions/:id',
    name: 'decision',
    component: () => import('./views/DecisionView.vue'),
    meta: { title: 'Decision' },
    props: (route: { params: Record<string, unknown>; query: Record<string, unknown> }) => ({
      id: String(route.params.id ?? ''),
      preselect: route.query.preselect === '1' || route.query.preselect === 'true'
    })
  },
  {
    path: '/tasks/:id',
    name: 'task',
    component: () => import('./views/TaskView.vue'),
    meta: { title: 'Task' },
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
    rows.push({ id: 'new-area', label: 'New area', to: { name: 'projects' }, icon: 'plus', trackActive: false })
    return rows
  }

  return {
    sections: [
      {
        id: 'projects',
        label: 'Projects',
        to: { name: 'projects' },
        order: 30,
        activeRouteNames: ['projects', 'project', 'area'],
        count: () => summary.value?.counts.projects ?? 0,
        rows: areaRows
      }
    ],
    shortcuts: []
  }
}

export const homeBlocks = []

const SCREEN_ENTRY: SearchEntry = {
  group: 'Projects',
  title: 'Projects',
  subtitle: 'Areas, decisions and tasks',
  kind: 'tela',
  keywords: 'areas decisions tasks',
  to: { name: 'projects' }
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
        group: 'Projects',
        title: area.title,
        subtitle: area.intention,
        kind: 'area',
        keywords: area.archived ? 'archived' : 'active',
        to: { name: 'area', params: { id: area.id } }
      })),
      ...current.projects.map<SearchEntry>((project) => ({
        group: 'Projects',
        title: project.title,
        subtitle: project.purpose,
        kind: 'project',
        keywords: `${project.status} ${project.priority}`,
        to: { name: 'project', params: { id: project.id } }
      })),
      ...current.decisions.map<SearchEntry>((decision) => ({
        group: 'Projects',
        title: decision.title,
        subtitle: decision.context,
        kind: 'decision',
        keywords: decision.status,
        to: { name: 'decision', params: { id: decision.id } }
      })),
      ...current.tasks.map<SearchEntry>((task) => ({
        group: 'Projects',
        title: task.title,
        subtitle: task.description,
        kind: 'task',
        keywords: `${task.bucket} ${task.priority}`,
        to: { name: 'task', params: { id: task.id } }
      }))
    ]
  })
}

const projectsModule: NorteModule = { manifest, routes, useSidebar, homeBlocks, useSearchEntries }

export default projectsModule
