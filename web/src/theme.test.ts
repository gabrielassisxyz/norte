import { beforeEach, describe, expect, it } from 'vitest'

import { applyStoredTheme, getTheme, setTheme, THEME_STORAGE_KEY } from './theme'

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('theme', () => {
  it('defaults to light with empty storage', () => {
    expect(getTheme()).toBe('light')
  })

  it('round-trips the light theme through localStorage and the dataset attribute', () => {
    setTheme('light')

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(getTheme()).toBe('light')
  })

  it('round-trips the dark theme through localStorage and the dataset attribute', () => {
    setTheme('dark')

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(getTheme()).toBe('dark')
  })

  it('applies the stored theme at boot and defaults to light', () => {
    applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe('light')

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
