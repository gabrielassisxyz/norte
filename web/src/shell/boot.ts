import { reactive } from 'vue'
import type { Router } from 'vue-router'

import { coreClient } from '@/api/client'
import { setEnabledModules } from '@/modules/mounting'
import { applyMountedModules } from '@/router'

/** What the shell renders: nothing yet, the unavailable screen, or the app. */
export type BootPhase = 'loading' | 'unavailable' | 'ready'

export const bootState = reactive<{ phase: BootPhase; attempts: number }>({
  phase: 'loading',
  attempts: 0
})

/**
 * The first few retries are quick because a server that is still starting up
 * answers within seconds; after that the wait stretches out, because a server
 * that has not answered three times is down rather than slow and polling it
 * every two seconds only burns battery.
 */
export const FAST_RETRY_DELAY_MS = 2000
export const SLOW_RETRY_DELAY_MS = 10_000
export const FAST_RETRY_COUNT = 3

export function retryDelayMs(attempts: number): number {
  return attempts < FAST_RETRY_COUNT ? FAST_RETRY_DELAY_MS : SLOW_RETRY_DELAY_MS
}

export interface ConfigReport {
  modules: string[]
}

async function readConfig(): Promise<ConfigReport> {
  const { data, error } = await coreClient.GET('/api/config')
  if (error || !data) throw new Error('GET /api/config did not answer')
  return { modules: data.modules }
}

export interface BootDependencies {
  fetchConfig?: () => Promise<ConfigReport>
  mount?: (config: ConfigReport) => void
  wait?: (milliseconds: number) => Promise<void>
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Ask the server which modules are on, and keep asking until it answers.
 *
 * There is nothing to show before the answer arrives — the sidebar, the home
 * screen and the route table are all built from it — so the only two states
 * before `ready` are "asking" and "the server is not there".
 */
export async function bootUntilConfigured(dependencies: BootDependencies = {}): Promise<ConfigReport> {
  const fetchConfig = dependencies.fetchConfig ?? readConfig
  const wait = dependencies.wait ?? sleep

  for (;;) {
    try {
      const config = await fetchConfig()
      setEnabledModules(config.modules)
      dependencies.mount?.(config)
      bootState.phase = 'ready'
      return config
    } catch {
      bootState.attempts += 1
      bootState.phase = 'unavailable'
      await wait(retryDelayMs(bootState.attempts))
    }
  }
}

/** Boot the real application: read the config, then prune the live route table. */
export async function bootApplication(router: Router): Promise<void> {
  await bootUntilConfigured({
    mount: () => {
      applyMountedModules(router)
    }
  })
  // The first navigation resolved against the unpruned table, so re-resolve it
  // now that a switched-off module's address answers with its own page.
  await router.replace(router.currentRoute.value.fullPath)
}

export function resetBootState(): void {
  bootState.phase = 'loading'
  bootState.attempts = 0
}
