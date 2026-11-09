// README motion set: banner, stats, how it works, footer and a 10 s reel. Minimal on purpose: one idea per
// graphic, big type, whitespace, motion from frame 0, loops of 4 to 10 s, GIFs at 20 fps.
// Usage: node graphics/motion-readme/render.mjs <outDir> (CI only, see graphics.yml).
// Each is rendered at 30 fps; the GIF is resampled to 20 fps and an MP4 and WebM are written beside it.
// Every number is quoted from docs/GATES.md and docs/evidence/; simulated things are labelled.
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { openBrowser, frames, still } from '../lib/render.mjs';
import {
  THEMES,
  writePage,
  fitGif,
  frameCount,
  rm,
  logoSvg,
  rule,
  mp4v,
  webm,
} from '../lib/motion.mjs';
import { introBody } from '../lib/scenes.mjs';

const out = path.resolve(process.argv[2] ?? 'out/motion-readme');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const report = [];
const browser = await openBrowser();
const FPS = 30;
const GIF_FPS = 20;

async function make(name, themeName, { w, h, secs, body, css = '', limit, width, poster }) {
  const base = themeName === 'dark' ? `${name}-dark` : name;
  const file = writePage(path.join(tmp, `${base}.html`), { theme: themeName, w, h, body, css });
  const dir = path.join(tmp, base);
  await frames(browser, file, dir, w, h, FPS, secs);
  const n = frameCount(dir);
  const size = fitGif(dir, path.join(out, `${base}.gif`), {
    inFps: FPS,
    outFps: GIF_FPS,
    width: width ?? w,
    limit,
  });
  mp4v(dir, path.join(out, `${base}.mp4`), FPS);
  webm(dir, path.join(out, `${base}.webm`), FPS);
  await still(browser, file, path.join(out, `${base}-poster.png`), w, h, {
    at: (poster ?? secs - 0.1) * 1000,
  });
  const sz = (e) => statSync(path.join(out, `${base}.${e}`)).size;
  report.push(
    `${base}: gif ${size} bytes (${secs * GIF_FPS} frames at ${GIF_FPS} fps), mp4 ${sz('mp4')}, webm ${sz('webm')}, ${n} source frames at ${FPS} fps, ${w}x${h}`,
  );
  rm(dir);
}

/* ---- banner: the logo and the tagline, nothing else ---- */
const bannerBody = (th) => `
<div class="abs" style="left:240px;top:40px;width:800px">${logoSvg({ variant: th.variant, start: 0 })}</div>
<div class="abs disp rise" style="--d:1.9s;left:0;right:0;top:322px;text-align:center;font-size:46px">Every bid is a PayPal hold. <span class="or">Only the winner pays.</span></div>
<div class="abs" style="left:0;bottom:0">${rule(1280, 2.2, 8)}</div>`;
for (const t of ['paper', 'dark'])
  await make('readme-banner', t, {
    w: 1280,
    h: 400,
    secs: 4,
    body: bannerBody(THEMES[t]),
    limit: 500 * 1024,
  });

/* ---- stats: three things built and proven, big type ---- */
const col = (i, label, to, unit, sub) => `
<div class="abs" style="left:${40 + i * 420}px;top:0;width:400px;height:360px">
  <div class="lab rise" style="--d:${0.05 + i * 0.12}s;position:absolute;top:50px;font-size:15px">${label}</div>
  <div class="disp" style="position:absolute;top:84px;font-size:190px;white-space:nowrap"><span data-count="${to}" data-from="0" data-start="${0.1 + i * 0.12}" data-dur="1.1" data-dec="0" data-suf="<small style='font-size:64px'> ${unit}</small>">0</span></div>
  <div class="rise" style="--d:${1 + i * 0.12}s;position:absolute;top:300px;display:flex;gap:12px;align-items:center"><span class="tag ok">Pass</span><span class="lab" style="font-size:14px;color:var(--ink)">${sub}</span></div>
</div>`;
const statsBody = `
${col(0, 'Live voice, 24 synthetic clips', 24, '/ 24', 'answered, confirm before bid')}
${col(1, 'Server killed mid-capture', 0, 'diffs', 'journal equals PayPal')}
${col(2, 'Hash-chained ledger', 19, 'entries', 'the chain verifies')}
<div class="abs" style="left:440px;top:60px;height:230px;border-left:2px solid var(--rule)"></div>
<div class="abs" style="left:860px;top:60px;height:230px;border-left:2px solid var(--rule)"></div>
<div class="abs lab rise" style="--d:1.3s;left:40px;top:12px;font-size:12px">Built and proven. PayPal sandbox only</div>`;
for (const t of ['paper', 'dark'])
  await make('readme-stats', t, {
    w: 1280,
    h: 360,
    secs: 4,
    body: statsBody,
    limit: 300 * 1024,
    poster: 3.8,
  });

