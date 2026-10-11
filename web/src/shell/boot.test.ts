import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { coreClient } from '@/api/client'
import { clockTimeZone } from '@/lib/clock'
import { enabledModuleNames, resetModuleMounting } from '@/modules/mounting'
import { createRouteTable, routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import AppRoot from './AppRoot.vue'
import {
  bootApplication,
  bootState,
  bootUntilConfigured,
  ConfigUnreachableError,
  FAST_RETRY_DELAY_MS,
  resetBootState,
  resolveBootTimeZone,
  retryDelayMs,
  SLOW_RETRY_DELAY_MS
} from './boot'

/**
 * Every root this file mounted, so that none of them outlives its test.
 *
 * `bootState` is one reactive object shared by every mount, so a wrapper left
 * behind still re-renders when a later test changes the phase -- against a tree
 * that is no longer in a document. That showed up as `parentNode of null` in
 * whichever test happened to run next, which is a long way from its cause.
 */
const mountedRoots: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mountedRoots.length > 0) mountedRoots.pop()?.unmount()
  resetBootState()
  resetModuleMounting()
  vi.restoreAllMocks()
})

function mountRoot() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  const wrapper = mount(AppRoot, { global: { plugins: [router, sourcesPlugin(createMockSources())] } })
  mountedRoots.push(wrapper)
  return wrapper
}

describe('reading the configuration before the app opens', () => {
  it('keeps asking while the server is not answering, and mounts when it starts to', async () => {
    const delays: number[] = []
    let attempt = 0

    const config = await bootUntilConfigured({
      fetchConfig: async () => {
        attempt += 1
        if (attempt < 3) throw new ConfigUnreachableError('connection refused')
        return { modules: ['library', 'notes'], timezone: 'America/Sao_Paulo' }
      },
      wait: async (milliseconds) => {
        delays.push(milliseconds)
      }
    })

    expect(attempt).toBe(3)
    expect(delays).toEqual([FAST_RETRY_DELAY_MS, FAST_RETRY_DELAY_MS])
    expect(config.modules).toEqual(['library', 'notes'])
    expect(enabledModuleNames()).toEqual(['library', 'notes'])
    expect(bootState.phase).toBe('ready')
    expect(clockTimeZone()).toBe('America/Sao_Paulo')
  })

  it('reports the server as unavailable while it is failing', async () => {
    let answer = false
    const boot = bootUntilConfigured({
      fetchConfig: async () => {
        if (!answer) throw new ConfigUnreachableError('connection refused')
        return { modules: [], timezone: 'UTC' }
      },
      wait: async () => {
        expect(bootState.phase).toBe('unavailable')
        answer = true
      }
    })

    await boot
    expect(bootState.attempts).toBe(1)
    expect(bootState.phase).toBe('ready')
  })

  it('slows the retry down once the server has missed three answers', () => {
    expect(retryDelayMs(1)).toBe(FAST_RETRY_DELAY_MS)
    expect(retryDelayMs(2)).toBe(FAST_RETRY_DELAY_MS)
    expect(retryDelayMs(3)).toBe(SLOW_RETRY_DELAY_MS)
    expect(retryDelayMs(40)).toBe(SLOW_RETRY_DELAY_MS)
  })
})

describe('what is on screen while the configuration is unknown', () => {
  it('shows nothing of the app before the first answer', () => {
    const wrapper = mountRoot()

    expect(wrapper.find('.app-shell').exists()).toBe(false)
    expect(wrapper.find('.server-unavailable').exists()).toBe(false)
  })

  it('shows the unavailable screen with the attempt count once a call has failed', async () => {
    const wrapper = mountRoot()
    bootState.phase = 'unavailable'
    bootState.attempts = 4
    await wrapper.vm.$nextTick()

    const screen = wrapper.get('.server-unavailable')
    expect(screen.get('h1').text()).toBe('Servidor indisponível')
    expect(screen.attributes('role')).toBe('alert')
    expect(screen.text()).toContain('tentada de novo sozinha')
    expect(screen.text()).toContain('4 tentativas')
    expect(wrapper.find('.app-shell').exists()).toBe(false)
  })

  it('replaces it with the app once the server answers', async () => {
    const wrapper = mountRoot()
    bootState.phase = 'ready'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.server-unavailable').exists()).toBe(false)
    expect(wrapper.find('.app-shell').exists()).toBe(true)
  })
})

