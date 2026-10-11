import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'projects',
  backing: 'mock',
  routePaths: ['/projects', '/projects/:id', '/areas/:id', '/decisions/:id', '/tasks/:id']
}