/* ---- how it works: hold, bid, hammer, receipt ---- */
const STEPS = [
  ['Hold', 'A PayPal hold sets the ceiling. Held, not charged.'],
  ['Bid', 'Every bid is checked against that hold.'],
  ['Hammer', 'The highest valid bid wins.'],
  ['Receipt', 'The winner pays. Every other hold is released.'],
];
const howBody = `
<div class="abs lab rise" style="--d:0s;left:40px;top:34px;font-size:14px">One lot, simulated. PayPal sandbox only.</div>
${STEPS.map(
  (s, i) => `
<div class="abs disp rise" style="--d:${0.1 + i * 0.5}s;left:${40 + i * 300}px;top:110px;font-size:80px">${s[0]}</div>
<div class="abs grow" style="--d:${0.2 + i * 0.5}s;--len:.5s;left:${40 + i * 300}px;top:232px;width:260px;height:7px;background:var(--orange)"></div>
<div class="abs rise" style="--d:${0.45 + i * 0.5}s;left:${40 + i * 300}px;top:262px;width:262px;font:600 20px var(--body);line-height:1.35;color:var(--muted)">${s[1]}</div>`,
).join('')}
`;
for (const t of ['paper', 'dark'])
  await make('how-it-works', t, {
    w: 1240,
    h: 400,
    secs: 5,
    body: howBody,
    limit: 300 * 1024,
    poster: 4.9,
  });

/* ---- footer: logo and links ---- */
const link = (i, k, u) => `
<div class="abs rise" style="--d:${1.5 + i * 0.18}s;left:690px;top:${58 + i * 62}px;width:520px;display:flex;align-items:baseline;gap:18px;border-top:2px solid var(--ink);padding-top:8px">
<span class="lab" style="width:78px;font-size:12px">${k}</span><span class="disp" style="font-size:30px">${u}</span></div>`;
const footBody = (th) => `
<div class="abs" style="left:10px;top:30px;width:620px">${logoSvg({ variant: th.variant, start: 0 })}</div>
${link(0, 'Web app', 'gavel.dualmindlab.tech')}${link(1, 'Docs', 'docs.gavel.dualmindlab.tech')}${link(2, 'Source', 'github.com/harshbhx/gavel-auction')}
<div class="abs lab rise" style="--d:2.1s;left:690px;top:252px;font-size:12px">PayPal sandbox only. Bids are held, not charged.</div>
<div class="abs" style="left:0;bottom:0">${rule(1240, 2.2, 8)}</div>`;
for (const t of ['paper', 'dark'])
  await make('readme-footer', t, {
    w: 1240,
    h: 290,
    secs: 4,
    body: footBody(THEMES[t]),
    limit: 400 * 1024,
  });

