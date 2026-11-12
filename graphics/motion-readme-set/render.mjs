// README header set: banner, flow, stats, partners and footer GIFs plus a same-name PNG poster each.
// Paper #EFE6D3, ink #1D1712, signal orange #FF6A13; Big Shoulders Display and JetBrains Mono (the app fonts).
// No URLs and no names inside the pixels. Every figure is quoted from the README facts; the auction in
// flow.gif is labelled simulated. Rendered at 20 fps, loops forever, the last frame is a complete still.
// Usage: node graphics/motion-readme-set/render.mjs <outDir> (CI only, see graphics.yml).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBrowser, frames, still } from '../lib/render.mjs';
import { THEMES, writePage, fitGif, rm, logoSvg, root } from '../lib/motion.mjs';

const out = path.resolve(process.argv[2] ?? 'out/motion-readme-set');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const report = [];
const browser = await openBrowser();
const FPS = 20;
const ORANGE = '#ff6a13';
const paper = { ...THEMES.paper, orange: ORANGE };
THEMES.paper = paper;

const CSS = `
.mono{font:600 13px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.m14{font:500 14px var(--mono);line-height:1.45;color:var(--ink)}
.D{font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:1}
@keyframes gv-rel{to{opacity:.3}}
.rg{stroke-dasharray:1;animation:gv-draw .6s cubic-bezier(.55,0,.2,1) var(--d,0s) backwards}
.rel{animation:gv-rel .5s ease var(--r,0s) forwards}
`;
// Counter with thousands separators. Elements: data-to, data-start, data-dur (s), data-pre, data-suf.
const JS = `
window.__seek=function(ms){
  document.querySelectorAll('[data-to]').forEach(function(el){
    var to=parseFloat(el.dataset.to),st=parseFloat(el.dataset.start)*1000,du=parseFloat(el.dataset.dur)*1000;
    var p=Math.min(1,Math.max(0,(ms-st)/du));p=1-Math.pow(1-p,3);
    el.innerHTML=(el.dataset.pre||'')+Math.round(to*p).toLocaleString('en-US')+(el.dataset.suf||'');
    el.style.visibility=ms<st-1?'hidden':'visible';
  });
};`;

async function make(name, { w, h, secs, body, limit, css = '' }) {
  const file = writePage(path.join(tmp, `${name}.html`), {
    theme: 'paper',
    w,
    h,
    body,
    css: CSS + css,
    js: JS,
  });
  const dir = path.join(tmp, name);
  await frames(browser, file, dir, w, h, FPS, secs);
  const size = fitGif(dir, path.join(out, `${name}.gif`), {
    inFps: FPS,
    outFps: FPS,
    width: w,
    limit,
    ladder: [
      [256, 0],
      [128, 20],
      [96, 40],
      [64, 80],
      [48, 120],
    ],
  });
  await still(browser, file, path.join(out, `${name}.png`), w, h, { at: (secs - 0.05) * 1000 });
  report.push(`${name}: gif ${size} bytes, ${secs * FPS} frames at ${FPS} fps, ${w}x${h}`);
  rm(dir);
}

const rev = (d, inner, style = '', len = '.7s') =>
  `<div class="rev abs" style="--d:${d}s;--len:${len};${style}"><div>${inner}</div></div>`;
const hr = (d, left, top, width, len = '.8s', h = 2, col = '') =>
  `<div class="abs hr" style="--d:${d}s;--len:${len};left:${left}px;top:${top}px;width:${width}px;height:${h}px;${col}"></div>`;
const vr = (d, left, top, height) =>
  `<div class="abs vr" style="--d:${d}s;--len:.7s;left:${left}px;top:${top}px;width:2px;height:${height}px"></div>`;
const mono = (d, style, html) =>
  `<div class="abs mono fade" style="--d:${d}s;${style}">${html}</div>`;

/* ---------- banner 1280x320, 5 s ---------- */
await make('banner', {
  w: 1280,
  h: 320,
  secs: 5,
  limit: 1100 * 1024,
  body: `
${hr(0.05, 56, 44, 1168, '.9s')}
${mono(0.1, 'left:56px;top:16px', 'Gavel')}${mono(0.1, 'right:56px;top:16px', 'PayPal sandbox only')}
<div class="abs" style="left:56px;top:66px;width:610px">${logoSvg({ variant: 'color', start: 0.15 })}</div>
${vr(1.9, 716, 76, 170)}
${rev(2.1, 'Every bid is a hold.', 'left:744px;top:92px;font-size:44px;white-space:nowrap;font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:1.05')}
${rev(2.45, 'The hammer is the payment.', 'left:744px;top:150px;font-size:44px;white-space:nowrap;font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:1.05;color:var(--orange)')}
${hr(2.9, 56, 276, 1168, '.8s')}
${mono(3.1, 'left:56px;top:288px', 'Hold &nbsp;/&nbsp; Bid &nbsp;/&nbsp; Hammer &nbsp;/&nbsp; Receipt')}`,
});

