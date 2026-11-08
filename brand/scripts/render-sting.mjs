/* global document */
// Renders brand/svg/sting.svg and sting-transparent.svg to PNG frames at 1920x1080, 30 fps, 3 s.
// Frames are sampled by seeking the Web Animations timeline, so the output is deterministic and does
// not depend on how fast the runner is. Usage: PW_DIR=<dir with playwright installed> node render-sting.mjs <outDir>
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.env.PW_DIR ?? process.cwd(), 'x.js'));
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? 'frames';
const FPS = 30;
const SECONDS = 3;
const variants = [
  { name: 'paper', file: 'sting.svg', transparent: false },
  { name: 'alpha', file: 'sting-transparent.svg', transparent: true },
];

const browser = await chromium.launch();
for (const v of variants) {
  const dir = path.join(out, v.name);
  mkdirSync(dir, { recursive: true });
  const svg = readFileSync(path.join(here, '..', 'svg', v.file), 'utf8').replace(
    '<svg ',
    '<svg width="1920" height="1080" ',
  );
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:${v.transparent ? 'transparent' : '#efe6d3'}}svg{display:block}</style></head><body>${svg}</body></html>`,
  );
  for (let i = 0; i < FPS * SECONDS; i++) {
    const t = (i / FPS) * 1000;
    await page.evaluate((ms) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = ms;
      }
    }, t);
    await page.screenshot({
      path: path.join(dir, `f${String(i).padStart(3, '0')}.png`),
      omitBackground: v.transparent,
    });
  }
  await page.close();
}
await browser.close();
