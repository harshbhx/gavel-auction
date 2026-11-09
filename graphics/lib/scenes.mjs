// Scene bodies shared by the brand video and the README reel. Laid out on a 1920x1080 stage like a printed
// auction broadside: flat paper, black ink, one orange accent, hairline rules that draw themselves, type
// that reveals through a mask, an asymmetric grid with a lot of empty paper. Callers scale them down.
import { logoSvg } from './motion.mjs';

export const W = 1920;
export const H = 1080;

const rev = (d, inner, style = '') =>
  `<div class="rev abs" style="--d:${d}s;${style}"><div>${inner}</div></div>`;

/** Logo sting: the Mallet G draws round, strikes, a hairline ring leaves it, the wordmark and tagline resolve. Under 3 s. */
export function introBody(th, at = 0) {
  return `
<div class="abs cap fade" style="--d:${at + 0.1}s;left:120px;top:44px;font-size:22px">Lot 01 &nbsp; Gavel</div>
<div class="abs cap fade" style="--d:${at + 0.1}s;right:120px;top:44px;font-size:22px">PayPal sandbox only</div>
<div class="abs hr" style="--d:${at + 0.05}s;--len:1.1s;left:120px;top:96px;width:1680px;height:3px"></div>
<div class="abs" style="left:96px;top:170px;width:1220px">${logoSvg({ variant: th.variant, start: at })}</div>
<div class="abs vr" style="--d:${at + 1.6}s;left:1410px;top:236px;width:3px;height:420px"></div>
${rev(at + 1.75, 'Every bid is<br>a PayPal hold.', 'left:1450px;top:236px;font-size:80px;line-height:.92;white-space:nowrap;font-family:var(--display);font-weight:800;text-transform:uppercase')}
${rev(at + 1.95, 'Only the<br>winner pays.', 'left:1450px;top:430px;font-size:80px;line-height:.92;white-space:nowrap;font-family:var(--display);font-weight:800;text-transform:uppercase;color:var(--orange)')}
<div class="abs hr" style="--d:${at + 2.1}s;--len:.7s;left:120px;top:990px;width:1680px;height:3px"></div>`;
}

/** Outro: logo, then the three links as ledger lines. Under 3 s. */
export function outroBody(th, at = 0) {
  const v = th.variant;
  const row = (i, k, url) => `
<div class="abs hr" style="--d:${at + 1.2 + i * 0.16}s;--len:.7s;left:120px;top:${560 + i * 120}px;width:1680px;height:3px"></div>
<div class="abs cap fade" style="--d:${at + 1.4 + i * 0.16}s;left:120px;top:${594 + i * 120}px;font-size:22px">${k}</div>
${rev(at + 1.35 + i * 0.16, url, `left:420px;top:${580 + i * 120}px;font-size:84px;font-family:var(--display);font-weight:800;text-transform:uppercase;line-height:1;white-space:nowrap`)}`;
  return `
<div class="abs" style="left:96px;top:60px;width:900px">${logoSvg({ variant: v, start: at })}</div>
${row(0, 'Web app', 'gavel.dualmindlab.tech')}
${row(1, 'Docs', 'docs.gavel.dualmindlab.tech')}
${row(2, 'Source', 'github.com/harshbhx/gavel-auction')}
<div class="abs hr" style="--d:${at + 1.9}s;--len:.6s;left:120px;top:920px;width:1680px;height:3px"></div>
<div class="abs cap fade" style="--d:${at + 2.1}s;left:120px;top:950px;font-size:22px">PayPal sandbox only. Bids are held, not charged.</div>`;
}
