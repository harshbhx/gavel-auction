// SVG builders for the README graphics. Pure string generation (no browser needed).
// The logo geometry is read from brand/svg/*.svg and never redrawn; only the colours differ per theme.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const brand = (f) => readFileSync(path.join(root, 'brand/svg', f), 'utf8');
const fontB64 = (f) =>
  readFileSync(path.join(root, 'packages/web/src/design/fonts', f)).toString('base64');

export const LIGHT = {
  name: 'light',
  bg: '#efe6d3',
  card: '#f8f2e4',
  ink: '#1d1712',
  muted: '#5a4d3f',
  rule: '#b8a888',
  orange: '#ff6a1f',
  shadow: '#1d1712',
  green: '#256b3a',
  onInk: '#efe6d3',
  logo: 'lockup-h-color.svg',
};
export const DARK = {
  name: 'dark',
  bg: '#1d1712',
  card: '#2a2218',
  ink: '#efe6d3',
  muted: '#b9ab94',
  rule: '#5a4d3a',
  orange: '#ff6a1f',
  shadow: '#000000',
  green: '#7fd08f',
  onInk: '#1d1712',
  logo: 'lockup-h-reversed.svg',
};

let fontCache;
export function fontCss() {
  fontCache ??= [
    ['Big Shoulders Display Variable', 'big-shoulders-display-latin-wght-normal.woff2'],
    ['Public Sans Variable', 'public-sans-latin-wght-normal.woff2'],
    ['JetBrains Mono Variable', 'jetbrains-mono-latin-wght-normal.woff2'],
  ]
    .map(
      ([n, f]) =>
        `@font-face{font-family:'${n}';font-weight:100 900;src:url(data:font/woff2;base64,${fontB64(f)}) format('woff2')}`,
    )
    .join('');
  return fontCache;
}

const DISPLAY = "'Big Shoulders Display Variable','Arial Narrow',sans-serif";
const BODY = "'Public Sans Variable',system-ui,sans-serif";
const MONO = "'JetBrains Mono Variable',ui-monospace,monospace";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text element. o: size, font (d|b|m), fill, weight, anchor, ls (letter spacing), tl (textLength). */
export function text(x, y, str, o = {}) {
  const font = { d: DISPLAY, b: BODY, m: MONO }[o.font ?? 'b'];
  const extra =
    (o.tl ? ` textLength="${o.tl}" lengthAdjust="spacingAndGlyphs"` : '') +
    (o.cls ? ` class="${o.cls}"` : '') +
    (o.style ? ` style="${o.style}"` : '');
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${o.size ?? 21}" font-weight="${o.weight ?? 500}" fill="${o.fill}" text-anchor="${o.anchor ?? 'start'}" letter-spacing="${o.ls ?? 0}"${extra}>${esc(str)}</text>`;
}

/** Logo parts from the lockup file: mark path and rects, and the five wordmark letters. */
export function logoParts(theme) {
  const src = brand(theme.logo);
  const inner = src.slice(
    src.indexOf('<g transform="translate(0 0)">') + '<g transform="translate(0 0)">'.length,
    src.lastIndexOf('</g></svg>'),
  );
  const mark = inner.slice(0, inner.indexOf('<g transform="translate(126'));
  const word = inner.slice(inner.indexOf('<g transform="translate(126'));
  const wordOpen = word.match(/^<g transform="[^"]+">/)[0];
  const letters = [...word.matchAll(/<g><g transform="translate\([^"]+\)">.*?<\/g><\/g>/g)].map(
    (m) => m[0],
  );
  if (letters.length !== 5) throw new Error(`expected 5 letters, got ${letters.length}`);
  const ring = mark
    .match(/<path[^>]*\/>/)[0]
    .replace('<path ', '<path pathLength="1" class="ring" ');
  const rects = [...mark.matchAll(/<rect[^>]*\/>/g)].map((m) => m[0]);
  return { ring, rects, wordOpen, letters };
}