/* ---- reel: 10 s, five quick scenes, 960x540 ---- */
{
  const th = THEMES.paper;
  const L = [3.1, 1.8, 1.8, 1.9, 1.4];
  const AT = L.reduce((a, l, i) => (a.push(i ? a[i - 1] + L[i - 1] : 0), a), []);
  const d = (s, x) => `${(AT[s] + x).toFixed(2)}s`;
  const scn = (s, inner) => `<div class="scn" style="--at:${AT[s]}s;--len:${L[s]}s">${inner}</div>`;
  const small = (html) =>
    `<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(.5);transform-origin:0 0">${html}</div>`;
  const title = (s, a, b) =>
    `<div class="abs disp wipe" style="--d:${d(s, 0.02)};left:44px;top:150px;font-size:84px;width:440px">${a}<br><span class="or">${b}</span></div>`;
  const s1 = `
${title(1, 'A bid is', 'a hold.')}
<div class="abs disp" style="left:520px;top:110px;font-size:210px;white-space:nowrap"><span data-ladder="${AT[1] + 0.1}:$10,${AT[1] + 0.6}:$15,${AT[1] + 1.1}:$20" data-init="$10">$10</span></div>
<div class="abs rise" style="--d:${d(1, 0.3)};left:526px;top:340px;display:flex;gap:12px;align-items:center"><span class="tag sim">Simulated</span><span class="lab" style="font-size:14px;color:var(--ink)">Held on PayPal, not charged</span></div>`;
  const s2 = `
${title(2, 'The hammer', 'falls.')}
<div class="ring1" style="--d:${d(2, 0.2)};left:540px;top:100px;width:380px;height:380px"></div>
<div class="abs card slam" style="--d:${d(2, 0.1)};left:520px;top:150px;width:400px;padding:20px;background:var(--green);border-color:var(--ink)">
  <div class="disp" style="font-size:50px;color:#fff;line-height:.98;white-space:nowrap">Sold to paddle 2<br>for $20.00</div></div>
<div class="abs rise" style="--d:${d(2, 0.6)};left:524px;top:340px;display:flex;gap:12px;align-items:center"><span class="tag sim">Simulated</span><span class="lab" style="font-size:14px;color:var(--ink)">Winner captured. Others released.</span></div>`;
  const blocks = [16, 17, 18, 19]
    .map(
      (n, i) => `
<div class="abs card ${i < 2 ? 'snapl' : 'snapr'}" style="--d:${d(3, 0.05 + i * 0.08)};left:${500 + i * 108}px;top:130px;width:92px;height:84px;padding:10px 12px;box-shadow:5px 5px 0 var(--shadow)"><div class="lab" style="font-size:11px">Entry</div><div class="disp" style="font-size:44px">${n}</div></div>
${i < 3 ? `<div class="abs grow" style="--d:${d(3, 0.5 + i * 0.08)};--len:.2s;left:${592 + i * 108}px;top:168px;width:16px;height:8px;background:var(--orange)"></div>` : ''}`,
    )
    .join('');
  const s3 = `
${title(3, 'Check it', 'yourself.')}
${blocks}
<div class="abs card slam" style="--d:${d(3, 0.95)};left:500px;top:250px;width:420px;padding:16px 20px"><div style="display:flex;justify-content:space-between"><span class="lab">Receipt</span><span class="tag ok">Chain verifies</span></div><div class="disp" style="font-size:36px;margin-top:8px;white-space:nowrap">19 entries, 0 differences</div><div class="lab" style="font-size:11px;margin-top:6px;line-height:1.5">Measured: server killed mid-capture, real PayPal sandbox</div></div>`;
  const lk = (i, k, u) =>
    `<div class="abs rise" style="--d:${d(4, 0.25 + i * 0.12)};left:210px;top:${300 + i * 62}px;width:560px;display:flex;align-items:baseline;gap:18px;border-top:2px solid var(--ink);padding-top:8px"><span class="lab" style="width:78px;font-size:12px">${k}</span><span class="disp" style="font-size:30px">${u}</span></div>`;
  const s4 = `
<div class="abs" style="left:170px;top:50px;width:620px">${logoSvg({ variant: th.variant, still: true })}</div>
${lk(0, 'Web app', 'gavel.dualmindlab.tech')}${lk(1, 'Docs', 'docs.gavel.dualmindlab.tech')}${lk(2, 'Source', 'github.com/harshbhx/gavel-auction')}`;
  const cur = (i) =>
    `<div class="cur" style="--at:${(AT[i] - 0.2).toFixed(2)}s;animation-duration:.45s"></div>`;
  const body = `${scn(0, small(introBody(th, 0)))}${scn(1, s1)}${scn(2, s2)}${scn(3, s3)}${scn(4, s4)}${cur(1)}${cur(2)}${cur(3)}${cur(4)}`;
  const REEL_CSS =
    '.snapl{animation:gv-snapl .45s cubic-bezier(.2,.8,.2,1) var(--d,0s) backwards}.snapr{animation:gv-snapr .45s cubic-bezier(.2,.8,.2,1) var(--d,0s) backwards}@keyframes gv-snapl{from{opacity:0;transform:translateX(-90px)}}@keyframes gv-snapr{from{opacity:0;transform:translateX(90px)}}';
  const file = writePage(path.join(tmp, 'reel.html'), {
    theme: 'paper',
    w: 960,
    h: 540,
    body,
    css: REEL_CSS,
  });
  const dir = path.join(tmp, 'reel');
  await frames(browser, file, dir, 960, 540, FPS, 10);
  const n = frameCount(dir);
  const size = fitGif(dir, path.join(out, 'reel.gif'), {
    inFps: FPS,
    outFps: GIF_FPS,
    width: 960,
    limit: 1.8 * 1024 * 1024,
  });
  mp4v(dir, path.join(out, 'reel.mp4'), FPS);
  webm(dir, path.join(out, 'reel.webm'), FPS);
  await still(browser, file, path.join(out, 'reel-poster.png'), 960, 540, {
    at: 2.95 * 1000,
    scale: 2,
  });
  report.push(
    `reel: gif ${size} bytes (200 frames at ${GIF_FPS} fps), mp4 ${statSync(path.join(out, 'reel.mp4')).size}, webm ${statSync(path.join(out, 'reel.webm')).size}, ${n} source frames at ${FPS} fps, scenes at ${AT.join(', ')} s`,
  );
  rm(dir);
}

await browser.close();
rm(tmp);
writeFileSync(path.join(out, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