describe('a configuration the client cannot use', () => {
  it('boots on the browser zone and warns once when the server names a zone it does not know', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const browserZone = new Intl.DateTimeFormat().resolvedOptions().timeZone

    await bootUntilConfigured({
      fetchConfig: async () => ({ modules: ['library'], timezone: 'Mars/Olympus' }),
      wait: async () => {
        throw new Error('a retry means the invalid zone was taken for an unreachable server')
      }
    })

    expect(bootState.phase).toBe('ready')
    expect(bootState.attempts).toBe(0)
    expect(clockTimeZone()).toBe(browserZone)
    // Filtered rather than counted outright: Vue's own warnings share this
    // channel, and the claim is about this one warning, not about the channel.
    const aboutTheZone = warn.mock.calls.filter((call) => String(call[0]).includes('Mars/Olympus'))
    expect(aboutTheZone).toHaveLength(1)
  })

  it('keeps a zone the browser does know, and warns about nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveBootTimeZone('America/Sao_Paulo')).toBe('America/Sao_Paulo')
    expect(warn).not.toHaveBeenCalled()
  })

  it('shows a boot error carrying the message when something other than the fetch fails', async () => {
    await expect(
      bootUntilConfigured({
        fetchConfig: async () => ({ modules: ['library'], timezone: 'America/Sao_Paulo' }),
        mount: () => {
          throw new TypeError('installSources is not a function')
        },
        // A retry would mean this was taken for an unreachable server, and
        // since the mount throws every time it would also never end: the throw
        // is what turns that into a failure instead of a hang.
        wait: async () => {
          throw new Error('the boot retried a failure that retrying cannot fix')
        }
      })
    ).rejects.toThrow('installSources is not a function')

    expect(bootState.phase).toBe('error')
    expect(bootState.message).toBe('installSources is not a function')
    expect(bootState.attempts).toBe(0)
  })

  it('shows that message on screen instead of the unavailable page', async () => {
    const wrapper = mountRoot()
    bootState.phase = 'error'
    bootState.message = 'Intl.DateTimeFormat: invalid time zone'
    await wrapper.vm.$nextTick()

    const screen = wrapper.get('.boot-failed')
    expect(screen.attributes('role')).toBe('alert')
    expect(screen.text()).toContain('Intl.DateTimeFormat: invalid time zone')
    expect(wrapper.find('.server-unavailable').exists()).toBe(false)
    expect(wrapper.find('.app-shell').exists()).toBe(false)
  })
})

/**
 * A source that answers nothing and remembers it was asked.
 *
 * The question below is whether a switched-off module's screen was mounted at
 * all, and a screen that is mounted reads: the record of a single call is the
 * evidence, and a promise that never settles keeps the screen in its loading
 * state rather than sending it down a path this test is not about.
 */
function recordingNotesSource(calls: string[]): AppSources['notes'] {
  return new Proxy(
    {},
    {
      get(_target, property) {
        return (...parameters: unknown[]) => {
          void parameters
          calls.push(String(property))
          return new Promise(() => {})
        }
      }
    }
  ) as unknown as AppSources['notes']
}

describe('deep-linking into a module the server is not serving', () => {
  it('re-resolves the address before the app renders, so that module never mounts', async () => {
    const notesCalls: string[] = []
    const router = createRouter({ history: createMemoryHistory(), routes })
    // The deep link resolves against the unpruned table first, exactly as the
    // browser's initial navigation does: /notas is still the notes module's own
    // screen at this point, and nothing has asked the server anything yet.
    await router.replace('/notas')
    expect(router.currentRoute.value.name).toBe('notas')
    const wrapper = mount(AppRoot, {
      global: {
        plugins: [router, sourcesPlugin(appSourcesWithLibrary({ notes: recordingNotesSource(notesCalls) }))]
      }
    })
    mountedRoots.push(wrapper)
    vi.spyOn(coreClient, 'GET').mockResolvedValue({
      data: { modules: ['library'], timezone: 'America/Sao_Paulo', llm: false, telegram: false, version: 'test' },
      error: undefined,
      response: new Response()
    } as never)

    await bootApplication(router)
    await flushReads()

    expect(bootState.phase).toBe('ready')
    expect(router.currentRoute.value.name).toBe('module-off-notes-0')
    expect(notesCalls).toEqual([])
    expect(wrapper.text()).toContain('Módulo desligado')
  })
})
