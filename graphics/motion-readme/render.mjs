// README motion set: banner, stats, reel (20 s, five scenes), how it works, measured results chart, footer.
// Each is rendered at 30 fps; the GIF is resampled to its own fps and an MP4 and WebM are written beside it.
// Usage: node graphics/motion-readme/render.mjs <outDir> (CI only, see graphics.yml).
// Every number below is quoted from docs/GATES.md and docs/evidence/; simulated things are labelled.
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
import { introBody, outroBody } from '../lib/scenes.mjs';

const out = path.resolve(process.argv[2] ?? 'out/motion-readme');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const report = [];
const browser = await openBrowser();

const FPS = 30;
async function make(name, themeName, { w, h, gifFps, secs, body, css = '', limit, width, poster }) {
  const base = themeName === 'dark' ? `${name}-dark` : name;
  const file = writePage(path.join(tmp, `${base}.html`), { theme: themeName, w, h, body, css });
  const dir = path.join(tmp, base);
  await frames(browser, file, dir, w, h, FPS, secs);
  const n = frameCount(dir);
  const size = fitGif(dir, path.join(out, `${base}.gif`), {
    inFps: FPS,
    outFps: gifFps,
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
    `${base}: gif ${size} bytes (${secs * gifFps} frames at ${gifFps} fps), mp4 ${sz('mp4')}, webm ${sz('webm')}, ${n} source frames at ${FPS} fps, ${w}x${h}`,
  );
  rm(dir);
}

/* ---- banner: 1280x400, the logo assembles and strikes, a round shockwave behind a simulated bid ladder ---- */
const bannerBody = (th) => `
${[0, 0.62, 1.25, 1.88].map((d) => `<div class="ring" style="--d:${d}s;left:730px;top:-70px;width:540px;height:540px"></div>`).join('')}
<div class="abs" style="left:60px;top:44px;width:640px">${logoSvg({ variant: th.variant, start: 0.1 })}</div>
<div class="abs disp rise" style="--d:2.9s;left:60px;top:262px;font-size:50px;white-space:nowrap">Every bid is a PayPal hold. <span class="or">Only the winner pays.</span></div>
<div class="abs lab rise" style="--d:3.4s;left:62px;top:326px;font-size:15px">PayPal sandbox only &nbsp;/&nbsp; Bids are held, not charged &nbsp;/&nbsp; Hash-chained receipts</div>
<div class="abs card pop" style="--d:1.6s;left:880px;top:54px;width:330px;padding:16px 20px">
  <div style="display:flex;justify-content:space-between"><span class="lab" style="font-size:12px">Current price</span><span class="tag sim">Simulated</span></div>
  <div class="disp" style="font-size:112px;margin-top:6px"><span data-ladder="2.4:$15,3.1:$20,3.8:$25" data-init="$10">$10</span></div>
  <div class="lab" style="font-size:11px;margin-top:6px">Each bid is held on PayPal, not charged</div>
</div>
<div class="abs" style="left:0;bottom:0">${rule(1280, 3.9, 8)}</div>`;
for (const t of ['paper', 'dark'])
  await make('readme-banner', t, {
    w: 1280,
    h: 400,
    gifFps: 15,
    secs: 5,
    body: bannerBody(THEMES[t]),
    limit: 600 * 1024,
  });

/* ---- stats: five tiles, numbers count up with an ease ---- */
const tile = (i, label, val, sub, tag, tagCls) => `
<div class="abs card pop" style="--d:${0.15 + i * 0.12}s;left:${14 + i * 314}px;top:12px;width:296px;height:232px;padding:16px 18px">
  <div class="lab" style="font-size:12px;min-height:34px">${label}</div>
  <div class="disp" style="font-size:82px;margin-top:6px;white-space:nowrap">${val}</div>
  <div style="font:600 13.5px var(--body);color:var(--muted);margin-top:8px;min-height:36px;line-height:1.3">${sub}</div>
  <div style="margin-top:8px"><span class="tag ${tagCls}">${tag}</span></div>
</div>`;
const cnt = (i, to, dec, suf) =>
  `<span data-count="${to}" data-from="0" data-start="${0.5 + i * 0.12}" data-dur="1.4" data-dec="${dec}" data-suf="${suf}">0</span>`;
const statsBody = `
${tile(0, 'Hammer to settled, p95', cnt(0, 5.59, 2, "<small style='font-size:40px'> s</small>"), 'Target 6 s. 20 runs, 6 holds each, real PayPal sandbox.', 'Measured, met', 'ok')}
${tile(1, 'Webhook handler, p95, hosted', cnt(1, 112, 0, "<small style='font-size:40px'> ms</small>"), 'Target 300 ms. 50 requests to the hosted route.', 'Measured, met', 'ok')}
${tile(2, 'Hammer to captured, p95', cnt(2, 3.01, 2, "<small style='font-size:40px'> s</small>"), 'Target 2.5 s. We missed it, and say so.', 'Measured, missed', 'no')}
${tile(3, 'Server killed mid-capture', cnt(3, 0, 0, "<small style='font-size:40px'> diffs</small>"), 'Journal equals PayPal: one capture, two holds voided. CI runner.', 'Measured, pass', 'ok')}
${tile(4, 'Voice bids (gate G5)', cnt(4, 24, 0, "<small style='font-size:40px'> clips</small>"), 'Synthetic audio, scored in sample. No noisy-room run yet.', 'Partial', 'part')}`;
for (const t of ['paper', 'dark'])
  await make('readme-stats', t, {
    w: 1600,
    h: 256,
    gifFps: 15,
    secs: 4,
    body: statsBody,
    limit: 400 * 1024,
    poster: 3.8,
  });

/* ---- measured results chart ---- */
const bar = (i, label, s, target, ok) => {
  const px = 100; // pixels per second
  const y = 150 + i * 150;
  const col = ok ? 'var(--green)' : 'var(--red)';
  return `
<div class="abs disp rise" style="--d:${0.3 + i * 0.5}s;left:40px;top:${y}px;width:270px;font-size:40px;line-height:1">${label}</div>
<div class="abs" style="left:330px;top:${y}px;width:${7 * px}px;height:64px;border-left:3px solid var(--ink)"></div>
<div class="abs grow" style="--d:${0.6 + i * 0.5}s;--len:1.6s;left:333px;top:${y + 8}px;width:${s * px}px;height:48px;background:${col}"></div>
<div class="abs" style="left:${333 + target * px}px;top:${y - 18}px;height:100px;border-left:4px dashed var(--ink)"></div>
<div class="abs lab" style="left:${333 + target * px - 38}px;top:${y + 84}px;font-size:13px;color:var(--ink)">target ${target} s</div>
<div class="abs disp" style="left:${333 + s * px + 14}px;top:${y + 6}px;font-size:44px"><span data-count="${s}" data-from="0" data-start="${0.6 + i * 0.5}" data-dur="1.6" data-dec="2" data-suf=" s">0</span></div>
<div class="abs rise" style="--d:${2.4 + i * 0.4}s;left:${333 + 5.2 * px}px;top:${y + 74}px"><span class="tag ${ok ? 'ok' : 'no'}">${ok ? 'Met' : 'Missed'}</span></div>`;
};
const resultsBody = `
<div class="abs lab" style="left:40px;top:34px;font-size:15px">Measured on the real PayPal sandbox, 20 runs, 6 holds each</div>
<div class="abs disp wipe" style="--d:.1s;left:40px;top:62px;font-size:58px">Hammer latency, <span class="or">p95</span></div>
${bar(0, 'Hammer to settled', 5.59, 6, true)}
${bar(1, 'Hammer to captured', 3.01, 2.5, false)}
<div class="abs lab rise" style="--d:3.4s;left:40px;top:456px;font-size:13px;line-height:1.5;width:900px">Source: docs/GATES.md, latency targets, run 42346811713 (measure-sandbox). Dashed line is the target. We met one target and missed the other.</div>`;
for (const t of ['paper', 'dark'])
  await make('results-latency', t, {
    w: 1000,
    h: 500,
    gifFps: 15,
    secs: 5,
    body: resultsBody,
    limit: 500 * 1024,
    poster: 4.9,
  });

/* ---- how it works: a token hops along five steps ---- */
const STEPS = [
  ['1', 'Hold', 'The bidder approves a PayPal hold as a ceiling. Held, not charged.'],
  ['2', 'Bid', 'Each bid is checked against that hold.'],
  ['3', 'Hammer', 'The highest valid bid wins when the hammer falls.'],
  ['4', 'Capture and void', 'The winner pays the hammer price. Every other hold is released.'],
  ['5', 'Receipt', 'The result is in the hash-chained ledger and anyone can verify it.'],
];
const HOP = 1.7;
const T0 = 0.5;
function tokenKeyframes() {
  const total = 10;
  const pct = (s) => ((s / total) * 100).toFixed(3);
  let k = '';
  STEPS.forEach((_, i) => {
    const at = T0 + i * HOP;
    k += `${pct(Math.max(0, at - 0.01))}%{transform:translateX(${i * 232}px)}`;
    if (i < STEPS.length - 1)
      k += `${pct(at + HOP - 0.6)}%{transform:translateX(${i * 232}px);animation-timing-function:cubic-bezier(.6,0,.2,1)}`;
  });
  k += `100%{transform:translateX(${(STEPS.length - 1) * 232}px)}`;
  return `@keyframes gv-hop{0%{transform:translateX(0)}${k}}`;
}
const howBody = `
<div class="abs lab" style="left:40px;top:28px;font-size:15px">How one lot runs (simulated example)</div>
<div class="abs disp wipe" style="--d:.1s;left:40px;top:54px;font-size:60px">Hold. Bid. Hammer. <span class="or">Receipt.</span></div>
<div class="abs" style="left:40px;top:204px;width:1120px;border-top:3px solid var(--ink)"></div>
${STEPS.map(
  (s, i) => `
<div class="abs card pop" style="--d:${T0 + i * HOP}s;left:${40 + i * 232}px;top:232px;width:208px;height:226px;padding:14px 16px">
  <div class="disp or" style="font-size:54px">${s[0]}</div>
  <div class="disp" style="font-size:36px;margin-top:2px">${s[1]}</div>
  <div style="font:600 14.5px var(--body);color:var(--muted);margin-top:8px;line-height:1.35">${s[2]}</div>
</div>`,
).join('')}
<div class="abs" style="left:40px;top:188px;width:34px;height:34px;background:var(--orange);border:3px solid var(--ink);animation:gv-hop 10s linear 0s infinite"></div>
<div class="abs lab rise" style="--d:${T0 + 4 * HOP + 0.6}s;left:40px;top:480px;font-size:13px">PayPal sandbox only. No real money moves.</div>`;
const HOW_CSS = tokenKeyframes();
for (const t of ['paper', 'dark'])
  await make('how-it-works', t, {
    w: 1240,
    h: 520,
    gifFps: 12,
    secs: 10,
    body: howBody,
    css: HOW_CSS,
    limit: 1000 * 1024,
    poster: 9.9,
  });

/* ---- footer: compact outro with links ---- */
const link = (i, k, u) => `
<div class="abs rise" style="--d:${2.3 + i * 0.25}s;left:700px;top:${58 + i * 62}px;width:480px;display:flex;align-items:baseline;gap:18px;border-top:2px solid var(--ink);padding-top:8px">
<span class="lab" style="width:78px;font-size:12px">${k}</span><span class="disp" style="font-size:30px">${u}</span></div>`;
const footBody = (th) => `
<div class="abs" style="left:40px;top:50px;width:600px">${logoSvg({ variant: th.variant, start: 0.1 })}</div>
${link(0, 'Web app', 'gavel.dualmindlab.tech')}${link(1, 'Docs', 'docs.gavel.dualmindlab.tech')}${link(2, 'Source', 'github.com/harshbhx/gavel-auction')}
<div class="abs lab rise" style="--d:3.4s;left:700px;top:252px;font-size:12px">PayPal sandbox only. Bids are held, not charged.</div>
<div class="abs" style="left:0;bottom:0">${rule(1240, 3.6, 8)}</div>`;
for (const t of ['paper', 'dark'])
  await make('readme-footer', t, {
    w: 1240,
    h: 300,
    gifFps: 15,
    secs: 5,
    body: footBody(THEMES[t]),
    limit: 600 * 1024,
  });

/* ---- reel: 20 s, five scenes, 960x540 ---- */
{
  const th = THEMES.paper;
  const L = [4.4, 3.8, 3.8, 3.8, 4.2];
  const AT = L.reduce((a, l, i) => (a.push(i ? a[i - 1] + L[i - 1] : 0), a), []);
  const d = (s, x) => `${(AT[s] + x).toFixed(2)}s`;
  const scn = (s, inner) => `<div class="scn" style="--at:${AT[s]}s;--len:${L[s]}s">${inner}</div>`;
  const small = (html) =>
    `<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(.5);transform-origin:0 0">${html}</div>`;
  const title = (s, a, b) =>
    `<div class="abs disp wipe" style="--d:${d(s, 0.15)};left:44px;top:70px;font-size:84px;width:470px">${a}<br><span class="or">${b}</span></div>`;
  const s1 = `
${title(1, 'A bid is', 'a hold.')}
<div class="abs rise" style="--d:${d(1, 0.9)};left:46px;top:290px;width:400px;font:600 19px var(--body);line-height:1.4;color:var(--muted)">The bidder approves a PayPal hold as a ceiling. It is held, not charged.</div>
<div class="abs card slam" style="--d:${d(1, 0.4)};left:530px;top:70px;width:380px;height:370px;padding:18px 22px">
  <div style="display:flex;justify-content:space-between"><span class="lab">Paddle 2</span><span class="tag sim">Simulated</span></div>
  <div class="lab" style="margin-top:14px">Hold on PayPal</div>
  <div class="disp" style="font-size:60px">$20.00</div>
  <div style="height:14px;border:2px solid var(--ink);margin-top:6px"><div class="grow" style="--d:${d(1, 0.9)};--len:.8s;--n:8;height:100%;background:var(--orange)"></div></div>
  <div class="lab" style="margin-top:20px">Current price</div>
  <div class="disp" style="font-size:96px"><span data-ladder="${AT[1] + 1.9}:$15.00" data-init="$10.00">$10.00</span></div>
  <div style="display:flex;gap:10px;margin-top:10px">
    <span class="tag pop" style="--d:${d(1, 1.3)}">Bid $10</span><span class="tag pop" style="--d:${d(1, 2)}">Bid $15</span>
    <span class="tag ok pop" style="--d:${d(1, 3)}">Held, not charged</span></div>
</div>`;
  const s2 = `
${title(2, 'The hammer', 'settles it.')}
<div class="abs card slam" style="--d:${d(2, 0.9)};left:500px;top:70px;width:420px;padding:22px;background:var(--green);border-color:var(--ink)">
  <div class="disp" style="font-size:50px;color:#fff;line-height:.98;white-space:nowrap">Sold to paddle 2<br>for $15.00</div></div>
<div class="abs card pop" style="--d:${d(2, 1.8)};left:500px;top:250px;width:420px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center"><span class="disp" style="font-size:34px">Paddle 2</span><span class="tag ok">Captured $15.00</span></div>
<div class="abs card pop" style="--d:${d(2, 2.3)};left:500px;top:340px;width:420px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center"><span class="disp" style="font-size:34px">Paddle 1</span><span class="tag part">Hold released</span></div>
<div class="abs rise" style="--d:${d(2, 2.9)};left:500px;top:440px"><span class="tag sim">Simulated lot, PayPal sandbox</span></div>
<div class="abs rise" style="--d:${d(2, 1)};left:46px;top:290px;width:400px;font:600 19px var(--body);line-height:1.4;color:var(--muted)">Only the winner pays the hammer price. Every other hold is released.</div>`;
  // hash-chain links snap together, then the receipt drops
  const blocks = [16, 17, 18, 19]
    .map(
      (n, i) => `
<div class="abs card ${i < 2 ? 'snapl' : 'snapr'}" style="--d:${d(3, 0.7 + i * 0.12)};left:${500 + i * 108}px;top:90px;width:92px;height:84px;padding:10px 12px;box-shadow:5px 5px 0 var(--shadow)"><div class="lab" style="font-size:11px">Entry</div><div class="disp" style="font-size:44px">${n}</div></div>
${i < 3 ? `<div class="abs grow" style="--d:${d(3, 1.35 + i * 0.12)};--len:.3s;left:${592 + i * 108}px;top:128px;width:16px;height:8px;background:var(--orange)"></div>` : ''}`,
    )
    .join('');
  const s3 = `
${title(3, 'Check it', 'yourself.')}
<div class="abs rise" style="--d:${d(3, 1)};left:46px;top:290px;width:420px;font:600 19px var(--body);line-height:1.4;color:var(--muted)">Every step is appended to a hash-chained ledger. Anyone can check the chain from the export.</div>
${blocks}
<div class="abs card slam" style="--d:${d(3, 2.1)};left:500px;top:210px;width:420px;padding:16px 20px"><div style="display:flex;justify-content:space-between"><span class="lab">Receipt</span><span class="tag ok">Chain verifies</span></div><div class="disp" style="font-size:46px;margin-top:8px">19 entries, 0 differences</div><div class="lab" style="font-size:11px;margin-top:6px;line-height:1.5">Measured: server killed mid-capture, CI runner, real PayPal sandbox</div></div>`;
  const cur = (i) => `<div class="cur" style="--at:${(AT[i] - 0.3).toFixed(2)}s"></div>`;
  const body = `${scn(0, small(introBody(th, 0)))}${scn(1, s1)}${scn(2, s2)}${scn(3, s3)}${scn(4, small(outroBody(th, AT[4])))}${cur(1)}${cur(2)}${cur(3)}${cur(4)}`;
  const REEL_CSS =
    '.snapl{animation:gv-snapl .6s cubic-bezier(.2,.8,.2,1) var(--d,0s) backwards}.snapr{animation:gv-snapr .6s cubic-bezier(.2,.8,.2,1) var(--d,0s) backwards}@keyframes gv-snapl{from{opacity:0;transform:translateX(-90px)}}@keyframes gv-snapr{from{opacity:0;transform:translateX(90px)}}';
  const file = writePage(path.join(tmp, 'reel.html'), {
    theme: 'paper',
    w: 960,
    h: 540,
    body,
    css: REEL_CSS,
  });
  const dir = path.join(tmp, 'reel');
  await frames(browser, file, dir, 960, 540, FPS, 20);
  const n = frameCount(dir);
  const size = fitGif(dir, path.join(out, 'reel.gif'), {
    inFps: FPS,
    outFps: 12,
    width: 960,
    limit: 2.4 * 1024 * 1024,
  });
  mp4v(dir, path.join(out, 'reel.mp4'), FPS);
  webm(dir, path.join(out, 'reel.webm'), FPS);
  await still(browser, file, path.join(out, 'reel-poster.png'), 960, 540, {
    at: 4.3 * 1000,
    scale: 2,
  });
  report.push(
    `reel: gif ${size} bytes (240 frames at 12 fps), mp4 ${statSync(path.join(out, 'reel.mp4')).size}, webm ${statSync(path.join(out, 'reel.webm')).size}, ${n} source frames at ${FPS} fps, scenes at ${AT.join(', ')} s`,
  );
  rm(dir);
}

await browser.close();
rm(tmp);
writeFileSync(path.join(out, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
