/* global window, document */
// Composes the silent video from the raw recording (record.mjs) and the type cards. CI only.
// Usage: PW_DIR=<dir with playwright> node compose.mjs <rawDir> <outDir>
// Pipeline: per actor a constant 24 fps stream on the shared clock; per scene either a card (HTML
// frames sampled by seeking, the last frame held) or a recorded scene (chrome plate PNG + panes cut out
// of the actor streams + an animated caption layer); dip-to-paper transitions; one H.264 encode, a WebM,
// a poster, the SRT, contact sheets every 3 s and a report.
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  linkSync,
  rmSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBrowser, frames as renderFrames } from '../lib/render.mjs';
import { W, H, FPS, PAPER, chromeHtml, captionHtml, cardPage, CAP } from './kit.mjs';
import { SCENES } from './story.mjs';
import * as C from './cards.mjs';

const RAW = path.resolve(process.argv[2] ?? 'out/raw');
const OUT = path.resolve(process.argv[3] ?? 'out/final');
const TMP = path.join(OUT, '.tmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log('[compose]', ...a);
const warn = [];
const ff = (args, label = 'ffmpeg') => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch {
    throw new Error(`${label} failed: ${args.slice(0, 12).join(' ')}`);
  }
};
const FADE = 0.3; // dip to paper at both ends of a scene

const meta = JSON.parse(readFileSync(path.join(RAW, 'meta.json'), 'utf8'));
const apiPath = path.join(RAW, 'api.json');
const api = existsSync(apiPath) ? JSON.parse(readFileSync(apiPath, 'utf8')) : null;
if (!api) warn.push('api.json missing: the API card shows placeholder answers');
const markOf = Object.fromEntries(meta.marks.map((m) => [m.id, m]));
const evOf = Object.fromEntries(meta.events.map((e) => [e.id, e.t]));
const T0 = Math.min(...meta.marks.map((m) => m.start)) - 0.3;
const T1 = Math.max(...meta.marks.map((m) => m.end)) + 0.5;

// ----------------------------------------------------------------------------- actor streams
const streams = {};
function stream(name) {
  if (streams[name]) return streams[name];
  const a = meta.actors[name];
  if (!a || a.frames.length === 0) throw new Error(`no frames for actor ${name}`);
  const fr = a.frames.slice().sort((x, y) => x[0] - y[0]);
  let first = 0;
  while (first + 1 < fr.length && fr[first + 1][0] <= T0) first += 1;
  const list = [];
  for (let i = first; i < fr.length; i += 1) {
    const s = i === first ? T0 : fr[i][0];
    const e = i + 1 < fr.length ? fr[i + 1][0] : T1;
    if (e <= T0 || s >= T1) continue;
    list.push(
      `file '${path.join(RAW, name, fr[i][1])}'\nduration ${Math.max(0.001, Math.min(e, T1) - Math.max(s, T0)).toFixed(4)}`,
    );
  }
  list.push(`file '${path.join(RAW, name, fr[fr.length - 1][1])}'`);
  const lf = path.join(TMP, `${name}.txt`);
  writeFileSync(lf, list.join('\n'));
  const out = path.join(TMP, `${name}.mp4`);
  ff(
    [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      lf,
      '-vf',
      `fps=${FPS}`,
      '-t',
      (T1 - T0).toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '12',
      '-pix_fmt',
      'yuv420p',
      out,
    ],
    `stream ${name}`,
  );
  streams[name] = out;
  log('stream', name, `${a.frames.length} frames`);
  return out;
}

// ----------------------------------------------------------------------------- layout
const WIN = { x: 64, y: 140, w: 1280, h: 720 };
const GAP = 24;
const STACK_GAP = 38;
function sizeOf(p) {
  const a = meta.actors[p.src];
  const ar = a.w / a.h;
  if (p.w) return { w: Math.round(p.w), h: Math.round(p.w / ar) };
  return { w: Math.round(p.h * ar), h: Math.round(p.h) };
}
function layout(panes) {
  const cols = panes.map((p) => {
    if (p.stack) {
      const items = p.stack.map((s) => ({ ...s, ...sizeOf(s) }));
      const w = Math.max(...items.map((s) => s.w));
      const h = items.reduce((n, s) => n + s.h, 0) + STACK_GAP * (items.length - 1);
      return { items, w, h };
    }
    const s = sizeOf(p);
    return { items: [{ ...p, ...s }], ...s };
  });
  const total = cols.reduce((n, c) => n + c.w, 0) + GAP * (cols.length - 1);
  let x = WIN.x + Math.round((WIN.w - total) / 2);
  const out = [];
  for (const c of cols) {
    let y = WIN.y + Math.round((WIN.h - c.h) / 2);
    for (const it of c.items) {
      out.push({
        src: it.src,
        x,
        y,
        w: it.w,
        h: it.h,
        label: it.label,
        stacked: c.items.length > 1,
      });
      y += it.h + STACK_GAP;
    }
    x += c.w + GAP;
  }
  return out;
}

// ----------------------------------------------------------------------------- browser helpers
const browser = await openBrowser();
async function openPage(htmlFile) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const strip = (s) => s.replace(/<[^>]+>/g, '');

