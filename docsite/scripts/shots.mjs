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
  ['rubric-map', '/docs/judges/rubric-map'],
  ['guided-tour', '/docs/start/guided-tour'],
  ['glossary', '/docs/reference/glossary'],
  ['gate-g5', '/docs/proof/gate-g5'],
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

async function shoot(name, url, { scheme, viewport, checkOverflow }) {
  const context = await browser.newContext({ colorScheme: scheme, viewport, reducedMotion: 'reduce' });
  // Seed the old saved theme choices: the site must ignore them and render Newsprint.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('gavel-floodlight', '1');
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const res = await page.goto(base + url, { waitUntil: 'networkidle' });
  if (!res || !res.ok()) {
    console.error(`FAIL ${url}: HTTP ${res?.status()}`);
    failures += 1;
  }
  const themed = await page.evaluate(
    () => document.documentElement.classList.contains('dark') || 'floodlight' in document.documentElement.dataset,
  );
  if (themed) {
    console.error(`FAIL ${url}: a stored dark or floodlight theme was applied`);
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
  const next = page.getByRole('button', { name: 'Next', exact: true }).first();
  if (await next.count()) {
    const live = page.locator('[role="group"][aria-label$="through the diagram"] [aria-live="polite"]').first();
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


// Glossary tooltips: <Term> opens on hover, on keyboard focus and on tap, closes on mouse leave,
// Escape and a tap elsewhere, links to its glossary entry, and stays inside a phone viewport.
async function termChecks(url) {
  const fail = (m) => {
    console.error(`FAIL ${url}: ${m}`);
    failures += 1;
  };
  // Mouse: hover opens, leaving closes.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(base + url, { waitUntil: 'networkidle' });
    const term = page.locator('.hl-term-btn').first();
    const pop = page.locator('.hl-term-pop').first();
    if (!(await term.count())) fail('no <Term> on the page');
    else {
      await term.hover();
      await pop.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('hover did not open the definition'));
      const href = await pop.locator('a').getAttribute('href').catch(() => null);
      if (!href || !href.includes('/docs/reference/glossary#')) fail(`definition link is ${href}`);
      await page.screenshot({ path: join(outDir, 'term-hover-desktop.png') });
      await page.mouse.move(5, 5);
      await pop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('moving away did not close the definition'));
      // Keyboard: focus opens, Escape closes and keeps focus on the term.
      await term.focus();
      await pop.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('keyboard focus did not open the definition'));
      if ((await term.getAttribute('aria-expanded')) !== 'true') fail('aria-expanded is not true while open');
      await page.keyboard.press('Escape');
      await pop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Escape did not close the definition'));
    }
    await context.close();
  }
  // Touch on a phone: tap opens and pins, it fits the screen, a tap elsewhere closes it.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(base + url, { waitUntil: 'networkidle' });
    const terms = page.locator('.hl-term-btn');
    const pop = page.locator('.hl-term-pop').first();
    const n = await terms.count();
    for (const i of [0, Math.min(n - 1, 5), n - 1]) {
      await terms.nth(i).scrollIntoViewIfNeeded();
      await terms.nth(i).tap();
      await pop.waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail(`tap on term ${i} did not open the definition`));
      const box = await pop.boundingBox();
      if (box && (box.x < -1 || box.x + box.width > 391)) fail(`definition ${i} leaves the 390 px screen (x ${box.x}, width ${box.width})`);
      if (i === 0) await page.screenshot({ path: join(outDir, 'term-tap-390.png') });
      await page.mouse.click(2, 300).catch(() => {});
      await page.touchscreen.tap(2, 300);
      await pop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('a tap elsewhere did not close the definition'));
    }
    await context.close();
  }
}

// Newsprint is the only theme. Every context seeds the old saved theme values (dark, floodlight)
// and a dark system scheme in some shots, so these pictures prove they are ignored.
const stale = { scheme: 'dark', viewport: { width: 1280, height: 900 } };
for (const [name, url] of key) {
  await shoot(`${name}-stale-dark-desktop`, url, stale);
  await shoot(`${name}-desktop`, url, { scheme: 'light', viewport: { width: 1280, height: 900 } });
}
await shoot('home-1440', '/', { scheme: 'light', viewport: { width: 1440, height: 900 } });
await shoot('voice-1440', '/docs/how-it-works/voice-and-confirm', { scheme: 'light', viewport: { width: 1440, height: 900 } });

// Print layout, the 404 page and the Open Graph cards.
{
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 900, height: 1200 } });
  const page = await context.newPage();
  await page.goto(base + '/docs/how-it-works/voice-and-confirm', { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: join(outDir, 'print-voice.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.goto(base + '/docs/does-not-exist', { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(outDir, '404-desktop.png') });
  for (const [n, u] of [['site', '/og/site/image.png'], ['voice', '/og/docs/how-it-works/voice-and-confirm/image.png']]) {
    const r = await page.goto(base + u);
    if (!r || !r.ok()) {
      console.error(`FAIL ${u}: HTTP ${r?.status()}`);
      failures += 1;
    } else {
      await page.screenshot({ path: join(outDir, `og-${n}.png`) });
    }
  }
  await context.close();
}

// Phone: every docs page.
for (const url of listDocs(exportDir)) {
  const name = url.replace(/^\/docs\/?/, '').replace(/\//g, '__') || 'docs-index';
  await shoot(`m390-${name}`, url, { scheme: 'dark', viewport: { width: 390, height: 844 }, checkOverflow: true });
}
await shoot('m390-home', '/', { scheme: 'dark', viewport: { width: 390, height: 844 }, checkOverflow: true });

for (const url of ['/docs/how-it-works/bid-lifecycle', '/docs/how-it-works/settlement-walkthrough']) {
  await interact(url);
}

await termChecks('/docs/start/guided-tour');

await browser.close();
if (failures > 0) {
  console.error(`${failures} problem(s)`);
  process.exit(1);
}
