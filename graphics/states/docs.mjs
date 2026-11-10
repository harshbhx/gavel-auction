#!/usr/bin/env node
// Screenshots of the docs site pages (static export served locally) at desktop and phone width.
// Usage: TOOLS_DIR=<dir with playwright> node graphics/states/docs.mjs <base-url> <outDir>
// Writes docs-<page>--desktop-light.png and docs-<page>--phone-light.png. Pages that 404 are skipped.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(`${resolve(process.env.TOOLS_DIR ?? '.')}/`);
const { chromium } = require('playwright');

const base = process.argv[2] ?? 'http://localhost:4173';
const outDir = resolve(process.argv[3] ?? 'docs-out');
mkdirSync(outDir, { recursive: true });

const PAGES = [
  ['home', '/'],
  ['docs-index', '/docs'],
  ['judge-guide', '/docs/judges'],
  ['two-minute-path', '/docs/judges/two-minute-path'],
  ['call-the-api', '/docs/judges/call-the-api'],
  ['api-reference', '/api-reference.html'],
  ['demo', '/docs/start/demo'],
  ['how-it-works', '/docs/how-it-works'],
  ['auction-states', '/docs/how-it-works/auction-states'],
  ['verify', '/docs/proof/verify'],
  ['trust-and-faq', '/docs/judges/trust-and-faq'],
];
const VIEWPORTS = [
  ['desktop-light', { width: 1440, height: 900 }, 1],
  ['phone-light', { width: 390, height: 844 }, 2],
];

const browser = await chromium.launch();
let saved = 0;
for (const [project, viewport, scale] of VIEWPORTS) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    isMobile: project.startsWith('phone'),
    colorScheme: 'light',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light');
    } catch {
      /* storage can be blocked */
    }
  });
  for (const [name, path] of PAGES) {
    const page = await context.newPage();
    const response = await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null);
    if (response === null || response.status() >= 400) {
      process.stdout.write(
        `skip ${path} (${response === null ? 'no response' : response.status()})\n`,
      );
      await page.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `docs-${name}--${project}.png`), fullPage: false });
    saved += 1;
    await page.close();
  }
  await context.close();
}
await browser.close();
process.stdout.write(`saved ${saved} docs screenshots\n`);
