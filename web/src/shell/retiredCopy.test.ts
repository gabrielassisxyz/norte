import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { createRouteTable } from '@/router'

import ShellOverlay from './ShellOverlay.vue'

/**
 * Copy that promised something the app does not do. Norte is a client-server
 * app: it loads nothing without its server and syncs nothing with an account,
 * so a line reporting a sync was describing a feature that never existed —
 * the kind of claim a screenshot turns into a promise.
 */
const RETIRED_COPY = ['Sincronizado há', 'Sem sincronização configurada', 'sincroniza com a conta', 'Tema, dados e sync']

async function mountShell() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  return mount(App, { global: { plugins: [router] } })
}

async function mountOverlay(open: 'busca' | 'prefs') {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  return mount(ShellOverlay, { props: { open }, global: { plugins: [router] } })
}

describe('the retired sync copy', () => {
  it('appears nowhere in the rendered shell', async () => {
    const wrapper = await mountShell()
    const text = wrapper.text()

    expect(text.length).toBeGreaterThan(0)
    for (const copy of RETIRED_COPY) expect(text).not.toContain(copy)
  })

  it('appears nowhere in the preferences dialog', async () => {
    const wrapper = await mountOverlay('prefs')
    const text = wrapper.text()

    expect(wrapper.get('#shell-preferences-title').text()).toBe('Preferências')
    for (const copy of RETIRED_COPY) expect(text).not.toContain(copy)
  })

  it('appears nowhere in the command palette', async () => {
    const wrapper = await mountOverlay('busca')
    const text = wrapper.text()

    expect(text).toContain('Preferências')
    for (const copy of RETIRED_COPY) expect(text).not.toContain(copy)
  })
})
