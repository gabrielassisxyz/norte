import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import type { ModuleName } from '@/modules/types'
import { createRouteTable } from '@/router'

import AppSidebar from './AppSidebar.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

/** Switch the named modules to `api` and tell the app the server lists none of them. */
function switchOff(...names: ModuleName[]): void {
  for (const name of names) overrideModuleBacking(name, 'api')
  setEnabledModules([])
}

async function mountSidebar() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(AppSidebar, { global: { plugins: [router] } })
  mounted.push(wrapper)
  return wrapper
}

function topLevelLabels(wrapper: { findAll: (selector: string) => Array<{ text: () => string }> }): string[] {
  return wrapper.findAll('nav[aria-label="Principal"] > .app-line > .app-line-link').map((link) => link.text().replace(/\d+$/, '').trim())
}

async function expand(wrapper: Awaited<ReturnType<typeof mountSidebar>>, label: string) {
  await wrapper.get(`button[aria-label="Expandir ${label}"]`).trigger('click')
}

describe('Revisão in the sidebar', () => {
  it('nests under Estudo when both are mounted', async () => {
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).not.toContain('Revisão')
    await expand(wrapper, 'Estudo')
    const nested = wrapper.findAll('nav[aria-label="Principal"] .app-children .app-sub').map((row) => row.text().replace(/\d+$/, '').trim())
    expect(nested).toContain('Revisão')
  })

  it('stands on its own when Revisão is mounted without Estudo', async () => {
    switchOff('study')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Revisão')
    expect(topLevelLabels(wrapper)).not.toContain('Estudo')
    // Nothing to expand: it has no rows of its own.
    expect(wrapper.find('button[aria-label="Expandir Revisão"]').exists()).toBe(false)
  })

  it('leaves Estudo without a Revisão row when only Estudo is mounted', async () => {
    switchOff('review')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Estudo')
    expect(topLevelLabels(wrapper)).not.toContain('Revisão')
    await expand(wrapper, 'Estudo')
    const nested = wrapper.findAll('nav[aria-label="Principal"] .app-children .app-sub').map((row) => row.text().replace(/\d+$/, '').trim())
    expect(nested).toContain('Currículos')
    expect(nested).not.toContain('Revisão')
  })

  it('mentions neither when neither is mounted', async () => {
    switchOff('study', 'review')
    const wrapper = await mountSidebar()
    const labels = topLevelLabels(wrapper)

    expect(labels).not.toContain('Estudo')
    expect(labels).not.toContain('Revisão')
    // The sidebar is still a sidebar: the other products are untouched.
    expect(labels).toContain('Biblioteca')
    expect(labels).toContain('Projetos')
    expect(labels).toContain('Notas')
    // And the Estudo shortcut group goes with its module.
    expect(wrapper.get('nav[aria-label="Atalhos"]').text()).not.toContain('Currículos')
  })
})
