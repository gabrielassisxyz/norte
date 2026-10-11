import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

/**
 * The navigation drawer, which is the sidebar on a viewport too narrow to hold
 * one beside the content.
 *
 * Whether it is off-canvas is a media query's answer and jsdom computes no
 * layout, so what is asserted here is the state the stylesheet keys off: the
 * `is-open` class, and the button's `aria-expanded`. That the class is what
 * moves the panel is the Playwright walk's job, at a real 390x844.
 */
afterEach(() => {
  resetModuleMounting()
})

async function mountAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  setEnabledModules(['library', 'notes'])
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary())] } })
  await flushReads()
  return { wrapper, router }
}

const MENU = 'button[aria-label="Abrir navegação"]'

describe('the navigation drawer', () => {
  it('starts closed and opens from the menu button', async () => {
    const { wrapper } = await mountAt('/')

    expect(wrapper.find('.app-drawer').classes()).not.toContain('is-open')
    expect(wrapper.find(MENU).attributes('aria-expanded')).toBe('false')

    await wrapper.find(MENU).trigger('click')

    expect(wrapper.find('.app-drawer').classes()).toContain('is-open')
    expect(wrapper.find(MENU).attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.app-drawer nav[aria-label="Principal"]').exists()).toBe(true)
  })

  it('closes on a tap outside it', async () => {
    const { wrapper } = await mountAt('/')
    await wrapper.find(MENU).trigger('click')

    const scrim = wrapper.find('button.app-scrim')
    expect(scrim.exists()).toBe(true)
    await scrim.trigger('click')

    expect(wrapper.find('.app-drawer').classes()).not.toContain('is-open')
    expect(wrapper.find('button.app-scrim').exists()).toBe(false)
  })

  it('closes on Escape', async () => {
    const { wrapper } = await mountAt('/')
    await wrapper.find(MENU).trigger('click')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.app-drawer').classes()).not.toContain('is-open')
  })

  it('closes on arriving somewhere, which is what it was opened for', async () => {
    const { wrapper, router } = await mountAt('/')
    await wrapper.find(MENU).trigger('click')
    expect(wrapper.find('.app-drawer').classes()).toContain('is-open')

    await router.push('/library?v=all')
    await flushReads()

    expect(wrapper.find('.app-drawer').classes()).not.toContain('is-open')
    expect(wrapper.find('.app-content h1').text()).toBe('Biblioteca')
  })

  it('closes when an overlay it opened takes the screen', async () => {
    const { wrapper } = await mountAt('/')
    await wrapper.find(MENU).trigger('click')
    expect(wrapper.find('.app-drawer').classes()).toContain('is-open')

    // The palette is opened from inside the drawer, and the drawer is over the
    // content: left standing it would answer the taps meant for the results.
    await wrapper.get('.app-drawer button.app-button:not([disabled])').trigger('click')

    expect(wrapper.find('.shell-palette-input').exists()).toBe(true)
    expect(wrapper.find('.app-drawer').classes()).not.toContain('is-open')
    expect(wrapper.find('button.app-scrim').exists()).toBe(false)
  })

  it('closes when the preferences it opened take the screen', async () => {
    const { wrapper } = await mountAt('/')
    await wrapper.find(MENU).trigger('click')

    const buttons = wrapper.findAll('.app-drawer .app-foot button')
    expect(buttons.map((button) => button.text())).toEqual(['Buscar⌘K', 'Preferências'])
    await buttons[1].trigger('click')

    expect(wrapper.find('.shell-preferences').exists()).toBe(true)
    expect(wrapper.find('.app-drawer').classes()).not.toContain('is-open')
  })

  it('offers no menu button and no drawer on a bare route', async () => {
    const { wrapper } = await mountAt('/library/lib-post')

    expect(wrapper.find(MENU).exists()).toBe(false)
    expect(wrapper.find('.app-drawer').exists()).toBe(false)
  })
})