/** Animated (or static) lockup placed at x,y with scale s. Lockup is 406.24 x 100 units. Animation start time t0 in seconds. */
export function lockup(theme, x, y, s, { animate = false, t0 = 0 } = {}) {
  const { ring, rects, wordOpen, letters } = logoParts(theme);
  if (!animate) {
    return `<g transform="translate(${x} ${y}) scale(${s})">${ring.replace(' class="ring"', '')}${rects.join('')}${wordOpen}${letters.join('')}</g></g>`;
  }
  const d = (v) => `${(t0 + v).toFixed(2)}s`;
  const handle = rects[0].replace(/x="[^"]+" y="[^"]+"/, 'x="-60" y="-6.5"');
  const head = rects[1].replace(/x="[^"]+" y="[^"]+"/, 'x="-68" y="-17"');
  const css = `.ring{stroke-dasharray:1;animation:draw .8s cubic-bezier(.5,0,.2,1) ${d(0)} both}
.mallet{transform-origin:0 0;animation:strike 1.4s linear ${d(0.35)} both}
.shock{fill:none;stroke:#ff6a1f;stroke-width:4;transform-box:fill-box;transform-origin:50% 50%;animation:shock .8s cubic-bezier(.1,.6,.3,1) ${d(1.3)} both}
.shock2{animation-delay:${d(1.42)};stroke-width:1.5}
.glyph{transform-box:fill-box;transform-origin:50% 50%;animation:jolt .4s ease-out ${d(1.3)} both}
.lt{animation:lin .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes strike{0%{transform:rotate(40deg);opacity:0;animation-timing-function:ease-out}22%{transform:rotate(12deg);opacity:1;animation-timing-function:ease-in-out}58%{transform:rotate(12deg);animation-timing-function:cubic-bezier(.7,0,1,.6)}66%{transform:rotate(0deg)}100%{transform:rotate(0deg);opacity:1}}
@keyframes shock{0%{opacity:0;transform:scale(.5)}10%{opacity:1}100%{opacity:0;transform:scale(2.6)}}
@keyframes jolt{0%{transform:scale(1)}30%{transform:scale(.955)}100%{transform:scale(1)}}
@keyframes lin{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:translateX(0)}}`;
  const letterHtml = letters
    .map((l, i) => `<g class="lt" style="animation-delay:${d(1.55 + i * 0.08)}">${l}</g>`)
    .join('');
  const body = `<g transform="translate(${x} ${y}) scale(${s})"><circle class="shock" cx="50" cy="50" r="46"/><circle class="shock shock2" cx="50" cy="50" r="46"/><g class="glyph">${ring}<g transform="translate(100 50)"><g class="mallet">${handle}${head}</g></g></g>${wordOpen}${letterHtml}</g></g>`;
  return { css, body };
}

