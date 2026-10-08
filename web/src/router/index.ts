import type { Router, RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import { norteModules } from '@/modules'
import { isModuleMounted } from '@/modules/mounting'
import type { NorteModule } from '@/modules/types'

declare module 'vue-router' {
  interface RouteMeta {
    /** Portuguese screen name shown by the placeholder and the document title. */
    title: string
    /** Material screens render without the sidebar. */
    layout?: 'app' | 'bare'
  }
}

/**
 * The routes that exist whichever modules are on: the home screen, the subject
 * screen, and in development the design-system gallery.
 *
 * The subject screen is here rather than in a module because subjects belong
 * to the core: they are the one linkable thing no module owns, and switching
 * every module off must not take the vocabulary with it.
 */
export const shellRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'inicio', component: () => import('@/shell/HomeView.vue'), meta: { title: 'Início' } },
  {
    path: '/assuntos/:slug',
    name: 'assunto',
    component: () => import('@/shell/SubjectView.vue'),
    meta: { title: 'Assunto' }
  }
]

if (import.meta.env.DEV) {
  shellRoutes.push({
    path: '/_ds',
    name: 'design-system-gallery',
    component: () => import('@/components/ds/gallery/DsGallery.vue'),
    meta: { title: 'Galeria' }
  })
}

/**
 * A module that is off still owns its addresses: the shell answers them with a
 * page that says the module is switched off, rather than letting the address
 * fall through to nothing and look like a broken screen.
 */
export function disabledModuleRoutes(module: NorteModule): RouteRecordRaw[] {
  return module.manifest.routePaths.map((path, index) => ({
    path,
    name: `modulo-desligado-${module.manifest.name}-${index}`,
    component: () => import('@/shell/ModuleDisabled.vue'),
    meta: { title: 'Módulo desligado' }
  }))
}

export function createRouteTable(modules: NorteModule[] = norteModules): RouteRecordRaw[] {
  const mounted = modules.filter((module) => isModuleMounted(module.manifest.name))
  const disabled = modules.filter((module) => !isModuleMounted(module.manifest.name))
  return [...shellRoutes, ...mounted.flatMap((module) => module.routes), ...disabled.flatMap(disabledModuleRoutes)]
}

/**
 * The table the router is created with, before `/api/config` has answered.
 *
 * It holds every module's routes whether or not that module is mounted, which
 * is not the same as `createRouteTable()`: an `api`-backed module counts as off
 * until the config lists it, and building the live table from the mount state
 * would leave the library's addresses answering with the switched-off page
 * before anyone had asked the server anything. `applyMountedModules` prunes
 * what the answer rules out, and prune is all it can do — a route it removed is
 * not something it can put back.
 */
export const routes: RouteRecordRaw[] = [
  ...shellRoutes,
  ...norteModules.flatMap((module) => module.routes)
]

/**
 * Bring a live router in line with the mount state, after `/api/config` has
 * been read.
 *
 * The router is created before the fetch so that the first paint has somewhere
 * to render; pruning it afterwards is what keeps a single router instance
 * instead of swapping one in mid-flight.
 */
export function applyMountedModules(router: Router, modules: NorteModule[] = norteModules): void {
  for (const module of modules) {
    if (isModuleMounted(module.manifest.name)) continue
    for (const route of module.routes) {
      if (route.name && router.hasRoute(route.name)) router.removeRoute(route.name)
    }
    for (const route of disabledModuleRoutes(module)) router.addRoute(route)
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