// ----------------------------------------------------------------------------- scenes
const timeline = []; // { id, start, dur, caps: [{a,b,text}] } absolute seconds
const sceneFiles = [];
let cursor = 0;

const fadeVf = (dur) =>
  `fade=t=in:st=0:d=${FADE}:color=0x${PAPER.slice(1)},fade=t=out:st=${(dur - FADE).toFixed(3)}:d=${FADE}:color=0x${PAPER.slice(1)}`;

async function cardScene(sc) {
  const card = sc.card === 'api' ? C.apiCard(api) : C[sc.card];
  const file = path.join(TMP, `card-${sc.id}.html`);
  writeFileSync(file, cardPage({ html: card.html, js: card.js }));
  const dir = path.join(TMP, `card-${sc.id}`);
  await renderFrames(browser, file, dir, W, H, FPS, card.settle);
  const out = path.join(TMP, `scene-${sc.id}.mp4`);
  const hold = Math.max(0, sc.dur - card.settle);
  ff(
    [
      '-framerate',
      String(FPS),
      '-i',
      path.join(dir, 'f%04d.png'),
      '-vf',
      `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},${fadeVf(sc.dur)},format=yuv420p`,
      '-t',
      sc.dur.toFixed(3),
      '-r',
      String(FPS),
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '14',
      out,
    ],
    `card ${sc.id}`,
  );
  rmSync(dir, { recursive: true, force: true });
  return { out, dur: sc.dur, caps: sc.lines };
}

async function shotScene(sc) {
  const m = markOf[sc.shot];
  if (!m || !m.ok) {
    warn.push(
      `scene ${sc.id}: shot ${sc.shot} ${m ? 'failed: ' + m.note : 'missing'}; scene skipped`,
    );
    return null;
  }
  const from = sc.from ?? 0;
  const avail = m.end - m.start - from;
  let speed = sc.speed ?? 1;
  if (sc.target) speed = Math.min(2.4, Math.max(1, avail / sc.target));
  const srcDur = sc.dur ? sc.dur * speed : avail;
  const dur = +(srcDur / speed).toFixed(3);
  log(`  ${sc.id}: ${avail.toFixed(1)} s recorded, speed ${speed.toFixed(2)}, ${dur.toFixed(1)} s`);
  const startAbs = m.start + from;
  const rects = layout(sc.panes);
  // chrome plate
  const chromeFile = path.join(TMP, `chrome-${sc.id}.html`);
  writeFileSync(chromeFile, chromeHtml({ step: sc.step, panes: rects }));
  const cp = await openPage(chromeFile);
  const bg = path.join(TMP, `bg-${sc.id}.png`);
  await cp.screenshot({ path: bg });
  await cp.close();
  // captions
  const caps = sc.caps
    .map((c) => {
      const base = c.at ? (evOf[c.at] ?? null) : null;
      if (c.at && base === null)
        warn.push(`scene ${sc.id}: event ${c.at} missing, caption timed from the scene start`);
      const rel = base === null ? 0 : (base - startAbs) / speed;
      return { ...c, a: Math.max(0, rel + c.a), rel };
    })
    .sort((x, y) => x.a - y.a);
  caps.forEach((c, k) => {
    const next = caps[k + 1];
    let b = c.b === 'end' || c.b === 'next' ? dur - 0.35 : Math.min(dur - 0.2, c.rel + c.b);
    if (c.b === 'next' && next) b = next.a;
    if (next) b = Math.min(b, next.a);
    c.b = Math.max(b, c.a + 0.5);
  });
  for (const c of caps)
    if (c.b - c.a < 2.5)
      warn.push(
        `scene ${sc.id}: caption "${strip(c.text)}" shows ${(c.b - c.a).toFixed(1)} s (< 2.5 s)`,
      );
  const capDir = path.join(TMP, `cap-${sc.id}`);
  rmSync(capDir, { recursive: true, force: true });
  mkdirSync(capDir, { recursive: true });
  const capFile = path.join(TMP, `cap-${sc.id}.html`);
  writeFileSync(capFile, captionHtml(caps));
  const page = await openPage(capFile);
  const n = Math.round(dur * FPS);
  const IN = 0.55;
  const OUTD = 0.3;
  const cache = new Map();
  for (let i = 0; i < n; i += 1) {
    const t = i / FPS;
    const vis = [];
    let sig = '';
    caps.forEach((c, k) => {
      const inP = Math.min(1, Math.max(0, (t - c.a) / IN));
      const outP = Math.min(1, Math.max(0, (t - (c.b - OUTD)) / OUTD));
      if (inP > 0 && outP < 1) {
        const e = (x) => 1 - Math.pow(1 - x, 4);
        const ip = e(inP);
        const op = outP * outP * outP;
        vis.push({ i: k, inP: ip, outP: op });
        sig += `${k}:${ip.toFixed(3)}:${op.toFixed(3)};`;
      }
    });
    const dst = path.join(capDir, `c${String(i).padStart(5, '0')}.png`);
    if (cache.has(sig)) {
      linkSync(cache.get(sig), dst);
      continue;
    }
    await page.evaluate((s) => window.setState(s), vis);
    await page.screenshot({
      path: dst,
      omitBackground: true,
      clip: { x: CAP.x, y: 140, width: CAP.w, height: 720 },
    });
    cache.set(sig, dst);
  }
  await page.close();
  // compose
  const inputs = ['-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', bg];
  const filters = [];
  let last = '0:v';
  rects.forEach((r, i) => {
    const s = stream(r.src);
    inputs.push('-ss', (startAbs - T0).toFixed(3), '-t', srcDur.toFixed(3), '-i', s);
    filters.push(
      `[${i + 1}:v]setpts=(PTS-STARTPTS)/${speed},scale=${r.w}:${r.h}:flags=lanczos[p${i}]`,
    );
    filters.push(`[${last}][p${i}]overlay=${r.x}:${r.y}:shortest=1[o${i}]`);
    last = `o${i}`;
  });
  const ci = rects.length + 1;
  inputs.push('-framerate', String(FPS), '-i', path.join(capDir, 'c%05d.png'));
  filters.push(`[${last}][${ci}:v]overlay=${CAP.x}:140:format=auto:shortest=1[oc]`);
  filters.push(`[oc]${fadeVf(dur)},format=yuv420p[v]`);
  const out = path.join(TMP, `scene-${sc.id}.mp4`);
  ff(
    [
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[v]',
      '-t',
      dur.toFixed(3),
      '-r',
      String(FPS),
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '14',
      out,
    ],
    `scene ${sc.id}`,
  );
  rmSync(capDir, { recursive: true, force: true });
  return { out, dur, caps };
}

