import { reactive } from 'vue'
import type { Router } from 'vue-router'

import { coreClient } from '@/api/client'
import { setClockTimeZone } from '@/lib/clock'
import { setEnabledModules } from '@/modules/mounting'
import { applyMountedModules } from '@/router'

/**
 * What the shell renders: nothing yet, the unavailable screen, the boot's own
 * failure, or the app.
 *
 * `unavailable` and `error` are different answers to different questions. The
 * first says the server did not answer and the app is waiting for it; the second
 * says the server answered and the client could not get past it, which no amount
 * of waiting fixes and which only the message explains.
 */
export type BootPhase = 'loading' | 'unavailable' | 'error' | 'ready'

export const bootState = reactive<{ phase: BootPhase; attempts: number; message: string }>({
  phase: 'loading',
  attempts: 0,
  message: ''
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
  /** The IANA zone every date in the UI is rendered in. */
  timezone: string
}

/**
 * `GET /api/config` did not come back, so there is nothing to boot against yet.
 *
 * Retrying forever is only the right answer to this one failure, which is why it
 * carries a type instead of being told apart by its message: anything else
 * thrown during boot is a defect in the client or in what the server said, and a
 * retry loop would hide it behind a page blaming the network.
 */
export class ConfigUnreachableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigUnreachableError'
  }
}

async function readConfig(): Promise<ConfigReport> {
  let answer
  try {
    answer = await coreClient.GET('/api/config')
  } catch (cause) {
    throw new ConfigUnreachableError('GET /api/config could not be reached', { cause })
  }
  const { data, error } = answer
  if (error || !data) throw new ConfigUnreachableError('GET /api/config did not answer')
  return { modules: data.modules, timezone: data.timezone }
}

/**
 * The zone the UI will actually render in, given what the config reported.
 *
 * An unknown zone is not a reason to refuse to start: `Intl.DateTimeFormat`
 * throws a `RangeError` for it, and that throw used to surface as "server
 * unavailable" for a server that was answering fine. The browser's own zone is
 * wrong in the way a clock in the wrong city is wrong, which is visible and
 * recoverable, so it is the better of the two failures — and the warning names
 * the value so whoever set it can see what the server is serving.
 */
export function resolveBootTimeZone(timezone: string): string {
  const fallback = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  if (!timezone) return fallback
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return timezone
  } catch {
    console.warn(
      `norte: the server reported the time zone ${JSON.stringify(timezone)}, which this browser does not know; using ${fallback} instead`
    )
    return fallback
  }
}

export interface BootDependencies {
  fetchConfig?: () => Promise<ConfigReport>
  mount?: (config: ConfigReport) => void | Promise<void>
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
 *
 * `mount` is awaited, and the phase only becomes `ready` after it has returned.
 * Everything that has to be true before the app's own screens render belongs
 * inside it, because `ready` is the moment they do.
 */
export async function bootUntilConfigured(dependencies: BootDependencies = {}): Promise<ConfigReport> {
  const fetchConfig = dependencies.fetchConfig ?? readConfig
  const wait = dependencies.wait ?? sleep

  for (;;) {
    try {
      const config = await fetchConfig()
      setEnabledModules(config.modules)
      // The calendar comes from the server, so a browser in another zone still
      // renders the day the server is on.
      setClockTimeZone(resolveBootTimeZone(config.timezone))
      await dependencies.mount?.(config)
      bootState.phase = 'ready'
      return config
    } catch (cause) {
      if (!(cause instanceof ConfigUnreachableError)) {
        bootState.message = cause instanceof Error ? cause.message : String(cause)
        bootState.phase = 'error'
        throw cause
      }
      bootState.attempts += 1
      bootState.phase = 'unavailable'
      await wait(retryDelayMs(bootState.attempts))
    }
  }
}

/**
 * Boot the real application: read the config, then prune the live route table.
 *
 * `onConfigured` runs while the phase is still `loading`, which is what lets the
 * entry point install the data sources against a calendar the config has
 * already set — the app's own screens do not exist yet at that point.
 */
export async function bootApplication(router: Router, onConfigured?: (config: ConfigReport) => void): Promise<void> {
  try {
    await bootUntilConfigured({
      mount: async (config) => {
        onConfigured?.(config)
        applyMountedModules(router)
        // The first navigation resolved against the unpruned table, so
        // re-resolve it now that a switched-off module's address answers with
        // its own page. This happens before the phase becomes `ready`, because
        // `ready` is what renders the resolved component: re-resolving after it
        // mounted the real screen of a module the server is not serving, which
        // fired that module's requests -- and, in the reader, a write -- against
        // endpoints answering 404, and logged a vue-router error, all before
        // "Módulo desligado" replaced it.
        //
        // Waiting for `isReady` first is what makes a deep link work. The
        // route's component is a dynamic import, so the initial navigation is
        // still fetching its chunk while /api/config -- one request to the same
        // host -- has already answered; the current route is then still the
        // start location, whose path is "/", and replacing that threw the
        // address away. Opening a link to an article landed on the home screen.
        await router.isReady()
        await router.replace(router.currentRoute.value.fullPath)
      }
    })
  } catch {
    // `bootUntilConfigured` has already put the message on screen; rethrowing
    // from the entry point would only add an unhandled rejection to it.
  }
}

export function resetBootState(): void {
  bootState.phase = 'loading'
  bootState.attempts = 0
  bootState.message = ''
}
