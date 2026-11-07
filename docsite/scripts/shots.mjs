#!/usr/bin/env node
// Screenshots of the key pages, taken in CI against the static export (docsite/out).
// Usage: node scripts/shots.mjs <base-url> <out-dir> [export-dir]
// Needs playwright (installed with --no-save by the workflow). Not run on the VM.
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';
const outDir = process.argv[3] ?? 'shots';
const exportDir = process.argv[4] ?? 'out';
mkdirSync(outDir, { recursive: true });

// Key pages: three themes on desktop. Every docs page found in the export is also shot at
// 390 px wide (phone), and each page is checked for sideways scrolling of the whole page.
const key = [
  ['home', '/'],
  ['start', '/docs/start'],
  ['system-architecture', '/docs/how-it-works/system-architecture'],
  ['bid-lifecycle', '/docs/how-it-works/bid-lifecycle'],
  ['settlement-saga', '/docs/how-it-works/settlement-saga'],
  ['crash-recovery', '/docs/how-it-works/crash-recovery'],
  ['voice', '/docs/how-it-works/voice-and-confirm'],
  ['gates', '/docs/proof/gates'],
  ['evidence-map', '/docs/proof/evidence-map'],
  ['simulation', '/docs/proof/simulation'],
  ['judges', '/docs/judges'],
  ['threat-model', '/docs/safety/threat-model'],
  ['builders', '/docs/builders'],
  ['operator-runbook', '/docs/run/operator-runbook'],
];

function listDocs(dir, rel = '') {
  const urls = [];
  for (const name of readdirSync(join(dir, rel))) {
    const full = join(dir, rel, name);
    if (statSync(full).isDirectory()) urls.push(...listDocs(dir, join(rel, name)));
    else if (name.endsWith('.html') && rel.startsWith('docs')) {
      const slug = join(rel, name.replace(/\.html$/, '')).replace(/\/index$/, '');
      urls.push('/' + slug);
    }
  }
  return urls;
}

const browser = await chromium.launch();
let failures = 0;

async function shoot(name, url, { scheme, viewport, floodlight, checkOverflow }) {
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
  await page.waitForTimeout(1200);
  if (checkOverflow) {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) {
      console.error(`FAIL ${url}: page scrolls sideways by ${over}px at ${viewport.width}px`);
      failures += 1;
    }
  }
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  if (errors.length > 0) {
    console.error(`page errors on ${url}: ${errors.join(' | ')}`);
    failures += 1;
  }
  await context.close();
}

// Interaction check: the first step-through diagram on a page moves on when Next is pressed,
// and the full-size view opens and closes.
async function interact(url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(base + url, { waitUntil: 'networkidle' });
  const next = page.getByRole('button', { name: 'Next' }).first();
  if (await next.count()) {
    const live = page.locator('[aria-live="polite"]').first();
    const before = await live.innerText();
    await next.click();
    const after = await live.innerText();
    if (before === after) {
      console.error(`FAIL ${url}: Next did not change the step text`);
      failures += 1;
    }
  } else {
    console.error(`note ${url}: no step controls on this page`);
  }
  const full = page.getByRole('button', { name: 'Open full size' }).first();
  if (await full.count()) {
    await full.click();
    await page.screenshot({ path: join(outDir, `fullsize-${url.split('/').pop()}.png`) });
    await page.keyboard.press('Escape');
  }
  await context.close();
}

const dusk = { scheme: 'dark', viewport: { width: 1280, height: 900 } };
for (const [name, url] of key) {
  await shoot(`${name}-dusk-desktop`, url, dusk);
  await shoot(`${name}-daylight-desktop`, url, { scheme: 'light', viewport: { width: 1280, height: 900 } });
}
await shoot('home-floodlight-desktop', '/', { ...dusk, floodlight: true });

// Phone: every docs page.
for (const url of listDocs(exportDir)) {
  const name = url.replace(/^\/docs\/?/, '').replace(/\//g, '__') || 'docs-index';
  await shoot(`m390-${name}`, url, { scheme: 'dark', viewport: { width: 390, height: 844 }, checkOverflow: true });
}
await shoot('m390-home', '/', { scheme: 'dark', viewport: { width: 390, height: 844 }, checkOverflow: true });

for (const url of ['/docs/how-it-works/bid-lifecycle', '/docs/how-it-works/settlement-walkthrough']) {
  await interact(url);
}

await browser.close();
if (failures > 0) {
  console.error(`${failures} problem(s)`);
  process.exit(1);
}
