import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'library',
  backing: 'api',
  routePaths: ['/biblioteca', '/biblioteca/:id', '/material/:kind/:id']
}
