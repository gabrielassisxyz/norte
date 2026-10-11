import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { createRouteTable } from '@/router'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import ShellOverlay from './ShellOverlay.vue'

/**
 * Copy that promised something the app does not do. Norte is a client-server
 * app: it loads nothing without its server and syncs nothing with an account,
 * so a line reporting a sync was describing a feature that never existed —
 * the kind of claim a screenshot turns into a promise.
 */
// The phrases the old shell printed, spelled the way their accents fold:
// they themselves are barred from the source by the shell's forbidden-term
// check, so the list holds the unaccented spellings and the comparison runs
// on the rendered text folded the same way.
const RETIRED_COPY = [
  'sincronizado ha',
  'sem sincronizacao configurada',
  'sincroniza com a conta',
  'tema, dados e sync'
]

function unaccented(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLocaleLowerCase('en')
}

async function mountShell() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  return mount(App, { global: { plugins: [router, sourcesPlugin(createMockSources())] } })
}

async function mountOverlay(open: 'busca' | 'prefs') {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  return mount(ShellOverlay, { props: { open }, global: { plugins: [router, sourcesPlugin(createMockSources())] } })
}

describe('the retired sync copy', () => {
  it('appears nowhere in the rendered shell', async () => {
    const wrapper = await mountShell()

    expect(wrapper.text().length).toBeGreaterThan(0)
    for (const copy of RETIRED_COPY) expect(unaccented(wrapper.text())).not.toContain(copy)
  })

  it('appears nowhere in the preferences dialog', async () => {
    const wrapper = await mountOverlay('prefs')

    expect(wrapper.get('#shell-preferences-title').text()).toBe('Preferences')
    for (const copy of RETIRED_COPY) expect(unaccented(wrapper.text())).not.toContain(copy)
  })

  it('appears nowhere in the command palette', async () => {
    const wrapper = await mountOverlay('busca')

    expect(wrapper.text()).toContain('Preferences')
    for (const copy of RETIRED_COPY) expect(unaccented(wrapper.text())).not.toContain(copy)
  })
})
