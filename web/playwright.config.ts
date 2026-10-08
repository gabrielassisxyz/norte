import { defineConfig, devices } from '@playwright/test'

/**
 * The two browser suites: the content security policy, and the phone walk.
 *
 * They run one at a time against a `norte serve` each suite starts for itself,
 * on a port and a temporary data directory of its own, so neither can see the
 * other's library. Parallel workers would mean several servers and several
 * Chromiums at once on a machine that is also building, which buys nothing for
 * two suites.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  // Starting a server and extracting an article is the slow part, not the steps.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    // The content-security-policy suite serves its external image from a local
    // TLS listener with a certificate nothing has signed, which is what lets the
    // policy's `https:` allowance be exercised without the network.
    ignoreHTTPSErrors: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
