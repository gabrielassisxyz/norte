import type { ModuleManifest } from '../types'

export const manifest: ModuleManifest = {
  name: 'notes',
  backing: 'api',
  routePaths: ['/notes', '/notes/sets', '/notes/sets/:id']
}
