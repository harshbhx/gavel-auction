import { defineConfig } from '@playwright/test';

/**
 * Screen tour: opens every screen of the web app in every state it can reach and saves one PNG
 * per state and project (see test/screens/README.md). It is separate from playwright.config.ts,
 * so the visual regression and accessibility specs are unaffected. Run it with
 * `npm run test:screens -w @gavel/web`; browsers are installed in CI only.
 */
const PORT = 4174;
const BAD_CONFIG_PORT = 4175;

export default defineConfig({
  testDir: 'test/screens',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: 'test-results/ui-screens-traces',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
    // axe is not used here, but the page CSP must not block the local network mocks either.
    bypassCSP: true,
  },
  projects: [
    {
      name: 'desktop-light',
      metadata: { theme: 'light' },
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone-light',
      metadata: { theme: 'light' },
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-dark',
      metadata: { theme: 'dark' },
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-projector',
      metadata: { theme: 'projector' },
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
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
    {
      // Same app with VITE_SANDBOX left out: the boot configuration error screen.
      command: `npm run dev -- --host 127.0.0.1 --port ${BAD_CONFIG_PORT} --strictPort`,
      url: `http://127.0.0.1:${BAD_CONFIG_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_API_BASE: 'http://localhost:8787',
        VITE_WS_BASE: 'ws://localhost:8787',
        VITE_PAYPAL_CLIENT_ID: 'sandbox-client',
        VITE_PAYMENTS: 'fake',
      },
    },
  ],
});
