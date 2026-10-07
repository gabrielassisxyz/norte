import libraryModule from './library'
import notesModule from './notes'
import projectsModule from './projects'
import reviewModule from './review'
import studyModule from './study'
import type { ModuleName, NorteModule } from './types'

/**
 * Every module this frontend knows how to mount, in the order the shell reads
 * them. Importing this pulls in every module's route table, which is why the
 * shell is the only thing that does; anything that needs just the mount state
 * imports `./mounting` instead.
 */
export const norteModules: NorteModule[] = [libraryModule, notesModule, studyModule, reviewModule, projectsModule]

export function norteModule(name: ModuleName): NorteModule {
  const found = norteModules.find((module) => module.manifest.name === name)
  if (!found) throw new Error(`Unknown module "${name}"`)
  return found
}
