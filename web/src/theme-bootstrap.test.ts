import { describe, expect, it } from 'vitest'

// Imported as raw text rather than read from the filesystem, so the test needs
// no Node types and no assumption about the working directory.
import bootstrap from '../public/theme-bootstrap.js?raw'
import indexHtml from '../index.html?raw'

import { THEME_STORAGE_KEY } from './theme'

// The theme bootstrap has to run before the first paint, and the server's
// content security policy allows no inline script, so it is a served file
// referenced from index.html. Both halves of that arrangement are easy to undo
// by accident, and the symptom — a flash of the light theme, or a script the
// browser refuses to run — only shows up in a browser.
describe('the theme bootstrap', () => {
  it('is not inline in index.html, which the content security policy would block', () => {
    const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i
    expect(indexHtml).not.toMatch(inlineScript)
  })

  it('is loaded from index.html as a classic script, so it is not deferred past first paint', () => {
    expect(indexHtml).toContain('<script src="/theme-bootstrap.js"></script>')
    expect(indexHtml).not.toMatch(/<script[^>]*theme-bootstrap\.js[^>]*type="module"/i)
  })

  it('reads the same storage key as the theme module', () => {
    expect(bootstrap).toContain(`'${THEME_STORAGE_KEY}'`)
  })
})
