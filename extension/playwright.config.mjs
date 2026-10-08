import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.mjs', workers: 1, fullyParallel: false,
  timeout: 45000, expect: { timeout: 15000 }, reporter: 'list',
});
