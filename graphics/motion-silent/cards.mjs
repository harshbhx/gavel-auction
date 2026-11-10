// Type cards of the silent video: title, problem, evidence, open items, the judge API, credits.
// Each card is a pure function of time on the shared motion runtime (see motion-devpost/runtime.js).
// `settle` is the second after which nothing moves any more; the composer holds the last frame.
import { ln, rule, lockupLetters } from './kit.mjs';

const L = lockupLetters();

/** The animated lockup (mallet G strikes, letters rise, rings leave the strike). 1.5x of the ending slide. */
const lockup = (x, y, scale, id) => `
<div class="a" style="left:${x}px;top:${y}px;width:688px;height:220px;transform:scale(${scale});transform-origin:0 0">
  <div class="a" style="left:110px;top:110px;width:0;height:0">
    <div class="wave" style="position:absolute;left:0;top:0;width:240px;height:240px;border-radius:50%;border:1.5px solid #ff6a1f;opacity:0"></div>
    <div class="wave" style="position:absolute;left:0;top:0;width:240px;height:240px;border-radius:50%;border:1px solid #ff6a1f;opacity:0"></div>
  </div>
  <div id="${id}" style="position:absolute;left:0;top:0;width:688px;height:220px"></div>
</div>`;
const lockupJs = (id) => `
var LETTERS = ${JSON.stringify(L)};
var mk, waves, lets = [];
function lockupSetup(h){
  var host = h.$('#${id}');
  host.innerHTML = '<div id="${id}m" style="position:absolute;left:0;top:0;width:220px;height:220px"></div><svg viewBox="-22 -22 450.24 144" style="position:absolute;left:0;top:0;width:688px;height:220px;overflow:visible"><g transform="translate(31 13) scale(0.74)">' + LETTERS.slice(1).map(function(l){ return '<g class="lt">' + l + '</g>'; }).join('') + '</g></svg>';
  mk = h.Mark(h.$('#${id}m'), {size:220, swingStart:.25, swingDur:.85});
  lets = h.$$('.lt');
  waves = h.Waves(h.$$('.wave'), [mk.strike], {min:.45, max:7.5, dur:1.6, alpha:.8});
}
function lockupUpdate(t,h){
  mk.update(t); waves(t);
  lets.forEach(function(g,i){
    var p = h.pr(t, 0.95 + i*0.07, 0.6, h.E.o5);
    g.setAttribute('transform', 'translate(' + h.lerp(-60, 0, p).toFixed(2) + ' 0)');
    g.setAttribute('opacity', Math.min(1, p*2.5));
  });
}`;

/* ---------- title ---------- */
export const title = {
  name: 'title',
  settle: 3.4,
  html: `
${lockup(96, 150, 1.5, 'lk')}
${rule({ x: 96, y: 520, w: 1728, a: 1.1, d: 0.9 })}
${ln('Every bid is a <span class="or">hold.</span>', { x: 90, y: 560, size: 210, a: 1.25, d: 0.9, w: 1750 })}
${ln('The hammer is the payment.', { x: 92, y: 760, size: 150, a: 1.6, d: 0.9, w: 1750 })}`,
  js: `${lockupJs('lk')}
function setup(h){ lockupSetup(h); }
function update(t,h){ lockupUpdate(t,h); }`,
};

/* ---------- problem ---------- */
const ROWS = [
  ['Charge a card up front,', 'and bidders <span class="or">hold back.</span>'],
  ['Leave bids unsecured,', 'and winners <span class="or">walk away.</span>'],
  ['Shout bids on paper sheets,', 'and the record is <span class="or">hard to trust.</span>'],
];
export const problem = {
  name: 'problem',
  settle: 7.8,
  html:
    ROWS.map((r, i) => {
      const y = 136 + i * 286;
      const a = 0.6 + i * 2.6;
      return (
        rule({ x: 96, y, w: 1728, a, d: 0.7 }) +
        ln(`0${i + 1}`, {
          x: 96,
          y: y + 30,
          size: 24,
          fam: 'm',
          color: 'var(--mute)',
          w: 80,
          a: a + 0.1,
        }) +
        ln(r[0], { x: 240, y: y + 24, size: 104, a: a + 0.15, d: 0.8, w: 1560 }) +
        ln(r[1], { x: 240, y: y + 24 + 98, size: 104, a: a + 0.3, d: 0.8, w: 1560 })
      );
    }).join('') + rule({ x: 96, y: 136 + 3 * 286 - 6, w: 1728, a: 7.2, d: 0.7 }),
  js: `function setup(h){} function update(t,h){}`,
};

