#!/usr/bin/env node
// Screenshots of the key pages, taken in CI against the static export (docsite/out).
// Usage: node scripts/shots.mjs <base-url> <out-dir>
// Needs playwright (installed with --no-save by the workflow). Not run on the VM.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';
const outDir = process.argv[3] ?? 'shots';
mkdirSync(outDir, { recursive: true });

const pages = [
  ['home', '/'],
  ['start', '/docs/start'],
  ['money-flow', '/docs/how-it-works/money-flow'],
  ['settlement-saga', '/docs/how-it-works/settlement-saga'],
  ['crash-recovery', '/docs/how-it-works/crash-recovery'],
  ['voice', '/docs/how-it-works/voice-and-confirm'],
  ['gates', '/docs/proof/gates'],
  ['simulation', '/docs/proof/simulation'],
];

const browser = await chromium.launch();
let failures = 0;

async function shoot(name, url, { scheme, viewport, floodlight }) {
  const context = await browser.newContext({ colorScheme: scheme, viewport, reducedMotion: 'reduce' });
  if (floodlight) {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('gavel-floodlight', '1');
      } catch {
        /* ignore */
      }
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const res = await page.goto(base + url, { waitUntil: 'networkidle' });
  if (!res || !res.ok()) {
    console.error(`FAIL ${url}: HTTP ${res?.status()}`);
    failures += 1;
  }
  // Mermaid renders after hydration.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  if (errors.length > 0) {
    console.error(`page errors on ${url}: ${errors.join(' | ')}`);
    failures += 1;
  }
  await context.close();
}

for (const [name, url] of pages) {
  await shoot(`${name}-dusk-desktop`, url, { scheme: 'dark', viewport: { width: 1280, height: 900 } });
  await shoot(`${name}-daylight-desktop`, url, { scheme: 'light', viewport: { width: 1280, height: 900 } });
}
await shoot('home-floodlight-desktop', '/', { scheme: 'dark', viewport: { width: 1280, height: 900 }, floodlight: true });
await shoot('home-dusk-phone', '/', { scheme: 'dark', viewport: { width: 390, height: 844 } });
await shoot('crash-recovery-daylight-phone', '/docs/how-it-works/crash-recovery', { scheme: 'light', viewport: { width: 390, height: 844 } });

await browser.close();
if (failures > 0) process.exit(1);
console.log(`screenshots written to ${outDir}`);
