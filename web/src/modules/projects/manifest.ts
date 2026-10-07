import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'projects',
  backing: 'mock',
  routePaths: ['/projetos', '/projetos/:id', '/areas/:id', '/decisoes/:id', '/tarefas/:id']
}
