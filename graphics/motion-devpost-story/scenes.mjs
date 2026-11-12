// Story scenes: a banner (1600x500) and eight inline illustrations (1000x560), one per section of the Devpost
// description. Art direction: a printed auction-house broadside. Flat paper, black ink, one orange accent, huge
// display type set tight and revealed through masks, hairline rules that draw themselves, numerals that count.
// No cards, chips, glow or shadows. Each scene: name, W, H, T (loop seconds), poster (second for the still),
// html, js (LIB helpers + setup/update). Scenes are pure functions of time (graphics/motion-devpost/runtime.js).
import { asset } from './kit.mjs';

const S = { W: 1000, H: 560 };
const ORANGE = 'var(--orange)';

/** Display line revealed through a mask: the text rises out of a clipped box. */
const M = (t, style, inner, d = 0.8) =>
  `<div class="a mk" data-t="${t}" data-d="${d}" style="overflow:hidden;padding-bottom:.09em;${style}"><span style="display:block">${inner}</span></div>`;
/** Hairline rule that draws itself left to right. */
const R = (t, d, style, color = 'var(--ink)', h = 1.5) =>
  `<div class="a rl" data-t="${t}" data-d="${d}" style="height:${h}px;background:${color};transform-origin:0 50%;transform:scaleX(0);${style}"></div>`;
/** Text that fades in. */
const F = (t, d, style, inner, cls = '') =>
  `<div class="a fd ${cls}" data-t="${t}" data-d="${d}" style="opacity:0;${style}">${inner}</div>`;
const DISP = 'font:800 {S}px/.9 var(--display);text-transform:uppercase;letter-spacing:.004em;';
const disp = (n) => DISP.replace('{S}', n);

/** Running head and foot of the broadside. */
const frame = (section, no, sandbox = true) =>
  F(0, 0.5, 'left:56px;top:28px', `<span class="lab">GAVEL &nbsp;/&nbsp; ${section}</span>`) +
  F(0, 0.5, 'right:56px;top:28px', `<span class="lab">${no} / 08</span>`) +
  R(0.05, 0.9, 'left:56px;width:888px;top:52px') +
  (sandbox
    ? F(
        0.4,
        0.5,
        'left:56px;bottom:26px',
        '<span class="lab" style="color:var(--muted)">PayPal sandbox only</span>',
      )
    : '');

const LIB = `
function L(t,h){
  h.$('#w').style.opacity = 1 - h.exitp(t);
  h.$$('.mk').forEach(function(m){ var p = h.pr(t, +m.dataset.t, +(m.dataset.d||.8), h.E.o5); m.firstElementChild.style.transform = 'translateY(' + ((1-p)*(+m.dataset.y||110)).toFixed(2) + '%)'; });
  h.$$('.rl').forEach(function(r){ var p = h.pr(t, +r.dataset.t, +(r.dataset.d||.8), h.E.io); r.style.transform = 'scaleX(' + p.toFixed(4) + ')'; });
  h.$$('.fd').forEach(function(f){ f.style.opacity = h.pr(t, +f.dataset.t, +(f.dataset.d||.5), h.E.o2); });
  h.$$('.cn').forEach(function(c){ var p = h.pr(t, +c.dataset.t, +(c.dataset.d||1), h.E.o4); var v = +c.dataset.f + (+c.dataset.v - +c.dataset.f)*p; c.textContent = (c.dataset.p||'') + Math.round(v) + (c.dataset.s||''); });
}
`;

/* ---------- 00 banner ---------- */
export const banner = {
  name: '00-story-banner',
  W: 1600,
  H: 500,
  T: 5,
  poster: 3.4,
  html: `
<div class="a" id="g" style="left:90px;top:50px;width:400px;height:400px"></div>
${R(0.2, 1.0, 'left:620px;width:884px;top:52px')}
${F(0.2, 0.6, 'left:620px;top:26px', '<span class="lab">The Devpost story &nbsp;/&nbsp; Auction holds, hammer and receipts</span>')}
${M(0.3, 'left:620px;top:84px;font:800 138px/.86 var(--display);text-transform:uppercase;width:900px', 'Every bid')}
${M(0.45, 'left:620px;top:204px;font:800 138px/.86 var(--display);text-transform:uppercase;width:900px', 'is a <span class="or">hold.</span>')}
${R(1.2, 0.9, 'left:620px;width:884px;top:362px')}
${M(1.4, 'left:620px;top:378px;font:600 44px/1.1 var(--body);letter-spacing:-.015em;width:900px', 'The hammer is the payment.', 0.7)}
${F(2.0, 0.5, 'left:620px;bottom:30px', '<span class="lab" style="color:var(--muted)">PayPal sandbox only</span>')}
`,
  js: `${LIB}
var mk;
function setup(h){ mk = h.Mark(h.$('#g'), {size:400, swingStart:.28, swingDur:.9, echoes:[2.9]}); }
function update(t,h){ L(t,h); mk.update(t); }
`,
};

