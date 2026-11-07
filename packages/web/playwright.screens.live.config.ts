import { defineConfig } from '@playwright/test';

/**
 * Screen tour against a deployed site (see test/screens-live/README.md). Unlike
 * playwright.screens.config.ts it starts no dev server and mocks nothing: the pages are the
 * hosted web app and the API behind it. The web origin comes from GAVEL_LIVE_WEB.
 *
 * Traces, videos and the HTTP log are off on purpose: a room link carries a token and the admin
 * key travels in a request header, and none of that may land in an uploaded file.
 */
const WEB = (process.env['GAVEL_LIVE_WEB'] ?? '').replace(/\/+$/, '');

export default defineConfig({
  testDir: 'test/screens-live',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 2,
  retries: 1,
  timeout: 90_000,
  reporter: [['list']],
  outputDir: 'test-results/ui-screens-live',
  use: {
    baseURL: WEB === '' ? 'https://web-url-not-set.invalid' : WEB,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
    trace: 'off',
    video: 'off',
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
});
