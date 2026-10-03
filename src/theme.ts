export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'norte-theme'

export function getTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage may be unavailable (private mode, blocked cookies); the theme
    // attribute below still applies for this session.
  }
  document.documentElement.dataset.theme = theme
}

export function applyStoredTheme(): void {
  setTheme(getTheme())
}
