// Devpost set: node graphics/devpost/render.mjs <outDir>. Runs in CI (graphics.yml), never on the VM.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync, rmSync } from 'node:fs';
import { openBrowser, still, frames, gif } from '../lib/render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? 'out/devpost');
const src = (f) => path.join(here, f);
const browser = await openBrowser();

const gallery = [
  ['01-hero', 'gallery-01-hero'],
  ['02-how', 'gallery-02-how-it-works'],
  ['03-architecture', 'gallery-03-architecture'],
  ['04-judge-flow', 'gallery-04-judge-flow'],
  ['05-audit', 'gallery-05-audit-verify'],
  ['06-sponsors', 'gallery-06-partners'],
  ['07-open-data', 'gallery-07-open-data'],
  ['thumbnail', 'thumbnail'],
];
for (const [s, o] of gallery)
  await still(browser, src(`${s}.html`), path.join(out, `${o}.png`), 1500, 1000);

const gifs = [
  ['gif-intro', 'intro', 4.2, 10],
  ['gif-architecture', 'architecture', 9.8, 10, 6.9],
  ['gif-closing', 'closing', 3.6, 10],
];
const LIMIT = 1.9 * 1024 * 1024;
for (const [s, o, secs, fps, staticAt] of gifs) {
  const dir = path.join(out, '_frames', o);
  await frames(browser, src(`${s}.html`), dir, 1000, 600, fps, secs);
  // static fallback = the finished frame
  await still(browser, src(`${s}.html`), path.join(out, `${o}-static.png`), 1000, 600, {
    at: (staticAt ?? secs) * 1000,
  });
  let size = 0;
  for (const [colors, lossy, width] of [
    [96, 40, 1000],
    [64, 80, 1000],
    [48, 120, 900],
    [32, 150, 800],
  ]) {
    size = gif(dir, path.join(out, `${o}.gif`), { fps, width, colors, lossy });
    if (size <= LIMIT) break;
  }
  console.log(`${o}.gif ${size} bytes`);
}
rmSync(path.join(out, '_frames'), { recursive: true, force: true });
await browser.close();
for (const f of gallery) console.log(f[1], statSync(path.join(out, `${f[1]}.png`)).size);
