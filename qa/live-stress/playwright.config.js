// Live stress suite. One worker on purpose: the target is a judge-demo server with five rooms.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const OUT = path.resolve(process.env.OUT || 'stress-out');
const chromiumOf = (name) => {
  const d = { ...devices[name] };
  delete d.defaultBrowserType;
  return d;
};

// layout and a11y run on every viewport; the behaviour specs on a few
const EVERY = /(10-layout|60-a11y)\.spec\.js/;
const BEHAVE = /(20-routes|30-inputs|40-flows|50-network)\.spec\.js/;

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.js$/,
  outputDir: path.join(OUT, 'pw-results'),
  globalSetup: './global-setup.js',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: path.join(OUT, 'results.json') }]],
  use: {
    baseURL: process.env.WEB_URL || 'https://gavel-web.creharsh.workers.dev',
    // traces hold request headers (room bearer tokens), so they are opt-in: TRACE=1
    trace: process.env.TRACE === '1' ? 'retain-on-failure' : 'off',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'd1920', testMatch: EVERY, use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'd1440', testMatch: [EVERY, BEHAVE], use: { viewport: { width: 1440, height: 900 } } },
    { name: 'd1280', testMatch: EVERY, use: { viewport: { width: 1280, height: 720 } } },
    { name: 'tablet', testMatch: [EVERY, /40-flows/], use: chromiumOf('iPad (gen 7)') },
    { name: 'iphone14', testMatch: [EVERY, BEHAVE], use: chromiumOf('iPhone 14') },
    { name: 'pixel7', testMatch: [EVERY, /40-flows/], use: chromiumOf('Pixel 7') },
    {
      name: 'small320',
      testMatch: [EVERY, /(20-routes|30-inputs)/],
      use: {
        ...chromiumOf('iPhone SE'),
        viewport: { width: 320, height: 568 },
        deviceScaleFactor: 2,
      },
    },
    // last: hammers room B, so everything that needs a live console ran before it
    {
      name: 'finale',
      testMatch: /99-finale\.spec\.js/,
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
