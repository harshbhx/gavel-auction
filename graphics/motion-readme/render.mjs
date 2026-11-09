// README motion set: banner, stats, how it works, footer and a 10 s reel. Designed like a printed auction
// broadside: flat paper, black ink, one orange accent, hairline rules that draw themselves, huge type that
// reveals through a mask, asymmetric grid, empty paper. No cards, chips, glows or shadows. Motion from
// frame 0, loops of 4 to 10 s, GIFs at 20 fps.
// Usage: node graphics/motion-readme/render.mjs <outDir> (CI only, see graphics.yml).
// Each is rendered at 30 fps; the GIF is resampled to 20 fps and an MP4 and WebM are written beside it.
// Every number is quoted from docs/GATES.md and docs/evidence/; simulated things are labelled.
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { openBrowser, frames, still } from '../lib/render.mjs';
import { THEMES, writePage, fitGif, frameCount, rm, logoSvg, mp4v, webm } from '../lib/motion.mjs';
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

const rev = (d, inner, style = '', len = '.8s') =>
  `<div class="rev abs" style="--d:${d}s;--len:${len};${style}"><div>${inner}</div></div>`;
const hr = (d, left, top, width, len = '.9s', h = 2) =>
  `<div class="abs hr" style="--d:${d}s;--len:${len};left:${left}px;top:${top}px;width:${width}px;height:${h}px"></div>`;
const vr = (d, left, top, height, len = '.9s') =>
  `<div class="abs vr" style="--d:${d}s;--len:${len};left:${left}px;top:${top}px;width:2px;height:${height}px"></div>`;
const cap = (d, style, html) =>
  `<div class="abs cap fade" style="--d:${d}s;${style}">${html}</div>`;
const DISP = 'font-family:var(--display);font-weight:800;text-transform:uppercase;';

/* ---- banner: the logo large on the left, the tagline set tall on the right, empty paper between ---- */
const bannerBody = (th) => `
${cap(0.1, 'left:56px;top:20px', 'Lot 01 &nbsp; Gavel')}${cap(0.1, 'right:56px;top:20px', 'PayPal sandbox only')}
${hr(0.05, 56, 50, 1168, '1s')}
<div class="abs" style="left:26px;top:74px;width:700px">${logoSvg({ variant: th.variant, start: 0 })}</div>
${vr(1.5, 770, 84, 250)}
${rev(1.65, 'Every bid is<br>a PayPal hold.', `left:800px;top:84px;font-size:60px;line-height:.92;white-space:nowrap;${DISP}`)}
${rev(1.85, 'Only the<br>winner pays.', `left:800px;top:214px;font-size:60px;line-height:.92;white-space:nowrap;${DISP}color:var(--orange);`)}
${hr(2, 56, 352, 1168, '.8s')}
${cap(2.2, 'left:56px;top:366px', 'Hold &nbsp;/&nbsp; Bid &nbsp;/&nbsp; Hammer &nbsp;/&nbsp; Receipt')}`;
for (const t of ['paper', 'dark'])
  await make('readme-banner', t, {
    w: 1280,
    h: 400,
    secs: 4,
    body: bannerBody(THEMES[t]),
    limit: 500 * 1024,
  });

/* ---- stats: huge numerals set in type, no tiles ---- */
const num = (i, label, to, unit, sub, color = '') => `
${vr(0.1 + i * 0.12, 40 + i * 420, 56, 330)}
${cap(0.1 + i * 0.12, `left:${64 + i * 420}px;top:66px`, label)}
<div class="abs disp" style="left:${60 + i * 420}px;top:110px;font-size:240px;white-space:nowrap;${color}"><span data-count="${to}" data-from="0" data-start="${0.15 + i * 0.12}" data-dur="1.1" data-dec="0" data-suf="<small style='font-size:54px;letter-spacing:.01em'> ${unit}</small>">0</span></div>
${rev(1 + i * 0.12, sub, `left:${64 + i * 420}px;top:366px;font:600 19px var(--body);text-transform:none;line-height:1.3;width:360px`, '.6s')}`;
const statsBody = `
${hr(0, 40, 40, 1200, '1s')}
${cap(0.05, 'left:40px;top:12px', 'Built and proven')}${cap(0.05, 'right:40px;top:12px', 'PayPal sandbox only')}
${num(0, 'Live voice, 24 synthetic clips', 24, '/ 24', 'answered, with confirm before every bid')}
${num(1, 'Server killed mid-capture', 0, 'diffs', 'journal equals PayPal', 'color:var(--orange);')}
${num(2, 'Hash-chained ledger', 19, 'entries', 'the chain verifies')}
${hr(1.2, 40, 410, 1200, '.8s')}`;
for (const t of ['paper', 'dark'])
  await make('readme-stats', t, {
    w: 1280,
    h: 440,
    secs: 4,
    body: statsBody,
    limit: 300 * 1024,
    poster: 3.8,
  });

