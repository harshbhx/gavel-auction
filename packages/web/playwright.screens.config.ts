import { defineConfig } from '@playwright/test';

/**
 * Screen tour: opens every screen of the web app in every state it can reach and saves one PNG
 * per state and project (see test/screens/README.md). It is separate from playwright.config.ts,
 * so the visual regression and accessibility specs are unaffected. Run it with
 * `npm run test:screens -w @gavel/web`; browsers are installed in CI only.
 */
const PORT = 4174;
const BAD_CONFIG_PORT = 4175;

/**
 * Views captured by the narrow, tablet and phone-dark/projector projects (metadata.views): the
 * routes a person actually uses on those devices. It keeps the artifact and the run time near flat.
 */
const KEY_VIEWS = [
  'landing',
  'home',
  'join',
  'register',
  'bid',
  'receipt',
  'console',
  'hub',
  'screen',
];
/** Phone routes for the short and the 360 px projects: the main bidder, console and audit states. */
const PHONE_VIEWS = ['join', 'bid', 'console', 'receipt', 'audit', 'try', 'home'];
const PHONE = { deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;

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
      name: 'fhd-light',
      metadata: { theme: 'light' },
      use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 } },
    },
    {
      name: 'hd-light',
      metadata: { theme: 'light' },
      use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } },
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
    {
      // Narrowest supported phone, and the reflow width of 400% zoom on a desktop.
      name: 'phone-small',
      metadata: { theme: 'light', views: KEY_VIEWS },
      use: { browserName: 'chromium', viewport: { width: 320, height: 640 }, ...PHONE },
    },
    {
      // The most common Android width; the layouts were only checked at 320 and 390.
      name: 'phone-360',
      metadata: { theme: 'light', views: PHONE_VIEWS },
      use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, ...PHONE },
    },
    {
      // A phone turned sideways (iPhone 844x390): wide enough for the desktop breakpoints, very short.
      name: 'phone-landscape',
      metadata: { theme: 'light', views: PHONE_VIEWS },
      use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, ...PHONE },
    },
    {
      // Between the 720 and 900 px breakpoints.
      name: 'tablet',
      metadata: { theme: 'light', views: KEY_VIEWS },
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
    {
      name: 'phone-dark',
      metadata: { theme: 'dark', views: KEY_VIEWS },
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, ...PHONE },
    },
    {
      name: 'phone-projector',
      metadata: { theme: 'projector', views: KEY_VIEWS },
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, ...PHONE },
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