/* ---------- evidence ---------- */
const EVID = [
  {
    w: 'Kill survived',
    t: 'A real server kill during settlement, on the PayPal sandbox: one capture, two holds voided, a ledger of 19 entries that verifies.',
    s: 'docs/GATES.md. Run 42558021614',
  },
  {
    w: 'Live voice 24 of 24',
    t: 'Both speech providers answered 24 of 24 synthetic clips through the live socket. No bid accepted without a confirm.',
    s: 'docs/GATES.md. Run 42575018866. Synthetic audio only',
  },
  {
    w: 'Ledger verified',
    t: 'Every bid joins a hash chain. Anyone can check it again, and an edited entry is marked.',
    s: 'Verify page and ledger lab in the app',
  },
  {
    w: 'Latency, honestly',
    t: 'Hammer to captured p95 3.8 s against a 2.5 s target. Hammer to settled p95 6.9 s against 6 s. Both missed.',
    s: 'docs/GATES.md. Run 42563147792. 49 of 50 runs, incomplete',
  },
];
export const evidence = {
  name: 'evidence',
  settle: 12,
  html:
    EVID.map((r, i) => {
      const y = 128 + i * 218;
      const a = 0.5 + i * 3.0;
      return (
        rule({ x: 96, y, w: 1728, a, d: 0.7 }) +
        ln(`0${i + 1}`, {
          x: 96,
          y: y + 28,
          size: 22,
          fam: 'm',
          color: 'var(--mute)',
          w: 70,
          a: a + 0.1,
        }) +
        ln(r.w, { x: 170, y: y + 22, size: 104, a: a + 0.1, d: 0.8, w: 840 }) +
        `<div class="a b" data-a="${a + 0.35}" data-d=".6" style="left:1060px;top:${y + 26}px;width:764px;font-size:29px;line-height:38px;font-weight:600">${r.t}</div>` +
        ln(r.s, {
          x: 1060,
          y: y + 178,
          size: 15,
          fam: 'm',
          color: 'var(--mute);text-transform:none',
          w: 764,
          a: a + 0.5,
        })
      );
    }).join('') + rule({ x: 96, y: 128 + 4 * 218 - 6, w: 1728, a: 11.8, d: 0.5 }),
  js: `function setup(h){} function update(t,h){}`,
};

/* ---------- open items ---------- */
const OPEN = [
  [
    'G3 in progress',
    'The honor-period probe is still timing. The final reading is about 12 Nov. No result is claimed.',
  ],
  [
    'G5 partial',
    'Speech is measured on synthetic, noise-free audio only, and every spoken bid is confirmed.',
  ],
  [
    'Sandbox only',
    'No real money moves. A full multi-bidder settlement has not been run end to end on the PayPal sandbox; it is shown on the fake PayPal.',
  ],
];
export const open = {
  name: 'open',
  settle: 7.8,
  html:
    ln('What is still open', {
      x: 96,
      y: 140,
      size: 30,
      a: 0.2,
      d: 0.8,
      fam: 'm',
      color: 'var(--orange)',
      w: 1700,
    }) +
    OPEN.map((r, i) => {
      const y = 214 + i * 250;
      const a = 0.6 + i * 2.5;
      return (
        rule({ x: 96, y, w: 1728, a, d: 0.7 }) +
        ln(r[0], { x: 96, y: y + 26, size: 124, a: a + 0.1, d: 0.8, w: 900 }) +
        `<div class="a b" data-a="${a + 0.3}" data-d=".6" style="left:1060px;top:${y + 34}px;width:764px;font-size:31px;line-height:41px;font-weight:600">${r[1]}</div>`
      );
    }).join('') +
    rule({ x: 96, y: 214 + 3 * 250 - 6, w: 1728, a: 7.5, d: 0.5 }),
  js: `function setup(h){} function update(t,h){}`,
};

