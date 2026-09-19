// Playwright runs the instant-navigation specs in e2e/ against a PRODUCTION
// build: Next only prefetches in production, so `next dev` can't show what a
// link has ready before the click. See instant-nav.rig.md for the full loop.
const { defineConfig, devices } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  // One signed-in session and one server; parallel workers would only contend for it
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3233',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