const svgOpen = (w, h, title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d"><title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>`;
const reduce = '@media (prefers-reduced-motion:reduce){*{animation:none!important}}';

/** A card with a hard offset shadow. */
function card(th, x, y, w, h, { fill, stroke = th.ink, sw = 3, sh = 7 } = {}) {
  return `<rect x="${x + sh}" y="${y + sh}" width="${w}" height="${h}" fill="${th.shadow}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill ?? th.card}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function wrapSvg(th, w, h, title, desc, css, content) {
  return `${svgOpen(w, h, title, desc)}<style>${fontCss()}${css}${reduce}</style><rect width="${w}" height="${h}" fill="${th.bg}"/>${content}</svg>`;
}

const TAG1 = 'Every bid is a PayPal hold.';
const TAG2 = 'The hammer is the payment.';

/* ------------------------------------------------------------------ HERO */
export const HERO_END = 5.8;
export function hero(th, animate) {
  const W = 1280;
  const H = 440;
  const lk = lockup(th, 80, 36, 1.2, { animate });
  const logo = animate ? lk.body : lk;
  const a = (name, delay, dur = 0.55) =>
    animate ? ` style="animation:${name} ${dur}s cubic-bezier(.2,.8,.2,1) ${delay}s both"` : '';
  const css = animate
    ? `${lk.css}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes wipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes pop{0%{opacity:0;transform:scale(1.5) rotate(-4deg)}60%{opacity:1;transform:scale(.94) rotate(0)}100%{opacity:1;transform:scale(1)}}
.bar{transform-box:fill-box;transform-origin:0 50%}
.chip{transform-box:fill-box;transform-origin:50% 50%}`
    : '';
  const rows = [
    ['BIDDER A', 'hold $300 &#183; bid $180', 'CAPTURED', true],
    ['BIDDER B', 'hold $250 &#183; bid $150', 'VOIDED', false],
    ['BIDDER C', 'hold $200 &#183; no bid', 'VOIDED', false],
  ];
  const cx = 830;
  const cy = 64;
  let cardG = `<g${a('rise', 2.4, 0.6)}>${card(th, cx, cy, 380, 312)}<rect x="${cx}" y="${cy}" width="380" height="52" fill="${th.ink}"/>${text(cx + 20, cy + 34, 'LOT 07 &#183; SIMULATED', { font: 'm', size: 20, weight: 700, fill: th.onInk, ls: 1 })}</g>`;
  rows.forEach(([n, sub, st, win], i) => {
    const y = cy + 52 + i * 86;
    const chipW = 140;
    const delay = 2.9 + i * 0.3;
    cardG += `<g${a('rise', delay, 0.5)}>${i ? `<line x1="${cx + 16}" x2="${cx + 364}" y1="${y}" y2="${y}" stroke="${th.rule}" stroke-width="2"/>` : ''}${text(cx + 20, y + 38, n, { font: 'd', size: 32, weight: 800, fill: th.ink, ls: 1 })}${text(cx + 20, y + 68, sub, { font: 'm', size: 19, fill: th.muted })}`;
    const chip = win
      ? `<rect x="${cx + 380 - 20 - chipW}" y="${y + 12}" width="${chipW}" height="40" fill="${th.orange}" stroke="${th.ink === '#1d1712' ? th.ink : '#1d1712'}" stroke-width="3"/>${text(cx + 380 - 20 - chipW / 2, y + 42, st, { font: 'd', size: 28, weight: 800, fill: '#1d1712', anchor: 'middle', ls: 1 })}`
      : `<rect x="${cx + 380 - 20 - chipW}" y="${y + 12}" width="${chipW}" height="40" fill="none" stroke="${th.muted}" stroke-width="2" stroke-dasharray="6 4"/>${text(cx + 380 - 20 - chipW / 2, y + 42, st, { font: 'd', size: 28, weight: 700, fill: th.muted, anchor: 'middle', ls: 1 })}`;
    cardG +=
      win && animate
        ? `<g class="chip" style="animation:pop .5s ease-out ${delay + 0.9}s both">${chip}</g></g>`
        : `${chip}</g>`;
  });
  const content = `
<rect x="0" y="0" width="${W}" height="10" fill="${th.ink}"/>
<rect x="0" y="${H - 10}" width="${W}" height="10" fill="${th.orange}"/>
${logo}
<g${a('rise', 2.2)}>${text(80, 252, TAG1.toUpperCase(), { font: 'd', size: 66, weight: 800, fill: th.ink, tl: 700, ls: 0 })}</g>
<g${a('rise', 2.55)}>${text(80, 320, TAG2.toUpperCase(), { font: 'd', size: 66, weight: 800, fill: th.ink, tl: 700 })}</g>
<rect class="bar" x="80" y="340" width="700" height="8" fill="${th.orange}"${a('wipe', 3.1, 0.6)}/>
<g${a('rise', 3.4)}>${text(80, 392, 'PAYPAL SANDBOX ONLY &#183; NO REAL MONEY MOVES', { font: 'm', size: 20, weight: 600, fill: th.muted, ls: 0.5 })}</g>
${cardG}`;
  return wrapSvg(
    th,
    W,
    H,
    'GAVEL: every bid is a PayPal hold, the hammer is the payment',
    'The GAVEL Mallet G logo and tagline, with a simulated lot: bidder A holds $300, bids $180 and is captured; bidders B and C are voided.',
    css,
    content,
  );
}

/* ------------------------------------------------------------ ARCHITECTURE */
export const ARCH_STEPS = [0.4, 2.5, 4.6, 6.7, 8.8];
export const ARCH_END = 12;
const CAPTIONS = [
  "1  The Cloudflare Worker serves the web app to the bidder's browser.",
  "2  The bidder's PayPal hold approval and bids go to the Render API.",
  '3  The API asks PayPal sandbox for the hold and checks each bid against it.',
  '4  At the hammer: winner captured, other holds voided, every step in the ledger.',
  '5  A receipt is issued. Anyone can verify the exported hash chain.',
];

export function architecture(th, animate) {
  const W = 1280;
  const H0 = 710;
  const CAP = animate ? 90 : 0;
  const H = H0 + CAP;
  let css = '';
  const ink = th.ink;
  const box = (x, y, w, h, title, lines, o = {}) => {
    let s = card(th, x, y, w, h, { fill: o.fill });
    s += text(x + 18, y + 46, title, { font: 'd', size: 34, weight: 800, fill: ink, ls: 0.5 });
    lines.forEach((l, i) => {
      s += text(x + 18, y + 80 + i * 28, l, {
        font: o.mono && i === 0 ? 'm' : 'b',
        size: 19,
        weight: 500,
        fill: o.mono && i === 0 ? th.ink : th.muted,
      });
    });
    return s;
  };
  const nodes = {
    worker: [60, 52, 290, 140],
    browser: [60, 270, 290, 190],
    api: [450, 270, 320, 190],
    paypal: [870, 270, 350, 190],
    ledger: [450, 520, 320, 112],
    receipt: [870, 520, 350, 112],
  };
  let g = '';
  g += box(...nodes.worker, 'CLOUDFLARE WORKER', ['gavel.dualmindlab.tech', 'Serves the web app'], {
    mono: true,
  });
  g += box(...nodes.browser, 'BROWSER', [
    'Bidder and auctioneer',
    'PayPal SDK v6 popup',
    'Bid screen and QR',
  ]);
  g += box(...nodes.api, 'RENDER API', [
    'Room and rules engine',
    'Hold service, settlement saga',
    'File stores, persistent disk',
  ]);
  g += box(...nodes.paypal, 'PAYPAL SANDBOX', [
    'Authorize: the hold',
    'Capture the winner, final capture',
    'Void every other hold',
    'Signed webhooks back to the API',
  ]);
  g += box(...nodes.ledger, 'HASH-CHAINED LEDGER', ['Append-only audit trail']);
  g += box(...nodes.receipt, 'RECEIPT AND VERIFY', ['Anyone can check the export']);

  // legend
  g += `<rect x="870" y="52" width="350" height="140" fill="none" stroke="${th.rule}" stroke-width="2" stroke-dasharray="6 5"/>`;
  g += text(890, 98, 'ONE BID, END TO END', {
    font: 'd',
    size: 32,
    weight: 800,
    fill: ink,
    ls: 0.5,
  });
  g += text(890, 134, 'Numbers follow one bid.', { size: 19, fill: th.muted });
  g += text(890, 162, 'Dotted: signed PayPal webhooks.', { size: 19, fill: th.muted });

  // arrows: [id, d, headPoints, label pos, label, badge pos]
  const arrows = [
    {
      n: 1,
      d: 'M205 196 V262',
      head: '205,268 197,254 213,254',
      lab: [228, 238, 'LOADS APP', 'start'],
      badge: [205, 229],
      from: [205, 196],
      to: [205, 262],
      dest: 'browser',
    },
    {
      n: 2,
      d: 'M352 350 H436',
      head: '442,350 428,342 428,358',
      lab: [400, 326, 'BID', 'middle'],
      badge: [397, 350],
      from: [352, 350],
      to: [436, 350],
      dest: 'api',
    },
    {
      n: 3,
      d: 'M772 350 H856',
      head: '862,350 848,342 848,358',
      lab: [820, 326, 'HOLD', 'middle'],
      badge: [817, 350],
      from: [772, 350],
      to: [856, 350],
      dest: 'paypal',
    },
    {
      n: 4,
      d: 'M610 462 V512',
      head: '610,518 602,504 618,504',
      lab: [634, 494, 'APPEND', 'start'],
      badge: [610, 488],
      from: [610, 462],
      to: [610, 512],
      dest: 'ledger',
    },
    {
      n: 5,
      d: 'M772 576 H856',
      head: '862,576 848,568 848,584',
      lab: [820, 552, 'RECEIPT', 'middle'],
      badge: [817, 576],
      from: [772, 576],
      to: [856, 576],
      dest: 'receipt',
    },
  ];
  const badge = (a, extra = '') =>
    `<g${extra}><circle cx="${a.badge[0]}" cy="${a.badge[1]}" r="17" fill="${th.orange}" stroke="#1d1712" stroke-width="3"/>${text(a.badge[0], a.badge[1] + 8, String(a.n), { font: 'm', size: 22, weight: 800, fill: '#1d1712', anchor: 'middle' })}</g>`;
  const arrowShape = (a, color, extra = '') =>
    `<g${extra}><path d="${a.d}" fill="none" stroke="${color}" stroke-width="4"/><polygon points="${a.head}" fill="${color}"/></g>`;

  // webhook dotted back arrow (static, always visible)
  const hook = `<path d="M862 420 H782" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="8 7"/><polygon points="776,420 790,412 790,428" fill="${ink}"/>${text(820, 450, 'WEBHOOK', { font: 'm', size: 19, weight: 700, fill: th.muted, anchor: 'middle' })}`;
  g += hook;

  if (!animate) {
    for (const a of arrows) {
      g +=
        arrowShape(a, ink) +
        text(a.lab[0], a.lab[1], a.lab[2], {
          font: 'm',
          size: 19,
          weight: 700,
          fill: th.muted,
          anchor: a.lab[3],
        }) +
        badge(a);
    }
  } else {
    arrows.forEach((a, i) => {
      const t = ARCH_STEPS[i];
      g += arrowShape(a, th.rule);
      g += text(a.lab[0], a.lab[1], a.lab[2], {
        font: 'm',
        size: 19,
        weight: 700,
        fill: th.muted,
        anchor: a.lab[3],
      });
      // active overlay
      css += `@keyframes dr${i}{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}@keyframes fd${i}{from{opacity:0}to{opacity:1}}`;
      g += `<g><path d="${a.d}" pathLength="1" fill="none" stroke="${ink}" stroke-width="4" stroke-dasharray="1" style="animation:dr${i} .8s ease-in-out ${t}s both"/><polygon points="${a.head}" fill="${ink}" style="animation:fd${i} .15s linear ${t + 0.7}s both"/></g>`;
      g += badge(a, ` style="animation:fd${i} .3s ease-out ${t}s both"`);
      // packet
      const dx = a.to[0] - a.from[0];
      const dy = a.to[1] - a.from[1];
      css += `@keyframes pk${i}{0%{opacity:0;transform:translate(0,0)}8%{opacity:1}92%{opacity:1}100%{opacity:0;transform:translate(${dx}px,${dy}px)}}`;
      g += `<g style="animation:pk${i} .8s ease-in-out ${t}s both"><rect x="${a.from[0] - 9}" y="${a.from[1] - 9}" width="18" height="18" fill="${th.orange}" stroke="#1d1712" stroke-width="3"/></g>`;
      // destination flash
      const [nx, ny, nw, nh] = nodes[a.dest];
      css += `@keyframes fl${i}{0%{opacity:0}30%{opacity:.4}100%{opacity:0}}`;
      g += `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" fill="${th.orange}" style="animation:fl${i} 1.2s ease-out ${t + 0.7}s both"/>`;
    });
    // captions strip
    g += `<rect x="0" y="${H0}" width="${W}" height="${CAP}" fill="${ink}"/>`;
    CAPTIONS.forEach((c, i) => {
      const t0 = ARCH_STEPS[i];
      const t1 = i < 4 ? ARCH_STEPS[i + 1] : null;
      const p = (s) => ((s / ARCH_END) * 100).toFixed(3);
      const kf = t1
        ? `0%{opacity:0}${p(t0)}%{opacity:0}${p(t0 + 0.3)}%{opacity:1}${p(t1 - 0.1)}%{opacity:1}${p(t1 + 0.1)}%{opacity:0}100%{opacity:0}`
        : `0%{opacity:0}${p(t0)}%{opacity:0}${p(t0 + 0.3)}%{opacity:1}100%{opacity:1}`;
      css += `@keyframes cp${i}{${kf}}`;
      g += `<g style="animation:cp${i} ${ARCH_END}s linear 0s both">${text(60, H0 + 56, c, { size: 26, weight: 600, fill: th.onInk })}</g>`;
    });
  }
  g += text(60, 674, 'PAYPAL SANDBOX ONLY &#183; NO REAL MONEY MOVES', {
    font: 'm',
    size: 19,
    weight: 600,
    fill: th.muted,
    ls: 0.5,
  });
  g += text(1220, 674, 'GAVEL ARCHITECTURE', {
    font: 'm',
    size: 19,
    weight: 600,
    fill: th.muted,
    anchor: 'end',
    ls: 0.5,
  });
  return wrapSvg(
    th,
    W,
    H,
    'GAVEL architecture: one bid end to end',
    'A bid travels from the browser, which loads the web app from a Cloudflare Worker, to the Render API, which holds and captures through PayPal sandbox, appends to a hash-chained ledger and produces a receipt anyone can verify.',
    css,
    g,
  );
}

