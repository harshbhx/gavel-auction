// Devpost story set (GFX-09): a 1600x500 header banner and eight 1000x560 inline illustrations for the written
// project description. Output per scene: GIF (15 fps), MP4 and WebM (24 fps), a poster PNG and a contact
// sheet (contact-*.png, review only). Usage: node graphics/motion-devpost-story/render.mjs <outDir> (CI only).
import { mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { openBrowser, frames, still } from '../lib/render.mjs';
import { fitGif, mp4v, webm, rm } from '../lib/motion.mjs';
import { pageHtml } from './kit.mjs';
import { all } from './scenes.mjs';

const out = path.resolve(process.argv[2] ?? 'out/motion-devpost-story');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const VIDEO_FPS = 24;
const GIF_FPS = 15;
const LADDER = [
  [128, 10],
  [96, 30],
  [64, 60],
  [48, 90],
  [32, 130],
];
const report = [];
const browser = await openBrowser();
const size = (f) => statSync(f).size;

for (const s of all) {
  if (only && !only.includes(s.name.slice(0, 2))) continue;
  const file = path.join(tmp, `${s.name}.html`);
  writeFileSync(file, pageHtml(s));
  const vdir = path.join(tmp, `${s.name}-v`);
  const gdir = path.join(tmp, `${s.name}-g`);
  await frames(browser, file, vdir, s.W, s.H, VIDEO_FPS, s.T);
  await frames(browser, file, gdir, s.W, s.H, GIF_FPS, s.T);
  const gif = path.join(out, `${s.name}.gif`);
  const banner = s.W > 1000;
  const gsize = fitGif(gdir, gif, {
    inFps: GIF_FPS,
    outFps: GIF_FPS,
    width: banner ? 1200 : s.W,
    limit: banner ? 1.9 * 1024 * 1024 : 1.9 * 1024 * 1024,
    ladder: LADDER,
  });
  mp4v(vdir, path.join(out, `${s.name}.mp4`), VIDEO_FPS);
  webm(vdir, path.join(out, `${s.name}.webm`), VIDEO_FPS);
  await still(browser, file, path.join(out, `${s.name}-poster.png`), s.W, s.H, { at: s.poster * 1000 });
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-framerate', String(VIDEO_FPS), '-i', path.join(vdir, 'f%04d.png'),
    '-vf', `select='not(mod(n\\,8))',scale=480:-1,tile=4x4`, '-frames:v', '1',
    path.join(out, `contact-${s.name}.png`),
  ]);
  report.push(
    `${s.name}: loop ${s.T}s, ${s.W}x${s.H}, gif ${gsize} B (${banner ? 1200 : s.W} px wide), mp4 ${size(path.join(out, s.name + '.mp4'))} B, webm ${size(path.join(out, s.name + '.webm'))} B`,
  );
  rm(vdir);
  rm(gdir);
}
await browser.close();
rm(tmp);
writeFileSync(path.join(out, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
