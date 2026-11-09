// Shared motion kit for the animated GAVEL graphics (README, Devpost, brand video, animated logos).
// Motion language (GAVEL's own): a confident ease. The Mallet G draws round, the mallet winds up and
// strikes, a smooth round shockwave ring leaves the G, the G settles, then the wordmark glides in. Other
// motifs come from the product: a bid ladder ticking up, hash-chain links snapping into a receipt, and the
// hold, hammer, receipt flow. No gears, no teeth, no stepped easing.
// The logo geometry is read from brand/svg/*.svg and never redrawn. Pure string building: no browser here.
// Pages are sampled by seeking (see lib/render.mjs), so output is deterministic. Never run on the VM.
import { readFileSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const brand = (f) => readFileSync(path.join(root, 'brand/svg', f), 'utf8');
const fontUrl = (f) => pathToFileURL(path.join(root, 'packages/web/src/design/fonts', f)).href;

export const THEMES = {
  paper: {
    name: 'paper',
    bg: '#efe6d3',
    card: '#f8f2e4',
    raised: '#e6dac1',
    ink: '#1d1712',
    muted: '#5a4d3f',
    rule: '#c9b99a',
    orange: '#ff6a1f',
    green: '#256b3a',
    red: '#b3261e',
    shadow: '#1d1712',
    variant: 'color',
  },
  dark: {
    name: 'dark',
    bg: '#1d1712',
    card: '#2a2218',
    raised: '#33291d',
    ink: '#efe6d3',
    muted: '#b9ab94',
    rule: '#4a3f30',
    orange: '#ff6a1f',
    green: '#7fd08f',
    red: '#ff8a80',
    shadow: '#000000',
    variant: 'reversed',
  },
};

/* ---------- animated logo ---------- */

export const LOGO_CSS = `
.gv-ring{stroke-dasharray:1;animation:gv-draw .55s cubic-bezier(.55,0,.2,1) var(--s,0s) backwards}
.gv-mal{transform-origin:100px 50px;animation:gv-swing 1s linear calc(var(--s,0s) + .25s) backwards}
.gv-jolt{transform-origin:50px 50px;animation:gv-jolt .4s cubic-bezier(.2,.8,.2,1) calc(var(--s,0s) + .97s) backwards}
.gv-shock{fill:none;stroke:#ff6a1f;stroke-width:1.6;opacity:0;transform-origin:50px 50px;animation:gv-shock .8s cubic-bezier(.12,.7,.25,1) calc(var(--s,0s) + .97s)}
.gv-mk{animation:gv-slide .5s cubic-bezier(.65,0,.25,1) calc(var(--s,0s) + 1.35s) backwards}
.gv-l{animation:gv-in .45s cubic-bezier(.2,.8,.2,1) calc(var(--s,0s) + 1.55s + var(--i,0) * .06s) backwards}
.gv-loop .gv-ring,.gv-loop .gv-mk,.gv-loop .gv-l{animation:none}
.gv-loop .gv-mal{animation:gv-swing 1.6s linear 0s infinite}
.gv-loop .gv-jolt{animation:gv-jolt-l 1.6s cubic-bezier(.2,.8,.2,1) 0s infinite}
.gv-loop .gv-shock{animation:gv-shock-l 1.6s cubic-bezier(.12,.7,.25,1) 0s infinite}
.gv-still *{animation:none!important}
@keyframes gv-draw{from{stroke-dashoffset:1}}
@keyframes gv-swing{0%{transform:rotate(72deg);opacity:0;animation-timing-function:ease-out}8%{transform:rotate(72deg);opacity:1;animation-timing-function:cubic-bezier(.3,0,.4,1)}56%{transform:rotate(94deg);animation-timing-function:cubic-bezier(.75,0,1,.6)}72%,100%{transform:rotate(0deg);opacity:1}}
@keyframes gv-jolt{0%,100%{transform:scale(1)}30%{transform:scale(.93)}}
@keyframes gv-jolt-l{0%,70%{transform:scale(1)}78%{transform:scale(.93)}100%{transform:scale(1)}}
@keyframes gv-shock{0%{opacity:.8;transform:scale(.8)}100%{opacity:0;transform:scale(1.75)}}
@keyframes gv-shock-l{0%,71%{opacity:0;transform:scale(.8)}72%{opacity:.8;transform:scale(.8)}100%{opacity:0;transform:scale(1.75)}}
@keyframes gv-slide{from{transform:translateX(118px)}}
@keyframes gv-in{from{opacity:0;transform:translateX(-26px)}}
`;

function parts(variant) {
  const svg = brand(`lockup-h-${variant}.svg`);
  const m = svg.match(
    /<g transform="translate\(0 0\)">(<path[^>]*\/>)(<rect[^>]*\/>)(<rect[^>]*\/>)/,
  );
  if (!m) throw new Error('mark geometry not found in lockup-h-' + variant);
  const letters = [
    ...svg.matchAll(/<g><g transform="translate\(([\d.]+) 0\)">([\s\S]*?)<\/g><\/g>/g),
  ].map((x) => `<g transform="translate(${x[1]} 0)">${x[2]}</g>`);
  if (letters.length !== 5) throw new Error('expected 5 wordmark letters');
  return { ring: m[1], handle: m[2], head: m[3], letters };
}

const shock = '<circle class="gv-shock" cx="50" cy="50" r="46"/>';

function markGroup(p) {
  const ring = p.ring.replace('<path ', '<path class="gv-ring" pathLength="1" ');
  return `<g class="gv-jolt">${shock}${ring}<g class="gv-mal">${p.handle}${p.head}</g></g>`;
}

/** Inline-able animated logo. kind: 'mark' | 'lockup'. start: seconds before it begins. */
export function logoSvg({
  variant = 'color',
  kind = 'lockup',
  start = 0,
  loop = false,
  cls = '',
  still = false,
}) {
  if (still) cls = `gv-still ${cls}`;
  const p = parts(variant);
  const label = 'GAVEL';
  if (kind === 'mark') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -22 144 144" class="${loop ? 'gv-loop ' : ''}${cls}" style="--s:${start}s;overflow:visible" role="img" aria-label="${label}"><title>${label}</title>${markGroup(p)}</svg>`;
  }
  // The mark already is the G, so the wordmark continues with AVEL (never a second G).
  const letters = p.letters
    .slice(1)
    .map((l, i) => `<g class="gv-l" style="--i:${i}">${l}</g>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -22 391 144" class="${cls}" style="--s:${start}s;overflow:visible" role="img" aria-label="${label}"><title>${label}</title><g class="gv-mk">${markGroup(p)}</g><g transform="translate(56.56 19) scale(0.62)">${letters}</g></svg>`;
}

/** Standalone animated SVG file (CSS keyframes only, no script, reduced motion shows the finished logo). */
export function logoFile(opts) {
  const svg = logoSvg(opts);
  const css = LOGO_CSS + '@media (prefers-reduced-motion:reduce){*{animation:none!important}}';
  return svg.replace('</title>', `</title><style>${css}</style>`).replace(';overflow:visible', '');
}

/* ---------- page kit ---------- */

export const KIT_CSS = `
*{box-sizing:border-box}
html,body{margin:0;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased}
.stage{position:relative;overflow:hidden;background:var(--bg)}
.abs{position:absolute}
.disp{font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:.88;letter-spacing:-.005em}
.cap{font:600 13px var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.txt{font:500 20px var(--body);line-height:1.4;color:var(--ink)}
.or{color:var(--orange)}
.hr{background:var(--ink);transform-origin:0 50%;animation:gv-grow var(--len,.9s) cubic-bezier(.6,0,.2,1) var(--d,0s) backwards}
.vr{background:var(--ink);transform-origin:50% 0;animation:gv-growy var(--len,.9s) cubic-bezier(.6,0,.2,1) var(--d,0s) backwards}
.rev{display:block;overflow:hidden}
.rev>*{display:block;animation:gv-rev var(--len,.8s) cubic-bezier(.2,.7,.1,1) var(--d,0s) backwards}
.rise{animation:gv-rise .7s cubic-bezier(.2,.7,.1,1) var(--d,0s) backwards}
.fade{animation:gv-fade .6s ease var(--d,0s) backwards}
.drop{animation:gv-drop .5s cubic-bezier(.55,0,.1,1) var(--d,0s) backwards}
.shk{animation:gv-shk .32s cubic-bezier(.2,.7,.1,1) var(--d,0s)}
.ringl{position:absolute;border:2px solid var(--ink);border-radius:50%;opacity:0;animation:gv-ringl 1.1s cubic-bezier(.12,.7,.25,1) var(--d,0s)}
.scn{position:absolute;inset:0;animation:gv-scn var(--sl,4s) linear var(--at,0s)}
.scn{opacity:0}
.cur{position:absolute;inset:0;background:var(--ink);clip-path:inset(100% 0 0 0);animation:gv-cur .5s cubic-bezier(.7,0,.3,1) var(--at,0s)}
@keyframes gv-rev{from{transform:translateY(106%)}}
@keyframes gv-rise{from{opacity:0;transform:translateY(18px)}}
@keyframes gv-fade{from{opacity:0}}
@keyframes gv-drop{from{transform:translateY(-130%)}}
@keyframes gv-shk{0%,100%{transform:translateY(0)}30%{transform:translateY(8px)}}
@keyframes gv-grow{from{transform:scaleX(0)}}
@keyframes gv-growy{from{transform:scaleY(0)}}
@keyframes gv-ringl{0%{opacity:.7;transform:scale(.15)}100%{opacity:0;transform:scale(1)}}
@keyframes gv-scn{from,to{opacity:1}}
@keyframes gv-cur{0%{clip-path:inset(100% 0 0 0)}50%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 100% 0)}}
`;

/** A thin orange hairline that draws in from the left (the foot rule of the layouts). */
export function rule(w, d = 0, h = 5, color = 'var(--orange)') {
  return `<div class="wipe" style="--d:${d}s;width:${w}px;height:${h}px;background:${color}"></div>`;
}

/** Counts a number up in ratchet steps. Used with data-count attributes by __seek below. */
export const COUNT_JS = `
window.__seek=function(ms){
  document.querySelectorAll('[data-count],[data-ladder]').forEach(function(el){
    if(el.dataset.ladder){
      var v=null,first=Infinity;
      el.dataset.ladder.split(',').forEach(function(pair){var a=pair.split(':'),t=parseFloat(a[0])*1000;first=Math.min(first,t);if(ms>=t)v=a[1];});
      el.innerHTML=(el.dataset.pre||'')+(v===null?el.dataset.init||'':v)+(el.dataset.suf||'');
      return;
    }
    var to=parseFloat(el.dataset.count),from=parseFloat(el.dataset.from||0),st=parseFloat(el.dataset.start||0)*1000,
        du=parseFloat(el.dataset.dur||1)*1000,dec=parseInt(el.dataset.dec||0,10);
    var p=Math.min(1,Math.max(0,(ms-st)/du));p=1-Math.pow(1-p,3);
    var v2=from+(to-from)*p;
    el.innerHTML=(el.dataset.pre||'')+v2.toFixed(dec)+(el.dataset.suf||'');
    el.style.visibility=ms<st-1?'hidden':'visible';
  });
};`;

/** Full HTML page for a scene. */
export function page({ theme, w, h, body, css = '', js = '', title = 'GAVEL motion' }) {
  const t = THEMES[theme];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
@font-face{font-family:'Public Sans Variable';font-weight:100 900;src:url('${fontUrl('public-sans-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'Big Shoulders Display Variable';font-weight:100 900;src:url('${fontUrl('big-shoulders-display-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'JetBrains Mono Variable';font-weight:100 900;src:url('${fontUrl('jetbrains-mono-latin-wght-normal.woff2')}') format('woff2-variations')}
:root{--bg:${t.bg};--card:${t.card};--raised:${t.raised};--ink:${t.ink};--muted:${t.muted};--rule:${t.rule};--orange:${t.orange};--green:${t.green};--red:${t.red};--shadow:${t.shadow};
--display:'Big Shoulders Display Variable','Arial Narrow',sans-serif;--body:'Public Sans Variable',system-ui,sans-serif;--mono:'JetBrains Mono Variable',ui-monospace,monospace}
${KIT_CSS}${LOGO_CSS}${css}
</style></head><body><div class="stage" style="width:${w}px;height:${h}px">${body}</div><script>${COUNT_JS}${js}</script></body></html>`;
}

export function writePage(file, opts) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, page(opts));
  return file;
}

/* ---------- encoders ---------- */

/** Two pass palette GIF from numbered PNG frames sampled at inFps, resampled to outFps. Tries a ladder until it fits. */
export function fitGif(dir, out, { inFps, outFps, width, limit, ladder }) {
  mkdirSync(path.dirname(out), { recursive: true });
  const steps = ladder ?? [
    [128, 20],
    [96, 40],
    [64, 80],
    [48, 120],
    [32, 150],
  ];
  let size = 0;
  for (const [colors, lossy] of steps) {
    const vf = `fps=${outFps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      String(inFps),
      '-i',
      path.join(dir, 'f%04d.png'),
      '-vf',
      vf,
      '-loop',
      '0',
      out,
    ]);
    try {
      execFileSync('gifsicle', ['-O3', `--lossy=${lossy}`, '-b', out]);
    } catch {
      /* gifsicle optional */
    }
    size = statSync(out).size;
    if (!limit || size <= limit) break;
  }
  return size;
}

const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/** H.264 MP4 (plays in WhatsApp, GitHub and every browser). */
export function mp4v(dir, out, fps) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(fps),
    '-i',
    path.join(dir, 'f%04d.png'),
    '-vf',
    EVEN,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    out,
  ]);
}

export function webm(dir, out, fps) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(fps),
    '-i',
    path.join(dir, 'f%04d.png'),
    '-vf',
    EVEN,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '34',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
}

export function frameCount(dir) {
  return execFileSync('sh', ['-c', `ls ${JSON.stringify(dir)}/f*.png | wc -l`])
    .toString()
    .trim();
}

export const rm = (p) => rmSync(p, { recursive: true, force: true });
