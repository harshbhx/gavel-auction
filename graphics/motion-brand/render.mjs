// Brand motion set: logo intro sting and outro, paper and dark, as GIF + MP4 + WebM, plus the animated
// logo SVGs. Usage: node graphics/motion-brand/render.mjs <outDir> (CI only, see graphics.yml).
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { openBrowser, frames, still } from '../lib/render.mjs';
import { THEMES, writePage, fitGif, webm, frameCount, rm, logoFile } from '../lib/motion.mjs';
import { introBody, outroBody, W, H } from '../lib/scenes.mjs';
import { mp4 } from '../lib/render.mjs';

const out = path.resolve(process.argv[2] ?? 'out/motion-brand');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const FPS = 30;
const SECS = 4; // under 3 s of motion, then a 1 s hold
const report = [];

// Animated logo SVGs (CSS keyframes, no script, reduced motion shows the finished logo).
const svgDir = path.join(out, 'svg');
mkdirSync(svgDir, { recursive: true });
for (const variant of ['color', 'reversed']) {
  const files = {
    [`mark-${variant}-animated.svg`]: { kind: 'mark' },
    [`lockup-h-${variant}-animated.svg`]: { kind: 'lockup' },
    [`mark-${variant}-loader.svg`]: { kind: 'mark', loop: true },
  };
  for (const [name, o] of Object.entries(files)) {
    writeFileSync(path.join(svgDir, name), logoFile({ variant, ...o }));
    report.push(`${name} ${statSync(path.join(svgDir, name)).size}`);
  }
}

const browser = await openBrowser();
try {
  for (const themeName of ['paper', 'dark']) {
    const th = THEMES[themeName];
    for (const [kind, body] of [
      ['intro', introBody(th)],
      ['outro', outroBody(th)],
    ]) {
      const base = `gavel-${kind}-${themeName}`;
      const file = writePage(path.join(tmp, `${base}.html`), {
        theme: themeName,
        w: W,
        h: H,
        body,
      });
      const dir = path.join(tmp, base);
      await frames(browser, file, dir, W, H, FPS, SECS);
      const n = frameCount(dir);
      mp4(dir, path.join(out, `${base}.mp4`), FPS);
      webm(dir, path.join(out, `${base}.webm`), FPS);
      const size = fitGif(dir, path.join(out, `${base}.gif`), {
        inFps: FPS,
        outFps: 20,
        width: 960,
        limit: 1.6 * 1024 * 1024,
      });
      await still(browser, file, path.join(out, `${base}-poster.png`), W, H, {
        at: (SECS - 0.2) * 1000,
      });
      report.push(
        `${base}.gif ${size} bytes, source frames ${n} at ${FPS} fps, gif frames ${SECS * 20}`,
      );
      rm(dir);
    }
  }
} finally {
  await browser.close();
}
rm(tmp);
writeFileSync(path.join(out, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