/* ---- how it works: four ledger lines ---- */
const STEPS = [
  ['01', 'Hold', 'A PayPal hold sets the ceiling. Held, not charged.'],
  ['02', 'Bid', 'Every bid is checked against that hold.'],
  ['03', 'Hammer', 'The highest valid bid wins.'],
  ['04', 'Receipt', 'The winner pays. Every other hold is released.'],
];
const howBody = `
${STEPS.map(
  (s, i) => `
${hr(0.1 + i * 0.5, 56, 30 + i * 100, 1128, '.9s')}
${cap(0.25 + i * 0.5, `left:56px;top:${58 + i * 100}px`, 'Lot ' + s[0])}
${rev(0.2 + i * 0.5, s[1], `left:200px;top:${38 + i * 100}px;font-size:92px;line-height:1;${DISP}${i === 2 ? 'color:var(--orange);' : ''}`)}
${rev(0.45 + i * 0.5, s[2], `left:700px;top:${62 + i * 100}px;font:500 21px var(--body);line-height:1.3;width:480px`, '.6s')}`,
).join('')}
${hr(2.3, 56, 430, 1128, '.8s')}`;
for (const t of ['paper', 'dark'])
  await make('how-it-works', t, {
    w: 1240,
    h: 460,
    secs: 5,
    body: howBody,
    limit: 300 * 1024,
    poster: 4.9,
  });

/* ---- footer: logo and the links as ledger lines ---- */
const link = (i, k, u) => `
${hr(1.2 + i * 0.16, 690, 52 + i * 70, 500, '.6s')}
${cap(1.35 + i * 0.16, `left:690px;top:${72 + i * 70}px;font-size:12px`, k)}
${rev(1.3 + i * 0.16, u, `left:780px;top:${62 + i * 70}px;font-size:30px;line-height:1;white-space:nowrap;${DISP}`, '.6s')}`;
const footBody = (th) => `
<div class="abs" style="left:10px;top:30px;width:620px">${logoSvg({ variant: th.variant, start: 0 })}</div>
${vr(1.1, 650, 40, 230)}
${link(0, 'Web app', 'gavel.dualmindlab.tech')}${link(1, 'Docs', 'docs.gavel.dualmindlab.tech')}${link(2, 'Source', 'github.com/harshbhx/gavel-auction')}
${hr(2, 690, 262, 500, '.6s')}
${cap(2.1, 'left:690px;top:268px;font-size:12px', 'PayPal sandbox only. Bids are held, not charged.')}`;
for (const t of ['paper', 'dark'])
  await make('readme-footer', t, {
    w: 1240,
    h: 300,
    secs: 4,
    body: footBody(THEMES[t]),
    limit: 400 * 1024,
  });