/* ---------- flow 1200x500, 9 s ---------- */
{
  const COL = (i) => 56 + i * 272;
  const TH = 4.8; // the hammer lands, the winner is captured, the rest released
  const step = (i, n, name, t) => `
${mono(t, `left:${COL(i)}px;top:34px`, 'Step ' + n)}
${rev(t + 0.05, name, `left:${COL(i)}px;top:52px;width:240px;height:62px;font-size:56px;font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:1.05;${i === 2 ? 'color:var(--orange);' : ''}`, '.6s')}
${hr(t + 0.1, COL(i), 124, 240, '.6s')}`;
  const cap = (i, t, html) =>
    `<div class="abs m14 fade" style="--d:${t}s;left:${COL(i)}px;top:352px;width:240px">${html}</div>`;
  const pad = (k, label, amt, t, win) => {
    const x = COL(0) + k * 90;
    return `
<svg class="abs" style="left:${x}px;top:150px" width="76" height="76" viewBox="0 0 76 76">
  <g class="${win ? '' : 'rel'}" style="--r:${TH}s">
    <circle cx="38" cy="38" r="30" fill="none" stroke="#1d1712" stroke-width="6" stroke-opacity=".14"/>
    <circle class="rg" pathLength="1" style="--d:${t}s" transform="rotate(-90 38 38)" cx="38" cy="38" r="30" fill="none" stroke="#1d1712" stroke-width="6"/>
  </g>
  ${win ? `<circle class="fade" style="--d:${TH}s" cx="38" cy="38" r="30" fill="${ORANGE}" stroke="${ORANGE}" stroke-width="6"/>` : ''}
</svg>
<div class="abs m14 fade" style="--d:${t + 0.3}s;left:${x}px;top:234px;width:80px;line-height:1.5">${label}<br>${amt}</div>
<div class="abs m14 fade" style="--d:${TH}s;left:${x}px;top:282px;width:84px;font-weight:700;${win ? 'color:var(--orange)' : 'color:var(--muted)'}">${win ? 'captured' : 'released'}</div>`;
  };
  const rrow = (k, l, r, t) => `
${hr(t, COL(3), 150 + k * 60, 240, '.5s', 2)}
<div class="abs fade" style="--d:${t + 0.1}s;left:${COL(3)}px;top:${166 + k * 60}px;width:240px;display:flex;justify-content:space-between;align-items:baseline">
  <span class="m14" style="font-weight:700">${l}</span>${r}</div>`;
  const body = `
${step(0, '01', 'Hold', 0.1)}${step(1, '02', 'Bid', 1.5)}${step(2, '03', 'Hammer', 3.4)}${step(3, '04', 'Receipt', 5.2)}
${pad(0, 'P1', '$40 hold', 0.5, false)}${pad(1, 'P2', '$60 hold', 0.75, true)}${pad(2, 'P3', '$50 hold', 1.0, false)}
${cap(0, 1.3, 'A PayPal hold sets each ceiling. Held, not charged.')}
<div class="abs D" style="left:${COL(1)}px;top:134px;font-size:150px;white-space:nowrap;visibility:hidden"><span data-to="35" data-start="1.9" data-dur="2.2" data-pre="$">$0</span></div>
${cap(1, 2.0, 'The price climbs. Every bid is checked against the hold.')}
<div class="abs" style="left:${COL(2) + 10}px;top:142px;width:190px">${logoSvg({ variant: 'color', kind: 'mark', start: 3.55 })}</div>
${cap(2, 3.9, 'The hammer strikes once. Only the winning price is captured.')}
${rrow(0, 'Paddle 2', `<span class="D" style="font-size:34px;color:var(--orange)">$35.00</span>`, 5.5)}
${rrow(1, 'Paddle 1', `<span class="m14" style="color:var(--muted)">hold released</span>`, 5.85)}
${rrow(2, 'Paddle 3', `<span class="m14" style="color:var(--muted)">hold released</span>`, 6.2)}
${hr(6.5, COL(3), 150 + 3 * 60, 240, '.5s', 2)}
${cap(3, 6.7, 'The winner pays. Every other hold is released.')}
${hr(0.2, 56, 436, 1088, '1s')}
${mono(0.4, 'left:56px;top:452px', 'Simulated auction')}${mono(0.4, 'right:56px;top:452px', 'PayPal sandbox only')}`;
  await make('flow', { w: 1200, h: 500, secs: 9, body, limit: 1150 * 1024 });
}