/* ---------- 01 inspiration ---------- */
export const inspiration = {
  name: '01-inspiration',
  ...S,
  T: 4.4,
  poster: 3.3,
  html: `${frame('Inspiration', '01')}
<div class="a mk" data-t=".05" data-d="1" data-y="150" style="left:48px;top:calc(100px - .14em);overflow:hidden;font:800 300px/.84 var(--display);padding:.14em 0 .16em"><span style="display:block"><span class="cn" data-t=".15" data-d="1.1" data-f="0" data-v="20" data-p="$">$0</span></span></div>
${M(0.3, 'left:650px;top:110px;' + disp(64) + 'width:300px', 'A bid is')}
${M(0.42, 'left:650px;top:172px;' + disp(64) + 'width:300px', 'a promise.')}
${R(0.9, 0.9, 'left:56px;width:888px;top:392px')}
${R(1.7, 1.0, 'left:56px;width:888px;top:389px', ORANGE, 6)}
${F(1.0, 0.4, 'left:56px;top:408px', '<span class="lab">Bid placed</span>')}
${F(2.5, 0.4, 'right:56px;top:408px', '<span class="lab">Hold on PayPal</span>')}
${M(2.0, 'left:56px;top:438px;' + disp(72) + 'width:888px', 'Held, <span class="or">not charged.</span>', 0.8)}
`,
  js: `${LIB}
function update(t,h){ L(t,h); }
`,
};

/* ---------- 02 what it does ---------- */
const shots = [
  ['readme/see-it-run-2-hold.png', 'Hold', 'Approve a hold for your ceiling.'],
  ['readme/see-it-run-3-bids.png', 'Bid', 'Prices only go up.'],
  ['readme/see-it-run-4-hammer.png', 'Hammer', 'The winner is named.'],
  ['readme/see-it-run-6-receipt.png', 'Receipt', 'A proof you can share.'],
];
export const whatItDoes = {
  name: '02-what-it-does',
  ...S,
  T: 4.8,
  poster: 3.9,
  html: `${frame('What it does', '02')}
<div class="a" style="left:410px;top:76px;width:590px;height:484px;overflow:hidden"><div id="shots" class="a" style="left:0;top:0;width:590px;height:484px"></div></div>
<div id="steps"></div>
`,
  js: `${LIB}
var SH = ${JSON.stringify(shots.map(([f, k, c]) => [asset('docs/assets/' + f), k, c]))};
var act = [.35, 1.35, 2.35, 3.35];
var imgs = [], rows = [], cap = [], num = [];
function setup(h){
  var s = '';
  SH.forEach(function(f,i){ s += '<div class="im a" style="left:0;top:0;width:590px;height:484px;overflow:hidden;z-index:' + i + '"><img src="' + f[0] + '" style="position:absolute;left:0;top:0;width:820px;height:auto;display:block"></div>'; });
  h.$('#shots').innerHTML = s; imgs = h.$$('.im');
  var r = '';
  SH.forEach(function(f,i){ r += '<div class="a rw" style="left:56px;top:' + (84 + i*100) + 'px;width:340px"><div class="lab nm" style="margin-bottom:8px;color:var(--muted)">0' + (i+1) + '</div><div style="font:800 76px/.88 var(--display);text-transform:uppercase;letter-spacing:.004em">' + f[1] + '</div><div class="cap" style="margin-top:6px">' + f[2] + '</div></div>'; });
  h.$('#steps').innerHTML = r; rows = h.$$('.rw');
}
function update(t,h){
  L(t,h);
  imgs.forEach(function(im,k){
    var p = k === 0 ? h.pr(t, .1, .7, h.E.io) : h.pr(t, act[k]-.1, .55, h.E.io);
    im.style.clipPath = 'inset(0 ' + ((1-p)*100).toFixed(2) + '% 0 0)';
  });
  rows.forEach(function(r,k){
    var on = h.pr(t, act[k]-.05, .3, h.E.o3);
    var past = k < 3 ? h.pr(t, act[k+1]-.05, .3, h.E.o3) : 0;
    var en = h.pr(t, .1 + k*.08, .6, h.E.o4);
    r.style.opacity = en * (.2 + .8*on*(1 - .75*past));
    r.style.transform = 'translateY(' + ((1-en)*24).toFixed(2) + 'px)';
    r.querySelector('.nm').style.color = on > .5 && past < .5 ? '#ff6a1f' : '#5a4d3f';
    r.querySelector('.cap').style.opacity = on * (1 - past);
  });
}
`,
};