/* ---- reel: 10 s, five scenes, 960x540 ---- */
{
  const th = THEMES.paper;
  const L = [3.1, 1.8, 1.8, 1.9, 1.4];
  const AT = L.reduce((a, l, i) => (a.push(i ? a[i - 1] + L[i - 1] : 0), a), []);
  const t = (s, x) => (AT[s] + x).toFixed(2);
  const scn = (s, inner) => `<div class="scn" style="--at:${AT[s]}s;--len:${L[s]}s">${inner}</div>`;
  const small = (html) =>
    `<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(.5);transform-origin:0 0">${html}</div>`;
  const head = (s, lot) =>
    `${hr(t(s, 0), 48, 48, 864, '.5s')}${cap(t(s, 0.05), 'left:48px;top:20px', lot)}${cap(t(s, 0.05), 'right:48px;top:20px', 'PayPal sandbox only')}`;
  // 1: a bid is a hold, the price climbs the ladder
  const ladder = [
    ['10', 'paddle 4', 0.1],
    ['15', 'paddle 2', 0.6],
    ['20', 'paddle 2', 1.1],
  ];
  const s1 = `
${head(1, 'Lot 14 &nbsp; Simulated')}
${rev(t(1, 0.05), 'A bid is<br>a hold.', `left:48px;top:96px;font-size:100px;line-height:.9;${DISP}`, '.6s')}
${rev(t(1, 0.35), 'Held on PayPal. Not charged.', 'left:50px;top:300px;font:600 21px var(--body)', '.5s')}
<div class="abs disp or" style="left:410px;top:44px;font-size:430px;line-height:1;white-space:nowrap;letter-spacing:-.01em"><span data-ladder="${t(1, 0.1)}:$10,${t(1, 0.6)}:$15,${t(1, 1.1)}:$20" data-init="$10">$10</span></div>
${ladder.map((l, i) => `<div class="abs fade" style="--d:${t(1, l[2])}s;left:48px;top:${392 + i * 30}px;width:330px;display:flex;justify-content:space-between;font:600 16px var(--body);border-top:1px solid var(--ink);padding-top:5px"><span>$${l[0]}</span><span class="cap" style="font-size:12px">${l[1]}</span></div>`).join('')}`;
  // 2: the hammer falls
  const s2 = `
${head(2, 'Lot 14 &nbsp; Simulated')}
<div class="ringl" style="--d:${t(2, 0.55)}s;left:30px;top:130px;width:900px;height:900px;margin-top:-100px"></div>
<div class="abs shk" style="--d:${t(2, 0.55)}s;left:0;top:0;width:960px;height:540px">
  <div class="rev abs" style="left:40px;top:70px;width:900px;height:380px"><div class="drop disp or" style="--d:${t(2, 0.1)}s;font-size:440px;line-height:.92;white-space:nowrap">Sold.</div></div>
  ${hr(t(2, 0.7), 48, 458, 864, '.5s')}
  ${rev(t(2, 0.85), 'Paddle 2 &nbsp; $20.00 &nbsp; The winner is captured. Every other hold is released.', 'left:48px;top:470px;font:600 20px var(--body);white-space:nowrap', '.5s')}
</div>`;
  // 3: hash-chain links snap together into a receipt
  const link = (i) => {
    const x = 48 + i * 112;
    const from = i < 2 ? -140 : 140;
    return `<g style="animation:gv-lk .55s cubic-bezier(.5,0,.1,1) ${t(3, 0.05 + i * 0.07)}s backwards;--f:${from}px"><rect x="${x}" y="110" width="150" height="76" rx="38" fill="none" stroke="var(--ink)" stroke-width="4"/></g>`;
  };
  const s3 = `
${head(3, 'Lot 14 &nbsp; Receipt')}
<svg class="abs" style="left:0;top:0" width="960" height="540">${[0, 1, 2, 3].map(link).join('')}</svg>
${rev(t(3, 0.7), '19 entries.<br>0 differences.', `left:48px;top:230px;font-size:110px;line-height:.9;${DISP}`, '.6s')}
${hr(t(3, 1.1), 48, 452, 864, '.5s')}
${cap(t(3, 1.2), 'left:48px;top:466px', 'The chain verifies. Measured with a real server process killed mid-capture')}`;
  // 4: links
  const lk = (i, k, u) => `
${hr(t(4, 0.2 + i * 0.1), 48, 300 + i * 66, 864, '.5s')}
${cap(t(4, 0.3 + i * 0.1), `left:48px;top:${322 + i * 66}px;font-size:12px`, k)}
${rev(t(4, 0.25 + i * 0.1), u, `left:190px;top:${308 + i * 66}px;font-size:44px;line-height:1;white-space:nowrap;${DISP}`, '.5s')}`;
  const s4 = `
<div class="abs" style="left:20px;top:50px;width:560px">${logoSvg({ variant: th.variant, still: true })}</div>
${lk(0, 'Web app', 'gavel.dualmindlab.tech')}${lk(1, 'Docs', 'docs.gavel.dualmindlab.tech')}${lk(2, 'Source', 'github.com/harshbhx/gavel-auction')}`;
  const cur = (i) =>
    `<div class="cur" style="--at:${(AT[i] - 0.2).toFixed(2)}s;animation-duration:.45s"></div>`;
  const body = `${scn(0, small(introBody(th, 0)))}${scn(1, s1)}${scn(2, s2)}${scn(3, s3)}${scn(4, s4)}${cur(1)}${cur(2)}${cur(3)}${cur(4)}`;
  const REEL_CSS = '@keyframes gv-lk{from{transform:translateX(var(--f))}}';
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
