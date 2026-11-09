// Page shell for the Devpost broadside slides. Flat paper, black ink, one orange accent, app fonts, hairline
// rules, type revealed through masks. No cards, chips, gradients, glows or shadows. Pure string building.
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

export const INK = '#1d1712';
export const PALE = '#cbbfa6';
export const MUTE = '#6f6250';

const CSS = `
@font-face{font-family:'Public Sans Variable';font-weight:100 900;src:url('${fontUrl('public-sans-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'Big Shoulders Display Variable';font-weight:100 900;src:url('${fontUrl('big-shoulders-display-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'JetBrains Mono Variable';font-weight:100 900;src:url('${fontUrl('jetbrains-mono-latin-wght-normal.woff2')}') format('woff2-variations')}
:root{--bg:#efe6d3;--ink:${INK};--pale:${PALE};--mute:${MUTE};--orange:#ff6a1f;
--display:'Big Shoulders Display Variable','Arial Narrow',sans-serif;--body:'Public Sans Variable',system-ui,sans-serif;--mono:'JetBrains Mono Variable',ui-monospace,monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);overflow:hidden;color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased}
.stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
.a{position:absolute}
.ln{position:absolute;overflow:hidden;white-space:nowrap}
.ln>span{display:block;will-change:transform}
.d{font-family:var(--display);font-weight:800;text-transform:uppercase;letter-spacing:.004em}
.m{font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.b{font-family:var(--body);font-weight:600;letter-spacing:-.005em}
.or{color:var(--orange)}
.rl{position:absolute;background:var(--ink);height:1.5px}
.rv{position:absolute;background:var(--ink);width:1.5px}
`;

/** A clipped line of type that rises into place. fam: d (display), m (mono), b (body). */
export function ln(
  text,
  { x, y, size, a = 0, d = 0.75, fam = 'd', color = '', w = 1100, lh, align = '' },
) {
  const k = lh ?? (fam === 'd' ? 0.86 : 1.5);
  const h = Math.round(size * k);
  return `<div class="ln" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><span class="${fam}" data-a="${a}" data-d="${d}" data-k="mask" style="font-size:${size}px;line-height:${h}px;${color ? 'color:' + color + ';' : ''}${align ? 'text-align:' + align : ''}">${text}</span></div>`;
}

/** A hairline that draws itself. */
export function rule({ x, y, w, a = 0, d = 0.8, color = '', h = 1.5 }) {
  return `<div class="rl" data-a="${a}" data-d="${d}" data-k="draw" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${color ? 'background:' + color : ''}"></div>`;
}

export function vrule({ x, y, h, a = 0, d = 0.8, color = '', w = 1.5 }) {
  return `<div class="rv" data-a="${a}" data-d="${d}" data-k="drawy" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${color ? 'background:' + color : ''}"></div>`;
}

/** Masthead and foot shared by the slides: wordmark, lot number, hairlines, the sandbox note. */
export function frame({
  lot,
  foot = 'PayPal sandbox only',
  mast = true,
  ruleW = 1072,
  side = false,
}) {
  const wm = asset('brand/svg/wordmark-color.svg');
  const lotX = side ? 64 + ruleW - 236 : 900;
  return `
${mast ? `<img class="a" data-a="0" data-d=".5" src="${wm}" alt="GAVEL" style="left:64px;top:36px;height:30px">` : ''}
${ln('Lot ' + lot, { x: lotX, y: 40, size: 17, fam: 'm', color: 'var(--mute)', w: 236, a: 0.1, align: 'right' })}
${rule({ x: 64, y: 88, w: ruleW, a: 0, d: 0.7 })}
${rule({ x: 64, y: 744, w: ruleW, a: 0.1, d: 0.7 })}
${ln(foot, { x: 64, y: 756, size: 14, fam: 'm', color: 'var(--mute)', w: 600, a: 0.3 })}
${side ? '' : ln('gavel.dualmindlab.tech', { x: 836, y: 756, size: 14, fam: 'm', color: 'var(--mute);text-transform:none', w: 300, a: 0.3, align: 'right' })}`;
}

export function pageHtml({ T, html, js }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GAVEL slide</title><style>${CSS}</style></head><body>
<div class="stage">
${html}
</div>
<script>window.SCENE_T=${T};</script>
<script>${runtime}</script>
<script>${js}</script>
</body></html>`;
}