/* ---------- 03 how we built it ---------- */
const nodes = [
  ['Cloudflare', 'Workers: web and docs', 56, 112],
  ['Render', 'API and auction engine', 380, 112],
  ['PayPal', 'Sandbox holds and capture', 700, 112],
  ['AG Grid', 'The ledger grid', 56, 372],
  ['Hugging Face', 'Open datasets', 640, 372],
];
export const stack = {
  name: '03-how-we-built-it',
  ...S,
  T: 5,
  poster: 3.6,
  html: `${frame('How we built it', '03')}
<svg class="a" id="wires" width="1000" height="560" viewBox="0 0 1000 560" style="left:0;top:0"></svg>
${nodes
  .map(
    ([n, sub, x, y], i) =>
      M(0.15 + i * 0.12, `left:${x}px;top:${y}px;${disp(54)}width:330px`, n, 0.8) +
      F(0.5 + i * 0.12, 0.5, `left:${x}px;top:${y + 60}px`, `<span class="cap">${sub}</span>`),
  )
  .join('')}
${M(1.0, 'left:56px;top:470px;' + disp(34) + 'width:700px', 'One stack, <span class="or">five parts.</span>', 0.8)}
`,
  js: `${LIB}
var PATHS = ['M 292 138 H 366', 'M 528 138 H 692', 'M 392 205 V 398 H 232', 'M 600 205 V 398 H 630'];
var START = [.6, .9, 1.3, 1.6];
function setup(h){
  var s = '';
  PATHS.forEach(function(d){ s += '<path class="bs" d="' + d + '" fill="none" stroke="#1d1712" stroke-width="1.5"/><path class="fl" pathLength="1" d="' + d + '" fill="none" stroke="#ff6a1f" stroke-width="3.5" stroke-dasharray="1" stroke-dashoffset="1"/><circle class="dt" r="6" fill="#ff6a1f" opacity="0"/>'; });
  h.$('#wires').innerHTML = s;
}
function update(t,h){
  L(t,h);
  var bs = h.$$('.bs'), fl = h.$$('.fl'), dt = h.$$('.dt');
  PATHS.forEach(function(d,i){
    bs[i].setAttribute('opacity', h.pr(t, .4, .4));
    fl[i].setAttribute('stroke-dashoffset', 1 - h.pr(t, START[i], .6, h.E.io));
    var u = (t - START[i] - .6) / 1.4; var on = u > 0 ? 1 : 0; u = u - Math.floor(u);
    var L0 = bs[i].getTotalLength(); var p = bs[i].getPointAtLength(L0 * h.E.io(u));
    dt[i].setAttribute('cx', p.x); dt[i].setAttribute('cy', p.y);
    dt[i].setAttribute('opacity', on * Math.min(1, u*8) * Math.min(1, (1-u)*8));
  });
}
`,
};

/* ---------- 04 challenges: the race ---------- */
export const race = {
  name: '04-challenges',
  ...S,
  T: 4.6,
  poster: 3.5,
  html: `${frame('Challenges', '04')}
${M(0.1, 'left:56px;top:76px;' + disp(66) + 'width:800px', 'Two bids at once.')}
${M(0.22, 'left:56px;top:140px;' + disp(66) + 'width:800px', '<span class="or">One winner.</span>')}
<div class="a" id="vr" style="left:500px;top:228px;width:1.5px;height:230px;background:var(--ink);transform-origin:50% 0;transform:scaleY(0)"></div>
${F(0.9, 0.4, 'left:56px;top:238px', '<span class="lab">Paddle 12</span>')}
${F(0.9, 0.4, 'left:524px;top:238px', '<span class="lab">Paddle 7</span>')}
<div class="a" id="na" style="left:0;top:calc(284px - .14em);overflow:hidden;font:800 182px/.84 var(--display);padding:.14em 0 .16em;white-space:nowrap">$25</div>
<div class="a" id="nb" style="left:0;top:calc(284px - .14em);overflow:hidden;font:800 182px/.84 var(--display);padding:.14em 0 .16em;white-space:nowrap">$25</div>
<div class="a" id="sk" style="left:524px;top:352px;width:0;height:6px;background:var(--ink)"></div>
<div class="a" id="ua" style="left:56px;top:452px;width:0;height:6px;background:var(--orange)"></div>
${F(2.3, 0.4, 'left:56px;top:470px', '<span class="lab">Entry 41 &nbsp;/&nbsp; accepted</span>')}
${F(2.4, 0.4, 'left:524px;top:470px', '<span class="lab" style="color:var(--muted)">Refused &nbsp;/&nbsp; not higher</span>')}
${M(0.6, 'right:56px;top:152px;font:600 24px/1.2 var(--body);text-align:right;width:420px', 'The engine takes bids in order.', 0.7)}
`,
  js: `${LIB}
function update(t,h){
  L(t,h);
  h.$('#vr').style.transform = 'scaleY(' + h.pr(t, .3, .7, h.E.io) + ')';
  var a = h.pr(t, .15, .85, h.E.o5), b = h.pr(t, .25, .85, h.E.o5);
  var na = h.$('#na'), nb = h.$('#nb');
  na.style.transform = 'translateX(' + (-520 * (1-a)) + 'px)'; na.style.left = '48px';
  nb.style.transform = 'translateX(' + (520 * (1-b)) + 'px)'; nb.style.left = '516px';
  na.style.opacity = a; nb.style.opacity = b * (1 - .75 * h.pr(t, 2.0, .4, h.E.o3));
  h.$('#sk').style.width = (400 * h.pr(t, 1.9, .5, h.E.io)) + 'px';
  h.$('#ua').style.width = (400 * h.pr(t, 2.0, .6, h.E.io)) + 'px';
}
`,
};

