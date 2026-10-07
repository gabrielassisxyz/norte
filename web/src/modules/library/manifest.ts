import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'library',
  backing: 'mock',
  routePaths: ['/biblioteca', '/material/:kind/:id']
}