/* ---------- stats 1200x260, 5 s ---------- */
{
  const S = [
    { to: 4500, suf: '+', label: 'test cases in CI' },
    { to: 24, suf: '<small>/24</small>', label: 'synthetic voice clips on the live socket' },
    { to: 17, suf: '<small>/17</small>', label: 'judge steps' },
    { to: 100, suf: '', label: 'PageSpeed (landing page)', or: true },
    { to: 727, suf: '', label: 'merged pull requests (11 Nov 2026)' },
  ];
  const cell = (s, i) => {
    const x = 48 + i * 224;
    const t = 0.2 + i * 0.18;
    return `
${i ? vr(t, x - 14, 70, 160) : ''}
<div class="abs D" style="left:${x}px;top:92px;font-size:74px;white-space:nowrap;${s.or ? 'color:var(--orange);' : ''}"><span data-to="${s.to}" data-start="${t}" data-dur="1.5" data-suf="${s.suf.replace(/"/g, '&quot;')}">0</span></div>
<div class="abs m14 fade" style="--d:${t + 0.5}s;left:${x}px;top:182px;width:190px">${s.label}</div>`;
  };
  await make('stats', {
    w: 1200,
    h: 260,
    secs: 5,
    limit: 800 * 1024,
    css: '.D small{font-size:34px;letter-spacing:.01em}',
    body: `
${hr(0, 48, 52, 1104, '1s')}
${mono(0.05, 'left:48px;top:20px', 'Built and proven')}${mono(0.05, 'right:48px;top:20px', 'PayPal sandbox only')}
${S.map(cell).join('')}
${hr(1.4, 48, 236, 1104, '.8s')}`,
  });
}

/* ---------- partners 1200x200, 4.5 s ---------- */
{
  const pp = pathToFileURL(path.join(root, 'brand/partners/paypal-wordmark.svg')).href;
  const W = (t, name) =>
    `<div class="D fade" style="--d:${t}s;font-size:60px;text-transform:none;white-space:nowrap;letter-spacing:0">${name}</div>`;
  await make('partners', {
    w: 1200,
    h: 200,
    secs: 4.5,
    limit: 600 * 1024,
    body: `
${hr(0, 56, 44, 1088, '.9s')}
${mono(0.05, 'left:56px;top:16px', 'Built with')}${mono(0.05, 'right:56px;top:16px', 'Payments run in the PayPal sandbox')}
<div class="abs" style="left:56px;top:62px;width:1088px;height:84px;display:flex;justify-content:space-between;align-items:center">
  <img class="fade" style="--d:.4s;height:64px;width:auto" alt="PayPal" src="${pp}">
  ${W(0.8, 'Render')}${W(1.1, 'APIMatic')}${W(1.4, 'AG Grid')}${W(1.7, 'Cloudflare')}
</div>
${hr(2.2, 56, 164, 1088, '.8s')}
${mono(2.4, 'left:56px;top:174px', 'Names set in type. The PayPal wordmark is PayPal&#39;s own file')}`,
  });
}

/* ---------- footer 1200x160, 4 s ---------- */
{
  const seg = (t, s, or) =>
    `<span class="D fade" style="--d:${t}s;font-size:40px;white-space:nowrap;${or ? 'color:var(--orange)' : ''}">${s}</span>`;
  await make('footer', {
    w: 1200,
    h: 160,
    secs: 4,
    limit: 600 * 1024,
    body: `
${hr(0, 56, 26, 1088, '.9s')}
${hr(1.6, 56, 134, 1088, '.8s')}
<div class="abs" style="left:56px;top:40px;width:84px">${logoSvg({ variant: 'color', kind: 'mark', start: 0.1 })}</div>
<div class="abs" style="left:176px;top:62px;display:flex;gap:22px;align-items:center">
  ${seg(1.3, 'MIT licence')}${seg(1.4, '&middot;', true)}${seg(1.5, 'Built by two builders')}${seg(1.6, '&middot;', true)}${seg(1.7, 'PayPal sandbox only')}
</div>`,
  });
}

await browser.close();
rm(tmp);
writeFileSync(path.join(out, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
