import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { clearShellNavigationFailure, shellNavigationFailure } from '@/shell/navigationFailure'

import router, { installShellRouterBehaviour, shellDocumentTitle } from './index'

afterEach(() => {
  clearShellNavigationFailure()
})

const APP_PATHS: Array<[string, string]> = [
  ['/', 'inicio'],
  // The subject screen is the shell's, not a module's: subjects belong to the
  // core, so the address answers whatever the server lists.
  ['/assuntos/kubernetes', 'assunto'],
  ['/biblioteca', 'biblioteca'],
  ['/notas', 'notas'],
  ['/revisao', 'revisao'],
  ['/estudo', 'estudo'],
  ['/curriculos/fundamentos-de-compiladores', 'curriculo'],
  ['/material/post/post-compilation', 'material'],
  ['/material/livro/book-interpreters', 'material'],
  ['/material/paper/paper-parsing', 'material'],
  ['/projetos', 'projetos'],
  ['/areas/a-casa', 'area'],
  ['/projetos/project-horta', 'projeto'],
  ['/decisoes/decision-backup-media', 'decisao'],
  ['/tarefas/task-backup', 'tarefa']
]

const TITLES: Record<string, string> = {
  inicio: 'Início',
  assunto: 'Assunto',
  biblioteca: 'Biblioteca',
  notas: 'Notas',
  revisao: 'Revisão',
  estudo: 'Estudo',
  curriculo: 'Currículo',
  material: 'Material',
  projetos: 'Projetos',
  area: 'Área',
  projeto: 'Projeto',
  decisao: 'Decisão',
  tarefa: 'Tarefa'
}

describe('router table', () => {
  it.each(APP_PATHS)('resolves %s to the %s route', (path, name) => {
    expect(router.resolve(path).name).toBe(name)
  })

  it('names every screen in Portuguese', () => {
    for (const [name, title] of Object.entries(TITLES)) {
      const match = router.getRoutes().find((route) => route.name === name)
      expect(match?.meta.title).toBe(title)
    }
  })

  it('renders material screens without the sidebar', () => {
    expect(router.resolve('/material/post/post-compilation').meta.layout).toBe('bare')
  })

  it('keeps the sidebar on every other screen', () => {
    for (const [path] of APP_PATHS) {
      if (path.startsWith('/material/')) continue
      expect(router.resolve(path).meta.layout ?? 'app').toBe('app')
    }
  })
})

describe('an address no screen claims', () => {
  it('resolves to the not-found view rather than to nothing', () => {
    const match = router.resolve('/nao-existe')

    expect(match.name).toBe('nao-encontrado')
    expect(match.meta.title).toBe('Página não encontrada')
  })

  it('keeps every real address ahead of it', () => {
    for (const [path, name] of APP_PATHS) {
      expect(router.resolve(path).name).toBe(name)
    }
  })
})

describe('the browser tab', () => {
  it('names the screen and then the app', () => {
    expect(shellDocumentTitle('Biblioteca')).toBe('Biblioteca · Norte')
  })

  it('falls back to the app alone when a route carries no title', () => {
    expect(shellDocumentTitle(undefined)).toBe('Norte')
  })

  it('is renamed by each navigation', async () => {
    await router.push('/')
    expect(document.title).toBe('Início · Norte')

    await router.push('/nao-existe')
    expect(document.title).toBe('Página não encontrada · Norte')
  })
})

/** A router whose one screen is a dynamic import that will not resolve. */
function routerWithAFailingChunk(error: Error) {
  const failing = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'start', component: { template: '<div />' }, meta: { title: 'Início' } },
      { path: '/tarde', name: 'tarde', component: () => Promise.reject(error), meta: { title: 'Tarde' } }
    ]
  })
  installShellRouterBehaviour(failing)
  return failing
}

describe('a navigation whose screen never arrives', () => {
  it('records the address so the shell can offer it again', async () => {
    const failing = routerWithAFailingChunk(
      new TypeError('Failed to fetch dynamically imported module: /assets/TardeView-abc123.js')
    )
    await failing.push('/')

    await failing.push('/tarde').catch(() => undefined)

    expect(shellNavigationFailure.path).toBe('/tarde')
    expect(failing.currentRoute.value.path).toBe('/')
  })

  it('stays quiet for a failure a retry would not fix', async () => {
    const failing = routerWithAFailingChunk(new Error('a guard refused the navigation'))
    await failing.push('/')

    await failing.push('/tarde').catch(() => undefined)

    expect(shellNavigationFailure.path).toBeNull()
  })
})
