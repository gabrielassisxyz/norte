import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

/**
 * Every mount is torn down before the mount state is reset: a wrapper left
 * alive would re-render its sidebar from the restored state against a router
 * whose table was built from the old one.
 */
const mounted: Array<{ unmount: () => void }> = []

async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router, sourcesPlugin(createMockSources())] } })
  mounted.push(wrapper)
  // A detail screen titles itself from its own read, so there is no heading to
  // assert on until that read has answered.
  await flushReads()
  return { wrapper, router }
}

/** What the server looks like when it is built without the library module. */
function libraryOff(): void {
  overrideModuleBacking('library', 'api')
  setEnabledModules([])
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

describe('a module the server does not serve', () => {
  it('leaves no library entry in the sidebar', async () => {
    libraryOff()
    const { wrapper } = await mountAt('/')
    const sidebar = wrapper.get('.app-sidebar')

    expect(sidebar.text()).not.toContain('Biblioteca')
    expect(sidebar.find('button[aria-label="Expandir Biblioteca"]').exists()).toBe(false)
    // Estudo and Projetos are mock-backed, so they are still there.
    expect(sidebar.text()).toContain('Estudo')
    expect(sidebar.text()).toContain('Projetos')
  })

  it('leaves no library block on the home screen', async () => {
    libraryOff()
    const { wrapper } = await mountAt('/')

    expect(wrapper.find('#continue-reading').exists()).toBe(false)
    expect(wrapper.find('#recent-saves').exists()).toBe(false)
    // The study block and the review action are mock-backed and stay.
    expect(wrapper.get('#continue-study').text()).toBe('Continuar estudando')
    expect(wrapper.get('.home-review').attributes('href')).toBe('/revisao')
  })

  it('answers its addresses with the switched-off page instead of a blank screen', async () => {
    libraryOff()
    const { wrapper } = await mountAt('/library')

    expect(wrapper.find('.app-content h1').text()).toBe('Módulo desligado')
    expect(wrapper.text()).toContain('um módulo que o servidor não está servindo')
  })

  it('leaves the mock-backed screens rendering', async () => {
    libraryOff()
    for (const [path, title] of [
      ['/revisao', 'Revisão'],
      ['/projetos', 'Projetos'],
      ['/areas/a-casa', 'Casa']
    ] as const) {
      const { wrapper } = await mountAt(path)
      expect(wrapper.find('.app-content h1').text()).toBe(title)
    }

    const { wrapper } = await mountAt('/estudo')
    expect(wrapper.find('.app-content h1').text().length).toBeGreaterThan(0)
    expect(wrapper.find('.app-content h1').text()).not.toBe('Módulo desligado')
  })

  it('drops its screens out of the search index', async () => {
    libraryOff()
    const { wrapper } = await mountAt('/')

    await wrapper.get('.app-foot .app-button').trigger('click')
    const palette = wrapper.get('.shell-palette-results')

    expect(palette.text()).not.toContain('Inbox, depois e arquivo')
    expect(palette.text()).toContain('Currículos e assuntos')
  })
})

describe('an api-backed module the server does serve', () => {
  it('mounts exactly as a mock-backed one does', async () => {
    overrideModuleBacking('library', 'api')
    setEnabledModules(['library'])
    const { wrapper } = await mountAt('/library')

    expect(wrapper.find('.app-content h1').text()).toBe('Library')
    expect(wrapper.get('.app-sidebar').text()).toContain('Library')
  })
})
