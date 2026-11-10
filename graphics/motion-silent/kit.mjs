// Page shells for the silent video (1920x1080 printed broadside, same look as the Devpost gallery):
// flat paper, black ink, one orange accent, the app fonts, hairline rules. No cards, chips, gradients,
// glows or shadows. Pure string building. Cards run on the shared motion runtime of motion-devpost.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export { root, asset, lockupLetters, ln, rule, vrule } from '../motion-devpost/kit.mjs';
import { root, asset, ln, rule } from '../motion-devpost/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const W = 1920;
export const H = 1080;
export const FPS = 24;
export const INK = '#1d1712';
export const MUTE = '#6f6250';
export const PALE = '#cbbfa6';
export const PAPER = '#efe6d3';
const runtime = readFileSync(path.join(here, '../motion-devpost/runtime.js'), 'utf8');
const fontUrl = (f) => pathToFileURL(path.join(root, 'packages/web/src/design/fonts', f)).href;

export const CSS = `
@font-face{font-family:'Public Sans Variable';font-weight:100 900;src:url('${fontUrl('public-sans-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'Big Shoulders Display Variable';font-weight:100 900;src:url('${fontUrl('big-shoulders-display-latin-wght-normal.woff2')}') format('woff2-variations')}
@font-face{font-family:'JetBrains Mono Variable';font-weight:100 900;src:url('${fontUrl('jetbrains-mono-latin-wght-normal.woff2')}') format('woff2-variations')}
:root{--bg:${PAPER};--ink:${INK};--pale:${PALE};--mute:${MUTE};--orange:#ff6a1f;
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

const SOURCE = 'Recorded run. Simulated holds. No PayPal call.';
const FOOT = 'PayPal sandbox only. No real money moves.';
const URL_TXT = 'gavel.dualmindlab.tech';
const STEPS = ['Hold', 'Bid', 'Hammer', 'Receipt', 'Verify'];

const mono = (
  text,
  x,
  y,
  { size = 18, color = 'var(--mute)', w = 900, align = 'left', upper = true } = {},
) =>
  `<div class="a m" style="left:${x}px;top:${y}px;width:${w}px;font-size:${size}px;line-height:${Math.round(size * 1.4)}px;color:${color};text-align:${align};${upper ? '' : 'text-transform:none;'}">${text}</div>`;

/** Static chrome of a recorded scene: masthead, source label, pane plates and labels, the step rail. */
export function chromeHtml({ step = 0, panes = [] }) {
  const wm = asset('brand/svg/wordmark-color.svg');
  const plates = panes
    .map(
      (p) =>
        `<div class="a" style="left:${p.x - 3}px;top:${p.y - 3}px;width:${p.w + 6}px;height:${p.h + 6}px;border:1.5px solid ${INK}"></div>` +
        mono(p.label ?? '', p.x - 3, p.stacked ? p.y + p.h + 6 : 872, {
          size: 16,
          w: Math.max(p.w, 300),
        }),
    )
    .join('');
  const rail = STEPS.map((s, i) => {
    const on = i + 1 === step;
    const x = 64 + i * 358;
    return (
      (on
        ? `<div class="a" style="left:${x}px;top:930px;width:96px;height:5px;background:var(--orange)"></div>`
        : '') +
      `<div class="a m" style="left:${x}px;top:944px;font-size:22px;line-height:30px;color:${on ? INK : MUTE};font-weight:${on ? 800 : 600}"><span style="color:${on ? 'var(--orange)' : MUTE}">${i + 1}</span>&nbsp; ${s}</div>`
    );
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="stage">
<img class="a" src="${wm}" alt="GAVEL" style="left:64px;top:30px;height:44px">
${mono(SOURCE, 1056, 44, { size: 18, w: 800, align: 'right' })}
<div class="rl" style="left:64px;top:104px;width:1792px"></div>
${plates}
<div class="rl" style="left:64px;top:916px;width:1792px"></div>
${rail}
<div class="rl" style="left:64px;top:1000px;width:1792px"></div>
${mono(FOOT, 64, 1020, { size: 17 })}
${mono(URL_TXT, 1056, 1020, { size: 17, w: 800, align: 'right', upper: false })}
</div></body></html>`;
}

export const CAP = { x: 1392, y: 150, w: 464 };

/** The caption layer: transparent page, one block per caption, driven by window.setState([{i, inP, outP}]). */
export function captionHtml(caps) {
  const blocks = caps
    .map(
      (
        c,
        i,
      ) => `<div class="cap" id="c${i}" style="left:${CAP.x}px;top:${CAP.y}px;width:${CAP.w}px;visibility:hidden">
<div class="mk"><div class="main d">${c.text}</div></div>
${c.sub ? `<div class="mk sub"><div class="b" style="font-size:27px;line-height:36px;color:${MUTE};margin-top:26px;font-weight:600">${c.sub}</div></div>` : ''}
</div>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
html,body{background:transparent}.stage{background:transparent}
.cap{position:absolute}.mk{overflow:hidden;padding:4px 0 10px;margin:-4px 0 -10px}
.main{font-size:74px;line-height:68px;font-weight:800;color:${INK}}
.main em{font-style:normal;color:var(--orange)}
</style></head><body><div class="stage">${blocks}</div>
<script>
window.setState = function(list){
  document.querySelectorAll('.cap').forEach(function(c){ c.style.visibility='hidden'; });
  list.forEach(function(s){
    var c = document.getElementById('c'+s.i); c.style.visibility='visible';
    var mks = c.querySelectorAll('.mk');
    mks.forEach(function(m, k){
      var inP = Math.min(1, Math.max(0, (s.inP*1.25 - k*0.25))), outP = s.outP;
      var ty = (1-inP)*110 - outP*110;
      m.firstElementChild.style.transform = 'translateY(' + ty.toFixed(2) + '%)';
    });
  });
};
</script></body></html>`;
}

/** Page for a card scene: stage plus the shared runtime; the card script defines setup/update. */
export function cardPage({ html, js }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GAVEL card</title><style>${CSS}</style></head><body>
<div class="stage">
${cardFrame()}
${html}
</div>
<script>window.SCENE_T=999;</script>
<script>${runtime}</script>
<script>${js}</script>
</body></html>`;
}

/** Masthead and foot of a card (wordmark, hairlines, the sandbox note). */
export function cardFrame({ mast = true } = {}) {
  const wm = asset('brand/svg/wordmark-color.svg');
  return `
${mast ? `<img class="a" data-a="0" data-d=".5" src="${wm}" alt="GAVEL" style="left:64px;top:30px;height:44px">` : ''}
${rule({ x: 64, y: 104, w: 1792, a: 0, d: 0.7 })}
${rule({ x: 64, y: 1000, w: 1792, a: 0.1, d: 0.7 })}
${ln(FOOT, { x: 64, y: 1020, size: 17, fam: 'm', color: 'var(--mute)', w: 900, a: 0.3 })}
${ln(URL_TXT, { x: 1056, y: 1020, size: 17, fam: 'm', color: 'var(--mute);text-transform:none', w: 800, a: 0.3, align: 'right' })}`;
}
