import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { clockTimeZone } from '@/lib/clock'
import { enabledModuleNames, resetModuleMounting } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { createMockSources } from '@/sources/mock'
import { sourcesPlugin } from '@/sources/testing'

import AppRoot from './AppRoot.vue'
import { bootState, bootUntilConfigured, FAST_RETRY_DELAY_MS, resetBootState, retryDelayMs, SLOW_RETRY_DELAY_MS } from './boot'

afterEach(() => {
  resetBootState()
  resetModuleMounting()
})

function mountRoot() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  return mount(AppRoot, { global: { plugins: [router, sourcesPlugin(createMockSources())] } })
}

describe('reading the configuration before the app opens', () => {
  it('keeps asking while the server is not answering, and mounts when it starts to', async () => {
    const delays: number[] = []
    let attempt = 0

    const config = await bootUntilConfigured({
      fetchConfig: async () => {
        attempt += 1
        if (attempt < 3) throw new Error('connection refused')
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
        if (!answer) throw new Error('connection refused')
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
