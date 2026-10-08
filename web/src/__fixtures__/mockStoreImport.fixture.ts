import { createMockStore } from '@/mock/store'
import { createMockSources } from '@/sources/mock'

/**
 * A planted violation: a screen that reaches past its injected source and reads
 * the invented data itself. See `README.md` in this folder.
 */
export const plantedStore = createMockStore
export const plantedSources = createMockSources