/* ---------- 05 accomplishments ---------- */
export const proof = {
  name: '05-accomplishments',
  ...S,
  T: 4.8,
  poster: 3.8,
  html: `${frame('Accomplishments', '05')}
${[
  [
    'Kill <span class="or">survived.</span>',
    'A real server kill on the sandbox. One capture, ledger intact.',
    0.15,
  ],
  [
    'Voice <span class="or cn" data-t=".95" data-d="1" data-f="0" data-v="24">0</span> of 24.',
    'Live voice socket, 24 synthetic clips. Every spoken bid waits for a confirm.',
    1.0,
  ],
  [
    'Chain <span class="or">verifies.</span>',
    'Anyone holding the ledger export can re-check it.',
    1.85,
  ],
]
  .map(
    ([big, cap, t], i) =>
      R(t, 0.8, `left:56px;width:888px;top:${74 + i * 146}px`) +
      M(t + 0.1, `left:56px;top:${86 + i * 146}px;${disp(104)}width:888px`, big, 0.9) +
      F(t + 0.7, 0.5, `left:58px;top:${192 + i * 146}px`, `<span class="cap">${cap}</span>`),
  )
  .join('')}
`,
  js: `${LIB}
function update(t,h){ L(t,h); }
`,
};

/* ---------- 06 what we learned ---------- */
export const learned = {
  name: '06-what-we-learned',
  ...S,
  T: 4.8,
  poster: 3.5,
  html: `${frame('What we learned', '06')}
${M(0.1, 'left:56px;top:84px;' + disp(66) + 'width:700px', 'Events arrive twice.')}
${M(0.22, 'left:56px;top:148px;' + disp(66) + 'width:700px', 'We count once.')}
<div class="a mk" data-t=".2" data-d=".9" style="right:56px;top:70px;overflow:hidden;font:800 270px/.84 var(--display);padding-bottom:.06em;color:var(--orange);text-align:right"><span style="display:block"><span class="cn" data-t="2.4" data-d=".01" data-f="2" data-v="1">2</span></span></div>
${R(0.9, 0.8, 'left:56px;width:888px;top:292px')}
${F(1.0, 0.4, 'left:56px;top:312px', '<span class="mono" style="font:600 22px/1 var(--mono)">capture.done</span>')}
${F(1.05, 0.4, 'left:330px;top:314px', '<span class="cap">evt_8f2a</span>')}
${F(1.5, 0.4, 'right:56px;top:314px', '<span class="lab">Counted &nbsp;/&nbsp; entry 41</span>')}
${R(1.4, 0.8, 'left:56px;width:888px;top:352px')}
${F(1.8, 0.4, 'left:56px;top:372px', '<span class="mono" style="font:600 22px/1 var(--mono)">capture.done</span>')}
${F(1.85, 0.4, 'left:330px;top:374px', '<span class="cap">evt_8f2a</span>')}
${F(2.5, 0.4, 'right:56px;top:374px', '<span class="lab" style="color:var(--muted)">Duplicate &nbsp;/&nbsp; ignored</span>')}
<div class="a" id="sk" style="left:56px;top:383px;width:0;height:3px;background:var(--ink)"></div>
${R(2.2, 0.8, 'left:56px;width:888px;top:412px')}
${M(2.9, 'left:56px;top:446px;font:600 26px/1.2 var(--body);width:700px', 'The journal decides, not the event.', 0.7)}
`,
  js: `${LIB}
function update(t,h){
  L(t,h);
  h.$('#sk').style.width = (400 * h.pr(t, 2.2, .5, h.E.io)) + 'px';
}
`,
};

