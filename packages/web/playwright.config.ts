import { defineConfig } from '@playwright/test';

/**
 * Browser specs for the web app (R-WEB-124, T-WEB-056, T-WEB-058). They live in test/visual as
 * *.spec.ts, so the default unit run (vitest, *.test.ts) never picks them up. Run them with
 * `npm run test:visual -w @gavel/web`; browsers are installed in CI only.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'test/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
    // axe-core is injected as an inline script, which the page CSP refuses.
    bypassCSP: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // The axe and keyboard specs also run in WebKit, the engine of Safari (issue 2195). Other specs
    // compare screenshots against Chromium baselines, so they stay out of this project. This is
    // an engine check, not VoiceOver: no screen reader runs.
    {
      name: 'webkit',
      testMatch: ['**/a11y.spec.ts', '**/keyboard.spec.ts'],
      use: { browserName: 'webkit' },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_API_BASE: 'http://localhost:8787',
      VITE_WS_BASE: 'ws://localhost:8787',
      VITE_PAYPAL_CLIENT_ID: 'sandbox-client',
      VITE_SANDBOX: 'true',
      VITE_PAYMENTS: 'fake',
    },
  },
});
