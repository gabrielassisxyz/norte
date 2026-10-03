import { describe, expect, it } from 'vitest'

import router from './index'

const APP_PATHS: Array<[string, string]> = [
  ['/', 'inicio'],
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
