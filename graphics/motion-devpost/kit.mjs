// Page shell for the Devpost slides: app fonts, paper palette, grid and glow background, shared type and
// card styles, the finished brand lockup. Pure string building; the browser work happens in render.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const W = 1200;
export const H = 800;
const fontUrl = (f) => pathToFileURL(path.join(root, 'packages/web/src/design/fonts', f)).href;
export const asset = (rel) => pathToFileURL(path.join(root, rel)).href;
const runtime = readFileSync(path.join(here, 'runtime.js'), 'utf8');

/** Letters of the wordmark (G A V E L) from the brand lockup, as inline SVG group strings. */
export function lockupLetters() {
  const svg = readFileSync(path.join(root, 'brand/svg/lockup-h-color.svg'), 'utf8');
  const letters = [
    ...svg.matchAll(/<g><g transform="translate\(([\d.]+) 0\)">([\s\S]*?)<\/g><\/g>/g),
  ].map((x) => `<g transform="translate(${x[1]} 0)">${x[2]}</g>`);
  if (letters.length !== 5) throw new Error('expected 5 wordmark letters');
  return letters;
}

const CSS = `
@font-face{font-family:'Public Sans Variable';font-weight:100 900;src:url('${fontUrl('public-sans-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'Big Shoulders Display Variable';font-weight:100 900;src:url('${fontUrl('big-shoulders-display-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'JetBrains Mono Variable';font-weight:100 900;src:url('${fontUrl('jetbrains-mono-latin-wght-normal.woff2')}') format('woff2-variations')}
:root{--bg:#efe6d3;--card:#fbf6ea;--raised:#e6dac1;--ink:#1d1712;--muted:#5a4d3f;--rule:#c9b99a;--orange:#ff6a1f;--green:#256b3a;--red:#b3261e;
--display:'Big Shoulders Display Variable','Arial Narrow',sans-serif;--body:'Public Sans Variable',system-ui,sans-serif;--mono:'JetBrains Mono Variable',ui-monospace,monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);overflow:hidden;color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased}
.stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
.glow{position:absolute;inset:0;background:radial-gradient(ellipse 620px 520px at 88% 8%,rgba(255,106,31,.16),transparent 70%),radial-gradient(ellipse 700px 500px at 4% 104%,rgba(255,106,31,.09),transparent 70%)}
.dots{position:absolute;inset:0;background:radial-gradient(rgba(29,23,18,.16) 1.3px,transparent 1.5px) 0 0/36px 36px;-webkit-mask-image:radial-gradient(ellipse 80% 75% at 50% 50%,#000 20%,transparent 100%);mask-image:radial-gradient(ellipse 80% 75% at 50% 50%,#000 20%,transparent 100%);opacity:.55}
.a{position:absolute}
.hdr{left:72px;top:46px;height:40px}
.hdr img{height:40px;display:block}
.h1{font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:.88;letter-spacing:.004em;margin:0}
.or{color:var(--orange)}
.sub{font:500 30px/1.25 var(--body);color:var(--muted);letter-spacing:-.005em}
.mono{font-family:var(--mono)}
.chip{display:inline-flex;align-items:center;gap:10px;white-space:nowrap;font:700 15px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:11px 18px;border-radius:999px;background:rgba(251,246,234,.8);border:1.5px solid rgba(29,23,18,.2);color:var(--ink)}
.chip i{width:9px;height:9px;border-radius:50%;background:var(--orange);display:block}
.card{background:var(--card);border-radius:24px;box-shadow:0 0 0 1px rgba(29,23,18,.09),0 1px 0 rgba(255,255,255,.8) inset,0 30px 50px -22px rgba(29,23,18,.32),0 8px 16px -8px rgba(29,23,18,.16)}
.pill{display:inline-block;white-space:nowrap;font:700 14px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:8px 12px;border-radius:999px}
.p-ok{background:rgba(37,107,58,.14);color:var(--green)}
.p-sim{background:rgba(255,106,31,.18);color:#a8400a}
.p-syn{background:rgba(29,23,18,.08);color:var(--muted)}
`;

export function pageHtml({ T, html, js, header = true }) {
  const lockup = asset('brand/svg/lockup-h-color.svg');
  return `<!doctype html><html><head><meta charset="utf-8"><title>GAVEL slide</title><style>${CSS}</style></head><body>
<div class="stage"><div class="glow"></div><div class="dots"></div>
${header ? `<div class="a hdr" data-a="0" data-d=".5" data-dy="-12"><img src="${lockup}" alt="GAVEL"></div>` : ''}
${html}
</div>
<script>window.SCENE_T=${T};</script>
<script>${runtime}</script>
<script>${js}</script>
</body></html>`;
}
