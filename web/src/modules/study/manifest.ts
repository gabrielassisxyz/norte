import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'study',
  backing: 'mock',
  routePaths: ['/study', '/curricula/:slug']
}