/* --------------------------------------------------------------- LIFECYCLE */
export function lifecycle(th) {
  const W = 1280;
  const H = 380;
  const steps = [
    ['01', 'HOLD', ['PayPal holds the', "bidder's ceiling", 'before bidding.']],
    ['02', 'BID', ['Each bid is', 'checked against', 'that hold.']],
    ['03', 'HAMMER', ['Highest valid bid', 'wins and pays', 'the winning bid.']],
    ['04', 'RECEIPT', ['Other holds are', 'voided. Result is', 'in the ledger.']],
    ['05', 'VERIFY', ['Anyone can check', 'the hash chain', 'from the export.']],
  ];
  const cw = 216;
  const gap = 30;
  const x0 = 40;
  let g = '';
  steps.forEach(([n, name, lines], i) => {
    const x = x0 + i * (cw + gap);
    const y = 44;
    const hammer = i === 2;
    g += card(th, x, y, cw, 270, { fill: hammer ? th.orange : th.card });
    const fg = hammer ? '#1d1712' : th.ink;
    const sub = hammer ? '#1d1712' : th.muted;
    g += text(x + 18, y + 40, n, { font: 'm', size: 22, weight: 800, fill: sub });
    g += text(x + 18, y + 104, name, { font: 'd', size: 54, weight: 800, fill: fg, ls: 0.5 });
    g += `<rect x="${x + 18}" y="${y + 120}" width="56" height="6" fill="${hammer ? '#1d1712' : th.orange}"/>`;
    lines.forEach((l, j) => {
      g += text(x + 18, y + 166 + j * 30, l, { size: 19, weight: 500, fill: sub });
    });
    if (i < 4) {
      const ax = x + cw + 3;
      g += `<path d="M${ax} ${y + 135} H${ax + 14}" stroke="${th.ink}" stroke-width="4" fill="none"/><polygon points="${ax + 24},${y + 135} ${ax + 12},${y + 127} ${ax + 12},${y + 143}" fill="${th.ink}"/>`;
    }
  });
  g += text(40, 360, 'PAYPAL SANDBOX ONLY &#183; NO REAL MONEY MOVES', {
    font: 'm',
    size: 19,
    weight: 600,
    fill: th.muted,
    ls: 0.5,
  });
  return wrapSvg(
    th,
    W,
    H,
    'GAVEL lifecycle: hold, bid, hammer, receipt, verify',
    'Five steps of a GAVEL auction: PayPal holds the bidder ceiling, each bid is checked against the hold, the hammer captures the winner at the winning price, other holds are voided and a receipt is written to the ledger, and anyone can verify the hash chain.',
    '',
    g,
  );
}

