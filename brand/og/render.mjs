// Renders the GAVEL link-preview cards (brand/og/og.html) to PNG with Playwright. CI only.
// Usage: PW_DIR=<dir with playwright installed> node brand/og/render.mjs <outDir>
// The fonts are the app's own woff2 files, copied next to the template at render time.
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.env.PW_DIR ?? process.cwd(), 'x.js'));
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const out = path.resolve(process.argv[2] ?? 'og-out');
mkdirSync(out, { recursive: true });

const work = path.join(out, '.work');
mkdirSync(path.join(work, 'fonts'), { recursive: true });
for (const f of [
  'big-shoulders-display-latin-wght-normal.woff2',
  'public-sans-latin-wght-normal.woff2',
  'jetbrains-mono-latin-wght-normal.woff2',
]) {
  copyFileSync(path.join(root, 'docsite', 'lib', 'fonts', f), path.join(work, 'fonts', f));
}
const lockup = readFileSync(path.join(root, 'brand', 'svg', 'lockup-h-color.svg'), 'utf8').replace(
  '<svg ',
  '<svg class="logo" ',
);
writeFileSync(
  path.join(work, 'og.html'),
  readFileSync(path.join(here, 'og.html'), 'utf8').replace('<!--LOGO-->', lockup),
);

// name, variant, size class, width, height
const cards = [
  ['og-landing', 'landing', 'wide', 1200, 630],
  ['og-try', 'try', 'wide', 1200, 630],
  ['og-ledger', 'ledger', 'wide', 1200, 630],
  ['og-docs', 'docs', 'wide', 1200, 630],
  ['og-square', 'landing', 'square', 1200, 1200],
  ['github-social-preview-1280x640', 'landing', 'gh', 1280, 640],
];

const browser = await chromium.launch();
for (const [name, v, cls, w, h] of cards) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(work, 'og.html')}`);
  await page.evaluate(
    ([variant, c]) => {
      document.body.dataset.v = variant;
      document.body.className = c;
    },
    [v, cls],
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
}
await browser.close();
