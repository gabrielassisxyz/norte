import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import Placeholder from '../views/Placeholder.vue'
import DsGallery from '../views/DsGallery.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** Portuguese screen name shown by the placeholder and the document title. */
    title: string
    /** Material screens render without the sidebar. */
    layout?: 'app' | 'bare'
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'inicio', component: Placeholder, meta: { title: 'Início' } },
  { path: '/biblioteca', name: 'biblioteca', component: Placeholder, meta: { title: 'Biblioteca' } },
  { path: '/notas', name: 'notas', component: Placeholder, meta: { title: 'Notas' } },
  { path: '/revisao', name: 'revisao', component: Placeholder, meta: { title: 'Revisão' } },
  { path: '/estudo', name: 'estudo', component: Placeholder, meta: { title: 'Estudo' } },
  { path: '/curriculos/:slug', name: 'curriculo', component: Placeholder, meta: { title: 'Currículo' } },
  {
    path: '/material/:kind/:id',
    name: 'material',
    component: Placeholder,
    meta: { title: 'Material', layout: 'bare' }
  },
  { path: '/projetos', name: 'projetos', component: Placeholder, meta: { title: 'Projetos' } },
  { path: '/areas/:id', name: 'area', component: Placeholder, meta: { title: 'Área' } },
  { path: '/projetos/:id', name: 'projeto', component: Placeholder, meta: { title: 'Projeto' } },
  { path: '/decisoes/:id', name: 'decisao', component: Placeholder, meta: { title: 'Decisão' } },
  { path: '/tarefas/:id', name: 'tarefa', component: Placeholder, meta: { title: 'Tarefa' } }
]

if (import.meta.env.DEV) {
  routes.push({ path: '/_ds', name: 'design-system-gallery', component: DsGallery, meta: { title: 'Galeria' } })
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
