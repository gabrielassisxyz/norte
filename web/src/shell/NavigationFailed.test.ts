import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NavigationFailed from './NavigationFailed.vue'
import { clearShellNavigationFailure, isShellChunkLoadFailure, reportShellNavigationFailure, shellNavigationFailure } from './navigationFailure'

afterEach(() => {
  clearShellNavigationFailure()
  vi.restoreAllMocks()
})

describe('the message a failed navigation leaves on screen', () => {
  it('says what happened and offers the address again', async () => {
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
    reportShellNavigationFailure('/notas')

    const wrapper = mount(NavigationFailed, { props: { path: '/notas' } })

    expect(wrapper.get('.navigation-failed').attributes('role')).toBe('alert')
    expect(wrapper.text()).toContain('Não foi possível abrir esta tela')

    const retry = wrapper.findAll('button').find((button) => button.text() === 'Tentar de novo')
    expect(retry).toBeDefined()
    await retry?.trigger('click')

    expect(assign).toHaveBeenCalledWith('/notas')
    expect(shellNavigationFailure.path).toBeNull()
  })

  it('can be dismissed without leaving the screen that is showing', async () => {
    reportShellNavigationFailure('/notas')
    const wrapper = mount(NavigationFailed, { props: { path: '/notas' } })

    const close = wrapper.findAll('button').find((button) => button.text() === 'Fechar')
    await close?.trigger('click')

    expect(shellNavigationFailure.path).toBeNull()
  })
})

describe('which navigation errors are worth a retry', () => {
  it('recognises the three ways a browser says a chunk would not load', () => {
    expect(isShellChunkLoadFailure(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'))).toBe(true)
    expect(isShellChunkLoadFailure(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isShellChunkLoadFailure(new Error('Importing a module script failed.'))).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isShellChunkLoadFailure(new Error('a guard refused the navigation'))).toBe(false)
    expect(isShellChunkLoadFailure(null)).toBe(false)
    expect(isShellChunkLoadFailure('Failed to fetch dynamically imported module')).toBe(false)
  })
})
