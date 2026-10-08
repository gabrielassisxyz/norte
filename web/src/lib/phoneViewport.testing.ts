import { vi } from 'vitest'

import { PHONE_VIEWPORT_MAX_PX } from './phoneViewport'

/**
 * Make `window.matchMedia` answer as a phone would, for one test.
 *
 * jsdom's own implementation reports every query false and computes no layout,
 * so a component that takes its shape from the viewport is on the wide shape
 * unless a test says otherwise. This is that saying; the returned function puts
 * the real implementation back. Tests name it, nothing in the application does.
 */
export function stubPhoneViewport(phone = true): () => void {
  const original = window.matchMedia
  const query = `(max-width: ${PHONE_VIEWPORT_MAX_PX}px)`
  window.matchMedia = vi.fn().mockImplementation((asked: string) => ({
    matches: asked === query ? phone : false,
    media: asked,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}
