import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import AreaView from '../views/AreaView.vue'
import CurriculumView from '../views/CurriculumView.vue'
import DecisionView from '../views/DecisionView.vue'
import Placeholder from '../views/Placeholder.vue'
import ProjectView from '../views/ProjectView.vue'
import ReviewView from '../views/ReviewView.vue'
import DsGallery from '../views/DsGallery.vue'
import HomeView from '../views/HomeView.vue'
import LibraryView from '../views/LibraryView.vue'
import NotesView from '../views/NotesView.vue'
import MaterialView from '../views/MaterialView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import TaskView from '../views/TaskView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** Portuguese screen name shown by the placeholder and the document title. */
    title: string
    /** Material screens render without the sidebar. */
    layout?: 'app' | 'bare'
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'inicio', component: HomeView, meta: { title: 'Início' } },
  { path: '/biblioteca', name: 'biblioteca', component: LibraryView, meta: { title: 'Biblioteca' } },
  { path: '/notas', name: 'notas', component: NotesView, meta: { title: 'Notas' } },
  { path: '/revisao', name: 'revisao', component: ReviewView, meta: { title: 'Revisão' } },
  { path: '/estudo', name: 'estudo', component: Placeholder, meta: { title: 'Estudo' } },
  { path: '/curriculos/:slug', name: 'curriculo', component: CurriculumView, meta: { title: 'Currículo' } },
  {
    path: '/material/:kind/:id',
    name: 'material',
    component: MaterialView,
    meta: { title: 'Material', layout: 'bare' }
  },
  { path: '/projetos', name: 'projetos', component: ProjectsView, meta: { title: 'Projetos' } },
  {
    path: '/areas/:id',
    name: 'area',
    component: AreaView,
    meta: { title: 'Área' },
    props: (route) => ({ id: String(route.params.id ?? '') })
  },
  {
    path: '/projetos/:id',
    name: 'projeto',
    component: ProjectView,
    meta: { title: 'Projeto' },
    props: (route) => ({ id: String(route.params.id ?? ''), tasksExpanded: route.query.tasksExpanded === '1' })
  },
  {
    path: '/decisoes/:id',
    name: 'decisao',
    component: DecisionView,
    meta: { title: 'Decisão' },
    props: (route) => ({
      id: String(route.params.id ?? ''),
      preselect: route.query.preselect === '1' || route.query.preselect === 'true'
    })
  },
  {
    path: '/tarefas/:id',
    name: 'tarefa',
    component: TaskView,
    meta: { title: 'Tarefa' },
    props: (route) => ({ id: String(route.params.id ?? '') })
  }
]

if (import.meta.env.DEV) {
  routes.push({ path: '/_ds', name: 'design-system-gallery', component: DsGallery, meta: { title: 'Galeria' } })
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
