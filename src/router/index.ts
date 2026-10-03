import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import BlankView from '../views/BlankView.vue'
import DsGallery from '../views/DsGallery.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'inicio', component: BlankView },
  { path: '/biblioteca', name: 'biblioteca', component: BlankView },
  { path: '/notas', name: 'notas', component: BlankView },
  { path: '/revisao', name: 'revisao', component: BlankView },
  { path: '/estudo', name: 'estudo', component: BlankView },
  { path: '/curriculos/:slug', name: 'curriculo', component: BlankView },
  { path: '/material/:kind/:id', name: 'material', component: BlankView },
  { path: '/projetos', name: 'projetos', component: BlankView },
  { path: '/areas/:id', name: 'area', component: BlankView },
  { path: '/projetos/:id', name: 'projeto', component: BlankView },
  { path: '/decisoes/:id', name: 'decisao', component: BlankView },
  { path: '/tarefas/:id', name: 'tarefa', component: BlankView },
  { path: '/_ds', name: 'ds-gallery', component: DsGallery }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