/* ---------- judge API terminal ---------- */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function apiCard(api) {
  const cmds = [
    {
      c: `curl -s -X POST $API/api/judge/rooms -H "x-judge-key: $KEY" -d '{"title":"My lot"}'`,
      o: api?.create
        ? JSON.stringify({
            auctionId: api.create.body.auctionId,
            joinCode: api.create.body.joinCode,
            auctioneerToken: api.create.body.auctioneerToken,
          })
        : '{ "auctionId": "...", "joinCode": "..." }',
    },
    {
      c: `curl -s -X POST $API/api/judge/rooms/$ID/bids -H "authorization: Bearer $TOKEN" -d '{"amount":1500}'`,
      o: api?.bid
        ? JSON.stringify({
            accepted: api.bid.body?.accepted,
            amount: api.bid.body?.amount,
            seq: api.bid.body?.seq,
          })
        : '{ "accepted": true }',
    },
    {
      c: `curl -s $API/api/judge/rooms/$ID/ledger -H "authorization: Bearer $REVIEWER"`,
      o: api?.ledger
        ? JSON.stringify({ count: api.ledger.count, headHash: api.ledger.headHash })
        : '{ "count": 5 }',
    },
  ];
  return {
    name: 'api',
    settle: 7.4,
    html:
      ln('A key. HTTP. <span class="or">JSON.</span>', {
        x: 90,
        y: 128,
        size: 130,
        a: 0.2,
        d: 0.8,
        w: 1750,
      }) +
      `<div class="a" data-a="0.5" data-d=".5" style="left:96px;top:300px;width:1728px;height:560px;background:#1d1712"></div>` +
      `<div class="a m" data-a="0.7" data-d=".5" style="left:132px;top:322px;font-size:17px;color:#cbbfa6;letter-spacing:.1em">Judge API. Local run on the CI stack. Sandbox. Tokens cut</div>` +
      `<div id="term" class="a" style="left:132px;top:372px;width:1660px;font-family:var(--mono);font-weight:500;font-size:27px;line-height:40px;color:#efe6d3;white-space:pre-wrap;word-break:break-all"></div>`,
    js: `
var CMDS = ${JSON.stringify(cmds.map((x) => ({ c: esc(x.c), o: esc(x.o.length > 150 ? x.o.slice(0, 147) + '...' : x.o) })))};
var term;
function setup(h){ term = h.$('#term'); }
function update(t,h){
  var out = '', t0 = 1.0;
  for (var i=0;i<CMDS.length;i++){
    var cs = t0, cd = Math.min(1.4, CMDS[i].c.length*0.008+0.4);
    var n = Math.max(0, Math.min(CMDS[i].c.length, Math.floor((t-cs)/cd*CMDS[i].c.length)));
    if (t < cs) break;
    out += '<span style="color:#ff6a1f">$ </span>' + CMDS[i].c.slice(0,n) + '\\n';
    var os = cs + cd + 0.3;
    if (t >= os) out += '<span style="color:#cbbfa6">' + CMDS[i].o + '</span>\\n\\n';
    else break;
    t0 = os + 0.75;
  }
  term.innerHTML = out;
}`,
  };
}

/* ---------- credits ---------- */
const LINKS = [
  ['Web app', 'gavel.dualmindlab.tech'],
  ['Docs', 'docs.gavel.dualmindlab.tech'],
  ['Source', 'github.com/harshbhx/gavel-auction'],
];
export const credits = {
  name: 'credits',
  settle: 5.4,
  html: `
${lockup(96, 140, 1.0, 'lk')}
${ln('Built by Harsh Bhanushali', { x: 90, y: 380, size: 118, a: 1.5, d: 0.9, w: 1750 })}
${ln('and Dhairya Patel.', { x: 90, y: 484, size: 118, a: 1.65, d: 0.9, w: 1750 })}
${LINKS.map((l, i) => {
  const y = 640 + i * 92;
  return (
    rule({ x: 96, y, w: 1728, a: 2.4 + i * 0.25, d: 0.7 }) +
    ln(l[0], {
      x: 96,
      y: y + 36,
      size: 20,
      fam: 'm',
      color: 'var(--mute)',
      w: 260,
      a: 2.5 + i * 0.25,
    }) +
    ln(l[1], {
      x: 380,
      y: y + 14,
      size: 62,
      a: 2.5 + i * 0.25,
      d: 0.8,
      w: 1440,
      color: 'var(--ink);text-transform:lowercase',
    })
  );
}).join('')}
${rule({ x: 96, y: 640 + 3 * 92, w: 1728, a: 3.3, d: 0.7 })}
${ln('PayPal sandbox only. G3 in progress, G5 partial: synthetic speech only.', { x: 96, y: 936, size: 22, fam: 'm', color: 'var(--orange)', w: 1700, a: 3.6 })}`,
  js: `${lockupJs('lk')}
function setup(h){ lockupSetup(h); }
function update(t,h){ lockupUpdate(t,h); }`,
};
