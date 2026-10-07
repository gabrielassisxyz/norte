// Sets <html data-theme> before the first paint, so a dark-theme user never
// sees a flash of the light theme while the bundle loads.
//
// This lives here, as a served file rather than an inline <script>, because the
// server's content security policy allows no script-src exception. It is loaded
// as a classic script (not type="module"): a module would be deferred past
// first paint, which is exactly the flash this file exists to prevent. Being a
// classic script also means it cannot import the storage key from src/theme.ts,
// so the key is repeated below and theme.test.ts asserts the two agree.
;(function () {
  try {
    document.documentElement.dataset.theme =
      window.localStorage.getItem('norte-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    document.documentElement.dataset.theme = 'light'
  }
})()
