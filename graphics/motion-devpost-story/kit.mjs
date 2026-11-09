// Page shell for the Devpost story set (the images inside the written project description). Same GAVEL
// design language and the same time-driven runtime as the gallery slides (graphics/motion-devpost), but the
// stage size is a parameter: 1000x560 inline illustrations and a 1600x500 header banner.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
const fontUrl = (f) => pathToFileURL(path.join(root, 'packages/web/src/design/fonts', f)).href;
export const asset = (rel) => pathToFileURL(path.join(root, rel)).href;
const runtime = readFileSync(path.join(root, 'graphics/motion-devpost/runtime.js'), 'utf8');

const css = (W, H) => `
@font-face{font-family:'Public Sans Variable';font-weight:100 900;src:url('${fontUrl('public-sans-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'Big Shoulders Display Variable';font-weight:100 900;src:url('${fontUrl('big-shoulders-display-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'JetBrains Mono Variable';font-weight:100 900;src:url('${fontUrl('jetbrains-mono-latin-wght-normal.woff2')}') format('woff2-variations')}
:root{--bg:#efe6d3;--card:#fbf6ea;--raised:#e6dac1;--ink:#1d1712;--muted:#5a4d3f;--rule:#c9b99a;--orange:#ff6a1f;--green:#256b3a;--red:#b3261e;
--display:'Big Shoulders Display Variable','Arial Narrow',sans-serif;--body:'Public Sans Variable',system-ui,sans-serif;--mono:'JetBrains Mono Variable',ui-monospace,monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);overflow:hidden;color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased}
.stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
.a{position:absolute}
.or{color:var(--orange)}
.mono{font-family:var(--mono)}
.lab{font:600 12px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink)}
.cap{font:500 15px/1.35 var(--mono);color:var(--muted);letter-spacing:.01em}
`;

export function pageHtml({ W, H, T, html, js }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GAVEL story</title><style>${css(W, H)}</style></head><body>
<div class="stage"><div id="w" class="a" style="left:0;top:0;width:${W}px;height:${H}px">${html}</div></div>
<script>window.SCENE_T=${T};</script>
<script>${runtime}</script>
<script>${js}</script>
</body></html>`;
}
