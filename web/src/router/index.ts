import type { Router, RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import { norteModules } from '@/modules'
import { isModuleMounted } from '@/modules/mounting'
import type { NorteModule } from '@/modules/types'
import { isShellChunkLoadFailure, reportShellNavigationFailure } from '@/shell/navigationFailure'

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

/**
 * The address nothing else claims.
 *
 * Last in every table it appears in, and matched last whatever the order,
 * because its path scores below any literal segment. Without it `RouterView`
 * rendered nothing for an unknown address, which looks exactly like a screen
 * that failed to draw.
 */
export const notFoundRoute: RouteRecordRaw = {
  path: '/:unmatchedPath(.*)*',
  name: 'nao-encontrado',
  component: () => import('@/shell/NotFoundView.vue'),
  meta: { title: 'Página não encontrada' }
}

export function createRouteTable(modules: NorteModule[] = norteModules): RouteRecordRaw[] {
  const mounted = modules.filter((module) => isModuleMounted(module.manifest.name))
  const disabled = modules.filter((module) => !isModuleMounted(module.manifest.name))
  return [
    ...shellRoutes,
    ...mounted.flatMap((module) => module.routes),
    ...disabled.flatMap(disabledModuleRoutes),
    notFoundRoute
  ]
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
  ...norteModules.flatMap((module) => module.routes),
  notFoundRoute
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

/** The browser tab's title for a route, which is how a tab is told from another. */
export function shellDocumentTitle(title?: string): string {
  return title ? `${title} \u00b7 Norte` : 'Norte'
}

/**
 * The two things the live router does beyond matching: name the tab, and say
 * when a navigation never arrived.
 *
 * Both are installed rather than written inline so a test can apply them to a
 * router of its own; the singleton below is only the first caller.
 *
 * A failed navigation is reported rather than swallowed because every screen is
 * a dynamic import: with the server gone, a click on a screen nobody has
 * visited yet failed to fetch its chunk and vue-router abandoned the
 * navigation, leaving the previous screen on display and the click looking
 * ignored. `vite:preloadError` covers the same failure when it happens in the
 * module preload the browser started ahead of the import.
 */
export function installShellRouterBehaviour(router: Router): void {
  // The address being navigated to, which is the one worth retrying. The
  // current route is still the previous screen while a navigation is in
  // flight, and it is the only address `vite:preloadError` could otherwise be
  // told -- that event carries the chunk that failed, never the route that
  // asked for it.
  let pendingPath: string | null = null

  router.beforeEach((to) => {
    pendingPath = to.fullPath
  })

  router.afterEach((to) => {
    pendingPath = null
    if (typeof document !== 'undefined') document.title = shellDocumentTitle(to.meta.title)
  })

  router.onError((error, to) => {
    if (isShellChunkLoadFailure(error)) reportShellNavigationFailure(to.fullPath)
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('vite:preloadError', () => {
      if (pendingPath) reportShellNavigationFailure(pendingPath)
    })
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

installShellRouterBehaviour(router)

export default router
