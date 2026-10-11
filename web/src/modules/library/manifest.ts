import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'library',
  backing: 'api',
  routePaths: ['/library', '/library/:id', '/material/:kind/:id']
}
