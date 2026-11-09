// Devpost motion set (GFX-09 redesign): eight slides, each one idea and one hero visual, authored as pure
// functions of time (see runtime.js), rendered by seeking. Output per slide: GIF (20 fps), MP4 and WebM
// (24 fps), a poster PNG and a contact sheet of the frames (contact-*.png, for review only).
// Usage: node graphics/motion-devpost/render.mjs <outDir> (CI only, see graphics.yml).
import { mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { openBrowser, frames, still } from '../lib/render.mjs';
import { fitGif, mp4v, webm, rm } from '../lib/motion.mjs';
import { pageHtml, W, H } from './kit.mjs';
import * as A from './slides-a.mjs';
import * as B from './slides-b.mjs';

const out = path.resolve(process.argv[2] ?? 'out/motion-devpost');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const LIMIT = 3.8 * 1024 * 1024; // each GIF must stay under 4 MB
const VIDEO_FPS = 24;
const GIF_FPS = 20;
const LADDER = [
  [192, 10],
  [128, 30],
  [96, 60],
  [64, 90],
  [48, 130],
];
const slides = [A.hero, A.how, A.arch, A.judge, B.audit, B.partners, B.data, B.ending];
const report = [];
const browser = await openBrowser();
const size = (f) => statSync(f).size;

for (const s of slides) {
  if (only && !only.includes(s.name.slice(0, 2))) continue;
  const file = path.join(tmp, `${s.name}.html`);
  writeFileSync(file, pageHtml({ T: s.T, html: s.html, js: s.js }));
  const vdir = path.join(tmp, `${s.name}-v`);
  const gdir = path.join(tmp, `${s.name}-g`);
  await frames(browser, file, vdir, W, H, VIDEO_FPS, s.T);
  await frames(browser, file, gdir, W, H, GIF_FPS, s.T);
  const nv = readdirSync(vdir).length;
  const ng = readdirSync(gdir).length;
  const gif = path.join(out, `${s.name}.gif`);
  const gsize = fitGif(gdir, gif, {
    inFps: GIF_FPS,
    outFps: GIF_FPS,
    width: W,
    limit: LIMIT,
    ladder: LADDER,
  });
  mp4v(vdir, path.join(out, `${s.name}.mp4`), VIDEO_FPS);
  webm(vdir, path.join(out, `${s.name}.webm`), VIDEO_FPS);
  await still(browser, file, path.join(out, `${s.name}-poster.png`), W, H, { at: s.poster * 1000 });
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(VIDEO_FPS),
    '-i',
    path.join(vdir, 'f%04d.png'),
    '-vf',
    `select='not(mod(n\\,8))',scale=480:-1,tile=4x4`,
    '-frames:v',
    '1',
    path.join(out, `contact-${s.name}.png`),
  ]);
  report.push(
    `${s.name}: loop ${s.T}s, ${nv} frames at ${VIDEO_FPS} fps (mp4 ${size(path.join(out, s.name + '.mp4'))} B, webm ${size(path.join(out, s.name + '.webm'))} B), gif ${ng} frames at ${GIF_FPS} fps ${gsize} B, ${W}x${H}`,
  );
  rm(vdir);
  rm(gdir);
}

await browser.close();
rm(tmp);
writeFileSync(path.join(out, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
