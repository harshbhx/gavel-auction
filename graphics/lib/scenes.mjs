// Scene bodies shared by the brand video, the README reel and the Devpost set. All are laid out on a
// 1920x1080 stage; callers scale them down with a wrapper when they need a smaller canvas.
import { logoSvg, rule } from './motion.mjs';

export const W = 1920;
export const H = 1080;

/** Logo sting: the Mallet G assembles, strikes, locks; the wordmark and tagline resolve. 5 s. */
export function introBody(th, at = 0) {
  const v = th.variant;
  return `
<div class="abs" style="left:340px;top:210px;width:1240px">${logoSvg({ variant: v, start: at + 0.15 })}</div>
<div class="abs disp rise" style="--d:${at + 3.2}s;left:0;right:0;top:700px;text-align:center;font-size:92px">Every bid is a PayPal hold. <span class="or">Only the winner pays.</span></div>
<div class="abs mono rise lab" style="--d:${at + 3.7}s;left:0;right:0;top:830px;text-align:center;font-size:24px">PayPal sandbox only. No real money moves.</div>
<div class="abs" style="left:240px;bottom:90px">${rule(1440, at + 3.9, 6)}</div>`;
}

/** Outro: logo, then the three links click in. 5 s. */
export function outroBody(th, at = 0) {
  const v = th.variant;
  const row = (i, k, url) => `
<div class="abs rise" style="--d:${at + 2.5 + i * 0.28}s;left:300px;top:${560 + i * 118}px;width:1320px;display:flex;align-items:baseline;gap:36px;border-top:3px solid var(--ink);padding-top:16px">
  <span class="lab" style="width:190px;font-size:24px">${k}</span><span class="disp" style="font-size:62px;letter-spacing:.02em">${url}</span></div>`;
  return `
<div class="abs" style="left:490px;top:110px;width:940px">${logoSvg({ variant: v, start: at + 0.1 })}</div>
${row(0, 'Web app', 'gavel.dualmindlab.tech')}
${row(1, 'Docs', 'docs.gavel.dualmindlab.tech')}
${row(2, 'Source', 'github.com/harshbhx/gavel-auction')}
<div class="abs mono lab rise" style="--d:${at + 3.6}s;left:0;right:0;top:960px;text-align:center;font-size:22px">PayPal sandbox only. Bids are held, not charged.</div>
<div class="abs" style="left:240px;bottom:44px">${rule(1440, at + 3.9, 6)}</div>`;
}
