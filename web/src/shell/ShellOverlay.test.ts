import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import ShellOverlay from '@/shell/ShellOverlay.vue'
import { routes } from '@/router'
import { setTheme } from '@/theme'

async function mountOverlay(open: 'busca' | 'prefs') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ShellOverlay, { props: { open }, global: { plugins: [router] } })
  return { wrapper, router }
}

describe('shell overlay', () => {
  it('renders the search dialog and its primary regions', async () => {
    const { wrapper } = await mountOverlay('busca')

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Buscar')
    expect(wrapper.get('input[aria-label="Buscar"]').attributes('placeholder')).toBe('Buscar telas, artigos, projetos, tarefas…')
    expect(wrapper.text()).toContain('Ir para')
    expect(wrapper.text()).toContain('Ações')
  })

  it('filters, moves the highlight, and opens the selected route', async () => {
    const { wrapper, router } = await mountOverlay('busca')
    const search = wrapper.get('input[aria-label="Buscar"]')

    await search.setValue('Mapas')
    expect(wrapper.findAll('.shell-palette-row')).toHaveLength(1)
    await search.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.get('.shell-palette-row').classes()).toContain('is-highlighted')
    // Module routes are lazy, so the push also waits on a dynamic import. The
    // router reports its own arrival, which is a fact rather than a deadline:
    // polling for a fixed number of milliseconds fails on a busy machine for
    // reasons that have nothing to do with the screen under test.
    const navigated = new Promise<void>((resolve) => {
      const stop = router.afterEach((to) => {
        if (to.name !== 'material') return
        stop()
        resolve()
      })
    })
    await search.trigger('keydown', { key: 'Enter' })
    await navigated
    // The overlay closes itself once its own push resolves, one turn later.
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('material')
    expect(router.currentRoute.value.params).toMatchObject({ kind: 'post', id: 'post-compilation' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on Escape', async () => {
    const { wrapper } = await mountOverlay('busca')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('switches the theme from the action and opens preferences from the other action', async () => {
    setTheme('light')
    const { wrapper } = await mountOverlay('busca')
    const buttons = wrapper.findAll('.shell-palette-row')
    const toggle = buttons.find((button) => button.text().includes('Alternar tema'))
    const preferences = buttons.find((button) => button.text().includes('Preferências'))

    await toggle!.trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('norte-theme')).toBe('dark')

    await preferences!.trigger('click')
    expect(wrapper.emitted('open-preferences')).toHaveLength(1)
  })

  it('shows the preference controls and persists the selected theme', async () => {
    setTheme('light')
    const { wrapper } = await mountOverlay('prefs')

    expect(wrapper.get('#shell-preferences-title').text()).toBe('Preferências')
    await wrapper.get('button[role="radio"][aria-checked="false"]').trigger('click')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('norte-theme')).toBe('dark')
    expect(wrapper.text()).toContain('dados')
    expect(wrapper.text()).toContain('servidor')
    expect(wrapper.text()).toContain('atalho')
  })
})
