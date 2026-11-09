/* global document, window */
// Shared render helpers. Playwright is resolved from PW_DIR (CI installs it outside the repo).
// Animated pages are sampled by seeking, so output is deterministic: CSS/WAAPI animations are
// paused and set to the time, and a page may define window.__seek(ms) for JS-driven scenes.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(path.join(process.env.PW_DIR ?? process.cwd(), 'x.js'));
const { chromium } = require('playwright');

export async function openBrowser() {
  return chromium.launch();
}

async function load(browser, file, w, h, opts = {}) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: opts.scale ?? 1,
  });
  await page.emulateMedia({
    reducedMotion: 'no-preference',
    colorScheme: opts.dark ? 'dark' : 'light',
  });
  await page.goto(pathToFileURL(path.resolve(file)).href);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Static PNG of an HTML file. */
export async function still(browser, file, out, w, h, opts = {}) {
  mkdirSync(path.dirname(out), { recursive: true });
  const page = await load(browser, file, w, h, opts);
  if (opts.at !== undefined) await seek(page, opts.at);
  await page.screenshot({ path: out, omitBackground: !!opts.transparent });
  await page.close();
}

export async function seek(page, ms) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
    if (typeof window.__seek === 'function') window.__seek(t);
  }, ms);
}

/** Frames of an animated HTML file, sampled at fps for seconds. Returns the frame dir. */
export async function frames(browser, file, dir, w, h, fps, seconds, opts = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await load(browser, file, w, h, opts);
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) {
    await seek(page, (i / fps) * 1000);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) });
  }
  await page.close();
  return dir;
}

/** Two pass palette GIF with ffmpeg; optional gifsicle. Loops forever. */
export function gif(dir, out, { fps, width, colors = 128, lossy = 0 }) {
  mkdirSync(path.dirname(out), { recursive: true });
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(fps),
    '-i',
    path.join(dir, 'f%04d.png'),
    '-vf',
    vf,
    '-loop',
    '0',
    out,
  ]);
  if (lossy) {
    try {
      execFileSync('gifsicle', ['-O3', `--lossy=${lossy}`, '-b', out]);
    } catch {
      /* gifsicle is optional */
    }
  }
  return statSync(out).size;
}

export function mp4(dir, out, fps) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(fps),
    '-i',
    path.join(dir, 'f%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '16',
    '-movflags',
    '+faststart',
    out,
  ]);
}

export function listPng(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.png'));
}