/* ---------- 07 what is next ---------- */
const nexts = [
  ['G3 passed', 'Capturable at 3.5, 4 and 5 days; reauthorize accepted.', 'Passed'],
  ['Real-room voice', 'Speech on noisy, real bids (G5).', 'Next'],
  ['Deployed-host kill', 'A whole auction on the live host, killed and resumed.', 'Next'],
];
export const next = {
  name: '07-what-is-next',
  ...S,
  T: 4.6,
  poster: 3.3,
  html: `${frame('What is next', '07')}
${nexts
  .map(
    ([n, d, st], i) =>
      F(
        0.1 + i * 0.3,
        0.4,
        `left:56px;top:${94 + i * 140}px`,
        `<span class="lab" style="color:var(--muted)">0${i + 1}</span>`,
      ) +
      M(0.15 + i * 0.3, `left:100px;top:${80 + i * 140}px;${disp(84)}width:760px`, n, 0.8) +
      F(0.7 + i * 0.3, 0.4, `left:102px;top:${164 + i * 140}px`, `<span class="cap">${d}</span>`) +
      F(
        0.5 + i * 0.3,
        0.4,
        `right:56px;top:${96 + i * 140}px`,
        `<span class="lab" ${i ? 'style="color:var(--muted)"' : ''}>${st}</span>`,
      ) +
      R(0.3 + i * 0.3, 0.9, `left:56px;width:888px;top:${200 + i * 140}px`),
  )
  .join('')}
<div class="a" id="run" style="left:56px;top:197px;width:0;height:6px;background:var(--orange)"></div>
`,
  js: `${LIB}
function update(t,h){
  L(t,h);
  var p = h.pr(t, .9, 2.2, h.E.io);
  h.$('#run').style.width = (888 * p) + 'px';
}
`,
};

/* ---------- 08 built with ---------- */
const tools = [
  ['PayPal', 'Holds, capture, webhooks'],
  ['Cloudflare Workers', 'Web and docs'],
  ['Render', 'The auction API'],
  ['Hugging Face', 'Open datasets'],
  ['AG Grid', 'The ledger grid'],
];
export const builtWith = {
  name: '08-built-with',
  ...S,
  T: 4.8,
  poster: 3.2,
  html: `${frame('Built with', '08')}
${tools
  .map(
    ([n, r], i) =>
      R(0.1 + i * 0.12, 0.7, `left:56px;width:888px;top:${68 + i * 74}px`) +
      F(
        0.2 + i * 0.12,
        0.4,
        `left:56px;top:${96 + i * 74}px`,
        `<span class="lab" style="color:var(--muted)">0${i + 1}</span>`,
      ) +
      M(
        0.2 + i * 0.12,
        `left:100px;top:${76 + i * 74}px;${disp(66)}width:620px;white-space:nowrap`,
        `<span class="ln">${n}</span>`,
        0.7,
      ) +
      F(0.5 + i * 0.12, 0.4, `right:56px;top:${96 + i * 74}px`, `<span class="cap">${r}</span>`),
  )
  .join('')}
${R(0.8, 0.7, 'left:56px;width:888px;top:438px')}
${F(1.2, 0.5, 'left:56px;top:456px', '<span class="cap" style="color:var(--ink)">TypeScript &nbsp;/&nbsp; Node 22 &nbsp;/&nbsp; React &nbsp;/&nbsp; Vite &nbsp;/&nbsp; Vitest &nbsp;/&nbsp; Playwright &nbsp;/&nbsp; GitHub Actions</span>')}
${F(1.3, 0.5, 'left:56px;top:482px', '<span class="cap">PayPal APIs: Orders v2, Payments v2, Webhooks, JS SDK v6</span>')}
`,
  js: `${LIB}
function update(t,h){
  L(t,h);
  var lns = h.$$('.ln');
  var k = Math.floor(((t - 1.0) / .5));
  lns.forEach(function(el,i){ el.style.color = (t > 1.0 && i === k % 5 && k < 5 + 0) ? '#ff6a1f' : '#1d1712'; });
}
`,
};

export const all = [banner, inspiration, whatItDoes, stack, race, proof, learned, next, builtWith];
