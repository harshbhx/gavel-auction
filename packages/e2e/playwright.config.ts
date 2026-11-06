import { defineConfig, devices } from '@playwright/test';

/**
 * Browser specs for the whole stack (R-QA-031, R-QA-033, R-QA-041, T-QA-045).
 *
 * Five browser projects: Chromium, Firefox, WebKit, iPhone 14 and Pixel 7. Payments mode is
 * chosen by GAVEL_MODE: "fake" (default, the fake payments backend) or "sandbox" (PayPal sandbox,
 * CI only). Sharding is the stock flag: `--shard=1/3`. One retry, trace kept on the first retry,
 * screenshots and video kept on failure. The voice path uses a fake media device in each browser
 * that supports one; the microphone permission is granted on the Chromium-based projects only. Browsers are installed in CI only.
 */
const chromiumFakeMedia = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

export default defineConfig({
  testDir: 'specs',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/../__screenshots__/{projectName}/{testFileName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: { args: chromiumFakeMedia },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    {
      name: 'iphone-14',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'pixel-7',
      use: {
        ...devices['Pixel 7'],
        permissions: ['microphone'],
        launchOptions: { args: chromiumFakeMedia },
      },
    },
  ],
});