/* ------------------------------------------------------------------ OUTRO */
export const OUTRO_END = 5;
export function outro(th, animate) {
  const W = 1280;
  const H = 480;
  const lk = lockup(th, 80, 52, 1.2, { animate });
  const logo = animate ? lk.body : lk;
  const a = (name, delay, dur = 0.5) =>
    animate ? ` style="animation:${name} ${dur}s cubic-bezier(.2,.8,.2,1) ${delay}s both"` : '';
  const css = animate
    ? `${lk.css}@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes slide{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}`
    : '';
  const links = [
    ['REPO', 'github.com/harshbhx/gavel-auction'],
    ['WEB', 'gavel.dualmindlab.tech'],
    ['DOCS', 'docs.gavel.dualmindlab.tech'],
  ];
  let g = `<rect width="${W}" height="10" fill="${th.ink}"/><rect y="${H - 10}" width="${W}" height="10" fill="${th.orange}"/>${logo}`;
  g += `<g${a('rise', 2.0)}>${text(700, 100, TAG1.toUpperCase(), { font: 'd', size: 46, weight: 800, fill: th.ink, tl: 500 })}${text(700, 150, TAG2.toUpperCase(), { font: 'd', size: 46, weight: 800, fill: th.ink, tl: 500 })}</g>`;
  links.forEach(([k, u], i) => {
    const y = 226 + i * 66;
    g += `<g${a('slide', 2.3 + i * 0.3, 0.55)}>${card(th, 80, y, 1120, 52, { sh: 5, sw: 3 })}<rect x="80" y="${y}" width="120" height="52" fill="${th.ink}"/>${text(140, y + 35, k, { font: 'm', size: 22, weight: 800, fill: th.onInk, anchor: 'middle', ls: 1 })}${text(224, y + 36, u, { font: 'm', size: 26, weight: 600, fill: th.ink })}</g>`;
  });
  g += `<g${a('rise', 3.4)}>${text(80, 450, 'PAYPAL SANDBOX ONLY &#183; NO REAL MONEY MOVES', { font: 'm', size: 20, weight: 600, fill: th.muted, ls: 0.5 })}</g>`;
  return wrapSvg(
    th,
    W,
    H,
    'GAVEL: closing card with links',
    'The GAVEL logo and tagline with three links: the repository github.com/harshbhx/gavel-auction, the web app gavel.dualmindlab.tech and the docs docs.gavel.dualmindlab.tech.',
    css,
    g,
  );
}

export const html = (svg, bg) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${bg};overflow:hidden}svg{display:block}</style>${svg}`;
