import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'notes',
  backing: 'api',
  routePaths: ['/notas', '/notas/conjuntos', '/notas/conjuntos/:id']
}
