import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// https://vitest.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    // The browser suites live under e2e/ and are Playwright's. Vitest's default
    // include would pick their *.spec.ts up and run them in jsdom, where there
    // is no browser to drive and no server to drive it against.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**']
  }
})