for (const sc of SCENES) {
  log('scene', sc.id);
  const r = sc.kind === 'card' ? await cardScene(sc) : await shotScene(sc);
  if (!r) continue;
  timeline.push({
    id: sc.id,
    start: cursor,
    dur: r.dur,
    caps: r.caps.map((c) => ({
      a: cursor + c.a,
      b: cursor + c.b,
      text: strip(c.text) + (c.sub ? ' ' + c.sub : ''),
    })),
  });
  sceneFiles.push(r.out);
  cursor += r.dur;
}
await browser.close();

// ----------------------------------------------------------------------------- final encodes
const listFile = path.join(TMP, 'scenes.txt');
writeFileSync(listFile, sceneFiles.map((f) => `file '${f}'`).join('\n'));
const mp4 = path.join(OUT, 'gavel-silent-cut.mp4');
ff(
  [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ],
  'final mp4',
);
const webm = path.join(OUT, 'gavel-silent-cut.webm');
ff(
  [
    '-i',
    mp4,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '34',
    '-cpu-used',
    '4',
    '-row-mt',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-an',
    webm,
  ],
  'webm',
);
const titleScene = timeline.find((s) => s.id === 'title');
ff(
  [
    '-ss',
    ((titleScene?.start ?? 0) + 3.8).toFixed(2),
    '-i',
    mp4,
    '-frames:v',
    '1',
    path.join(OUT, 'gavel-silent-cut-poster.png'),
  ],
  'poster',
);

// captions
const tc = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
let n = 0;
const srt = [];
const rows = [];
for (const sc of timeline) {
  for (const c of sc.caps) {
    n += 1;
    srt.push(`${n}\n${tc(c.a)} --> ${tc(c.b)}\n${c.text}\n`);
    rows.push(
      `${String(n).padStart(2)}  ${tc(c.a)} --> ${tc(c.b)}  ${(c.b - c.a).toFixed(1)} s  [${sc.id}] ${c.text}`,
    );
    if (c.b - c.a < 2.5)
      warn.push(`caption ${n} [${sc.id}] shows ${(c.b - c.a).toFixed(1)} s (< 2.5 s)`);
  }
}
writeFileSync(path.join(OUT, 'gavel-silent-cut.en.srt'), srt.join('\n'));
writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));

// contact sheets, one frame every 3 s, 5x4 per sheet
ff(
  [
    '-i',
    mp4,
    '-vf',
    'fps=1/3,scale=384:216,tile=5x4:padding=6:color=0x1d1712',
    '-vsync',
    '0',
    path.join(OUT, 'contact-%02d.png'),
  ],
  'contact',
);

const dur = cursor;
const size = (f) => (statSync(f).size / 1048576).toFixed(2);
const report = [
  `duration ${dur.toFixed(1)} s, ${FPS} fps, ${W}x${H}`,
  `mp4 ${size(mp4)} MB, webm ${size(webm)} MB`,
  '',
  ...timeline.map((s) => `${tc(s.start)}  ${s.dur.toFixed(1).padStart(5)} s  ${s.id}`),
  '',
  ...rows,
  '',
  `warnings (${warn.length}):`,
  ...warn.map((w) => '  ' + w),
].join('\n');
writeFileSync(path.join(OUT, 'report.txt'), report + '\n');
console.log(report);
rmSync(TMP, { recursive: true, force: true });
if (dur < 100 || dur > 150) {
  console.log(`NOTE: duration ${dur.toFixed(1)} s is outside 100 to 150 s`);
}
