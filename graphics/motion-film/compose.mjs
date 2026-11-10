// Composes the GAVEL launch film from the raw recording (graphics/motion-silent/record.mjs output)
// with Remotion. CI only (see .github/workflows/launch-film.yml); run from this directory after npm ci.
// Usage: FPS=60|30 [WEBM=1] node compose.mjs <rawDir> <outDir>
// 1. Resolves everything that depends on the recording into props.json: per scene the panes (actor
//    frames in the needed window, layout, device frame), the fast-forward speed, the named events in
//    scene seconds, the camera targets from the recorded element rectangles, the captions.
// 2. Links the recording, the app fonts and the brand SVGs into public/, renders with
//    `npx remotion render`, then writes the poster, SRT, timeline, contact sheets and report, and
//    re-encodes under a bitrate cap if the MP4 passes 48 MB.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const RAW = path.resolve(process.argv[2] ?? 'out/raw');
const OUT = path.resolve(process.argv[3] ?? 'out/final');
const FPS = Number(process.env.FPS || 60);
const WEBM = Boolean(process.env.WEBM);
const NAME = 'gavel-launch-film';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[film]', ...a);
const warn = [];
const W = 1920;
const H = 1080;

const sh = (cmd, args, label = cmd, opts = {}) => {
  log('$', cmd, args.join(' ').slice(0, 160));
  try {
    execFileSync(cmd, args, { stdio: 'inherit', cwd: here, ...opts });
  } catch {
    throw new Error(`${label} failed`);
  }
};
const ff = (args, label = 'ffmpeg') =>
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], label);

// ----------------------------------------------------------------------------- the recording
const meta = JSON.parse(readFileSync(path.join(RAW, 'meta.json'), 'utf8'));
const apiPath = path.join(RAW, 'api.json');
const api = existsSync(apiPath) ? JSON.parse(readFileSync(apiPath, 'utf8')) : null;
if (!api) warn.push('api.json missing: the judge terminal shows placeholder answers');
const markOf = Object.fromEntries(meta.marks.map((m) => [m.id, m]));
const evOf = Object.fromEntries(meta.events.map((e) => [e.id, e.t]));
const rectList = meta.rects ?? [];
if (rectList.length === 0)
  warn.push('meta.rects missing (older recording): camera targets fall back to the pane centre');

/** Frames of an actor between two recording times, as [ts, public path]. */
function framesOf(actor, t0, t1) {
  const a = meta.actors[actor];
  if (!a) return [];
  const fr = a.frames;
  let first = 0;
  while (first + 1 < fr.length && fr[first + 1][0] <= t0) first += 1;
  const out = [];
  for (let i = first; i < fr.length; i += 1) {
    if (fr[i][0] > t1) break;
    out.push([fr[i][0], `raw/${actor}/${fr[i][1]}`]);
  }
  if (out.length === 0 && fr.length)
    out.push([fr[fr.length - 1][0], `raw/${actor}/${fr[fr.length - 1][1]}`]);
  return out;
}

/** A recorded window: shot id, offset into it, the scene seconds it must fill. */
function window(shot, { from = 0, fill, speedMax = 2.4 } = {}) {
  const m = markOf[shot];
  if (!m || !m.ok) {
    warn.push(
      `shot ${shot} ${m ? 'failed: ' + m.note : 'missing'}; its panes read "recording unavailable"`,
    );
    return { ok: false, startAbs: 0, speed: 1, avail: 0 };
  }
  const startAbs = m.start + from;
  const avail = Math.max(0.1, m.end - startAbs);
  const speed = fill ? Math.min(speedMax, Math.max(1, avail / fill)) : 1;
  return { ok: true, startAbs, speed, avail };
}

// ----------------------------------------------------------------------------- layout
const WIN = { x: 64, y: 140, w: 1280, h: 720 };
const GAP = 24;
function sizeOf(p) {
  const a = meta.actors[p.actor];
  const ar = a ? a.w / a.h : 16 / 9;
  if (p.w) return { w: Math.round(p.w), h: Math.round(p.w / ar) };
  return { w: Math.round(p.h * ar), h: Math.round(p.h) };
}
/** Lays panes in a row centred in the 1280x720 window (phones get room for their device frame). */
function row(panes, win = WIN) {
  const sized = panes.map((p) => ({ ...p, ...sizeOf(p) }));
  const total =
    sized.reduce((n, p) => n + p.w + (p.kind === 'phone' ? 24 : 0), 0) + GAP * (sized.length - 1);
  let x = win.x + Math.round((win.w - total) / 2);
  return sized.map((p) => {
    const pad = p.kind === 'phone' ? 12 : 0;
    const out = { ...p, x: x + pad, y: win.y + Math.round((win.h - p.h) / 2) };
    x += p.w + pad * 2 + GAP;
    return out;
  });
}

/** Builds the PaneSpec list of one recorded segment. */
function panesOf(segId, win, laid, from, to) {
  return laid.map((p) => {
    const a = meta.actors[p.actor];
    const k = a ? p.w / a.w : 1;
    const rects = {};
    for (const r of rectList) {
      if (r.actor !== p.actor) continue;
      rects[r.id] = { x: p.x + r.x * k, y: p.y + r.y * k, w: r.w * k, h: r.h * k };
    }
    const srcDur = (to - from) * win.speed;
    return {
      id: p.id ?? p.actor,
      actor: p.actor,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      kind: p.kind ?? 'plate',
      label: p.label,
      from,
      to,
      startAbs: win.startAbs,
      speed: win.speed,
      frames: win.ok ? framesOf(p.actor, win.startAbs - 0.5, win.startAbs + srcDur + 0.5) : [],
      rects,
    };
  });
}

/** Scene second of a recorded event inside a segment, or the fallback. */
function at(win, from, name, fallback) {
  const t = evOf[name];
  if (t === undefined || !win.ok) {
    warn.push(`event ${name} missing; timed by default`);
    return fallback;
  }
  return +(from + (t - win.startAbs) / win.speed).toFixed(3);
}

/** Camera box: zoom z onto the centre of a rect (or a pane), clamped inside the frame. */
function focus(rect, z) {
  if (!rect) return null;
  const w = W / z;
  const h = H / z;
  let x = rect.x + rect.w / 2 - w / 2;
  let y = rect.y + rect.h / 2 - h / 2;
  x = Math.max(-40, Math.min(W - w + 40, x));
  y = Math.max(-40, Math.min(H - h + 40, y));
  return { x: +x.toFixed(1), y: +y.toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) };
}
const rectIn = (panes, paneId, rectId) => {
  const p = panes.find((q) => q.id === paneId);
  if (!p) return null;
  if (!p.rects[rectId]) {
    warn.push(`rect ${rectId} missing on ${paneId}; camera uses the pane`);
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  }
  return p.rects[rectId];
};
const paneBox = (panes, paneId, pad = 40) => {
  const p = panes.find((q) => q.id === paneId);
  return p ? { x: p.x - pad, y: p.y - pad, w: p.w + 2 * pad, h: p.h + 2 * pad } : null;
};

// ----------------------------------------------------------------------------- the scenes
const scenes = [];
const card = (id, dur, lines = []) =>
  scenes.push({ id, dur, world: 'ink', panes: [], cam: [], caps: [], ev: {}, data: {}, lines });

card('cold', 4.5, [
  { a: 0.3, b: 1.9, text: 'A bid is a promise.' },
  {
    a: 1.95,
    b: 4.5,
    text: 'Most bids cost nothing. A film by Harsh Bhanushali and Dhairya Patel.',
  },
]);
card('title', 7.5, [
  { a: 1.25, b: 7.5, text: 'GAVEL. Every bid is a hold. The hammer is the payment.' },
]);
card('problem', 9, [
  { a: 0.5, b: 3.3, text: 'Charge a card up front, and bidders hold back.' },
  { a: 3.4, b: 6.2, text: 'Leave bids unsecured, and winners walk away.' },
  { a: 6.3, b: 9, text: 'Shout bids on paper, and the record is hard to trust.' },
]);
card('idea', 10.5, [
  { a: 1.0, b: 2.7, text: 'Authorize a ceiling.' },
  { a: 2.7, b: 5.7, text: 'Bid under it.' },
  { a: 5.7, b: 7.3, text: 'Capture only the winner.' },
  {
    a: 7.3,
    b: 10.5,
    text: 'Release the rest. Orders v2 intent AUTHORIZE; Payments v2 capture with final_capture, void.',
  },
]);

// 5. open: /try (0 to 4.5) then the hub (4.5 to 9)
{
  const dur = 9;
  const cut = 4.5;
  const w1 = window('try', { fill: cut });
  const p1 = panesOf(
    'try',
    w1,
    row([{ id: 'host', actor: 'host', w: 1280, label: 'Judge. Sandbox page /try' }]),
    0,
    cut,
  );
  const w2 = window('hub', { fill: dur - cut });
  const p2 = panesOf(
    'hub',
    w2,
    row([{ id: 'hub', actor: 'host', w: 1280, label: 'Room hub' }]),
    cut,
    dur,
  );
  const clicked = at(w1, 0, 'try.clicked', 3.2);
  const start = rectIn(p1, 'host', 'try.start');
  const flaps = rectIn(p2, 'hub', 'hub.flaps');
  const qr = rectIn(p2, 'hub', 'hub.qr');
  const union =
    flaps && qr
      ? {
          x: Math.min(flaps.x, qr.x),
          y: Math.min(flaps.y, qr.y),
          w: Math.max(flaps.x + flaps.w, qr.x + qr.w) - Math.min(flaps.x, qr.x),
          h: Math.max(flaps.y + flaps.h, qr.y + qr.h) - Math.min(flaps.y, qr.y),
        }
      : flaps;
  scenes.push({
    id: 'open',
    dur,
    world: 'paper',
    chapter: { n: 1, name: 'Open' },
    panes: [...p1, ...p2],
    cam: [
      { at: 0, dur: 0, box: null },
      { at: Math.max(0.6, clicked - 1.8), dur: 1.4, box: focus(start, 1.9) },
      { at: cut, dur: 0, box: null },
      { at: cut + 1.2, dur: 1.5, box: focus(union, union && union.w > 700 ? 1.5 : 1.9) },
    ],
    caps: [
      {
        a: 0.4,
        b: cut - 0.2,
        text: 'A judge opens / **/try.**',
        sub: 'One tap, one sandbox room.',
      },
      { a: cut + 0.3, b: dur - 0.3, text: 'A **join code** / and a ticket QR.' },
    ],
    ev: { clicked, cut },
    data: {},
  });
}

// 6. join
{
  const dur = 9;
  const w = window('joinA', { fill: dur });
  const panes = panesOf(
    'joinA',
    w,
    row([
      { id: 'hub', actor: 'host', w: 860, label: 'Hub' },
      { id: 'phoneA', actor: 'phoneA', h: 700, kind: 'phone', label: 'Bidder A. Phone' },
    ]),
    0,
    dur,
  );
  scenes.push({
    id: 'join',
    dur,
    world: 'paper',
    chapter: { n: 2, name: 'Join' },
    panes,
    cam: [
      { at: 0, dur: 0, box: null },
      { at: 0.8, dur: dur - 1.6, box: focus(paneBox(panes, 'phoneA', 200), 1.12) },
    ],
    caps: [
      {
        a: 0.4,
        b: dur - 0.3,
        text: 'A bidder types / the **code.**',
        sub: 'Or scans the ticket QR.',
      },
    ],
    ev: {},
    data: {},
  });
}

// 7. hold
{
  const dur = 13.5;
  const w = window('holdA', { fill: dur });
  const panes = panesOf(
    'holdA',
    w,
    row([
      { id: 'screen', actor: 'screen', w: 860, label: 'Big screen' },
      { id: 'phoneA', actor: 'phoneA', h: 700, kind: 'phone', label: 'Bidder A. Phone' },
    ]),
    0,
    dur,
  );
  const ceiling = at(w, 0, 'holdA.ceiling', 3.0);
  const press = at(w, 0, 'holdA.press', 5.5);
  const released = at(w, 0, 'holdA.released', press + 3.4 / w.speed);
  const held = at(w, 0, 'holdA.held', released + 0.9);
  scenes.push({
    id: 'hold',
    dur,
    world: 'paper',
    chapter: { n: 3, name: 'Hold' },
    panes,
    cam: [
      { at: 0, dur: 0, box: null },
      {
        at: Math.max(0.5, ceiling - 1.4),
        dur: 1.2,
        box: focus(rectIn(panes, 'phoneA', 'holdA.ceiling'), 1.7),
      },
      {
        at: Math.max(ceiling + 0.2, press - 1.3),
        dur: 1.1,
        box: focus(rectIn(panes, 'phoneA', 'holdA.hold'), 2.2),
      },
      { at: released + 1.0, dur: 1.4, box: null },
    ],
    caps: [
      { a: 0.4, b: press - 0.5, text: 'Pick a **ceiling.**', sub: 'The most this bidder may bid.' },
      { a: press - 0.3, b: released + 0.2, text: 'Hold the button / **3 seconds.**' },
      { a: released + 0.3, b: dur - 0.3, text: '**Held,** / not charged.' },
    ],
    ev: { ceiling, press, released, held },
    data: {},
  });
}

// 8. bid: the console opens the lot (0 to 3), then the bids (3 to 15)
{
  const dur = 15;
  const cut = 3;
  const w1 = window('open', { fill: cut });
  const p1 = panesOf(
    'open',
    w1,
    row([{ id: 'console', actor: 'console', w: 1280, label: 'Auctioneer console' }]),
    0,
    cut,
  );
  const w2 = window('bids', { fill: dur - cut });
  const p2 = panesOf(
    'bids',
    w2,
    row([
      { id: 'phoneA', actor: 'phoneA', h: 640, kind: 'phone', label: 'Bidder A' },
      {
        id: 'phoneB',
        actor: 'phoneB',
        h: 640,
        kind: 'phone',
        label: 'Bidder B. Joined from the QR link',
      },
      { id: 'screen', actor: 'screen', w: 560, label: 'Big screen' },
    ]),
    cut,
    dur,
  );
  const b1 = at(w2, cut, 'bids.first', cut + 1.0);
  const b2 = at(w2, cut, 'bids.second', cut + 4.5);
  const b3 = at(w2, cut, 'bids.third', cut + 8.0);
  scenes.push({
    id: 'bid',
    dur,
    world: 'paper',
    chapter: { n: 4, name: 'Bid' },
    panes: [...p1, ...p2],
    cam: [
      { at: 0, dur: 0, box: null },
      { at: 0.5, dur: 1.2, box: focus(rectIn(p1, 'console', 'open.button'), 1.8) },
      { at: cut, dur: 0, box: null },
    ],
    caps: [
      { a: 0.3, b: cut - 0.2, text: 'The auctioneer / **opens the lot.**' },
      { a: Math.max(cut + 0.3, b1 - 0.2), b: b2, text: '**Bids** arrive / from the phones.' },
      { a: b2 + 0.1, b: b3, text: 'Prices only / go **up.**' },
      { a: b3 + 0.1, b: dur - 0.3, text: 'Every screen / **agrees.**' },
    ],
    ev: { cut, b1, b2, b3 },
    data: {},
  });
}

card('voice', 9, [
  { a: 0.3, b: 1.6, text: 'Or say it.' },
  { a: 1.6, b: 4.1, text: '"three fifty for paddle twelve"' },
  { a: 4.1, b: 5.5, text: 'amount 350.00, paddle 12' },
  {
    a: 5.5,
    b: 9,
    text: 'Did you mean $350 for paddle 12? Confirm. Illustration: speech is measured on 24 synthetic clips only (G5 partial).',
  },
]);

// 10. hammer (0 to 9), sold (9 to 12)
{
  const dur = 12;
  const cut = 9;
  const w1 = window('hammer', { fill: cut });
  const p1 = panesOf(
    'hammer',
    w1,
    row([{ id: 'console', actor: 'console', w: 1280, label: 'Auctioneer console' }]),
    0,
    cut,
  );
  const w2 = window('sold', { fill: dur - cut });
  const p2 = panesOf(
    'sold',
    w2,
    row([{ id: 'screen', actor: 'screen', w: 1280, label: 'Big screen' }]),
    cut,
    dur,
  );
  const press = at(w1, 0, 'hammer.press', 2.6);
  const released = at(w1, 0, 'hammer.released', press + 3.4 / w1.speed);
  scenes.push({
    id: 'hammer',
    dur,
    world: 'paper',
    chapter: { n: 5, name: 'Hammer' },
    panes: [...p1, ...p2],
    cam: [
      { at: 0, dur: 0, box: null },
      {
        at: Math.max(0.4, press - 1.4),
        dur: 1.2,
        box: focus(rectIn(p1, 'console', 'hammer.hold'), 1.9),
      },
      { at: released + 0.9, dur: 1.2, box: null },
      { at: cut, dur: 0, box: null },
    ],
    caps: [
      {
        a: 0.3,
        b: released + 0.2,
        text: 'Hold the **hammer** / 3 seconds.',
        sub: 'No accidental sales.',
      },
      { a: released + 0.3, b: cut - 0.2, text: '**Sold.**' },
      { a: cut + 0.3, b: dur - 0.3, text: 'The big screen / names the winner.' },
    ],
    ev: { press, released, cut },
    data: {},
  });
}

card('settle', 9, [
  { a: 0.3, b: 3.4, text: 'Capture only the winning price.' },
  {
    a: 3.4,
    b: 9,
    text: 'Release every other hold. Drawn, not recorded: real sandbox capture and void are proven in G1 and G4.',
  },
]);

// 12. receipt
{
  const dur = 7.5;
  const w = window('receipt', { fill: dur });
  const panes = panesOf(
    'receipt',
    w,
    row([
      { id: 'phoneA', actor: 'phoneA', h: 700, kind: 'phone', label: 'Bidder A. Winner' },
      { id: 'phoneB', actor: 'phoneB', h: 700, kind: 'phone', label: 'Bidder B. Hold released' },
    ]),
    0,
    dur,
  );
  const qr = panes[0].rects['receipt.qr'];
  scenes.push({
    id: 'receipt',
    dur,
    world: 'paper',
    chapter: { n: 6, name: 'Receipt' },
    panes,
    cam: [
      { at: 0, dur: 0, box: null },
      ...(qr
        ? [{ at: 3.6, dur: 1.4, box: focus(qr, 2.0) }]
        : [{ at: 0.6, dur: dur - 1.2, box: focus(paneBox(panes, 'phoneA', 300), 1.08) }]),
    ],
    caps: [
      { a: 0.4, b: 3.6, text: 'A **receipt** / for every bidder.' },
      { a: 3.8, b: dur - 0.3, text: 'With a share link / and a QR.' },
    ],
    ev: {},
    data: {},
  });
}

// 13. verify
{
  const dur = 12;
  const w = window('verify', { fill: dur });
  const panes = panesOf(
    'verify',
    w,
    row([{ id: 'host', actor: 'host', w: 1280, label: 'Verify a ledger' }]),
    0,
    dur,
  );
  const verified = at(w, 0, 'verify.clicked', 4.5);
  const edit = at(w, 0, 'verify.edit', 7.5);
  const broken = at(w, 0, 'verify.broken', 9.5);
  scenes.push({
    id: 'verify',
    dur,
    world: 'paper',
    chapter: { n: 7, name: 'Verify' },
    panes,
    cam: [
      { at: 0, dur: 0, box: null },
      {
        at: Math.max(0.5, verified - 0.4),
        dur: 1.0,
        box: focus(rectIn(panes, 'host', 'verify.badge'), 1.8),
      },
      { at: Math.max(verified + 0.8, edit - 0.4), dur: 0.9, box: null },
      {
        at: Math.max(edit + 0.6, broken - 0.3),
        dur: 1.0,
        box: focus(rectIn(panes, 'host', 'verify.broken'), 1.8),
      },
    ],
    caps: [
      { a: 0.4, b: verified - 0.2, text: 'Paste a ledger / **export.**' },
      { a: verified, b: edit - 0.1, text: 'Chain **verified.**' },
      { a: edit, b: broken - 0.1, text: 'Edit one entry.' },
      { a: broken, b: dur - 0.3, text: 'Chain **broken.**' },
    ],
    ev: { verified, edit, broken },
    data: {},
  });
}

card('proof', 12, [
  {
    a: 0.5,
    b: 3.1,
    text: 'Kill survived. A real server kill during settlement, on the PayPal sandbox: one capture, two holds voided, a ledger of 19 entries that verifies.',
  },
  {
    a: 3.1,
    b: 5.7,
    text: 'Live voice 24 of 24. Both speech providers answered 24 of 24 synthetic clips through the live socket. No bid accepted without a confirm.',
  },
  {
    a: 5.7,
    b: 8.3,
    text: 'Webhooks 6 of 6. Six real PayPal sandbox deliveries verified SUCCESS against the webhook id.',
  },
  {
    a: 8.3,
    b: 12,
    text: 'Latency, honestly. Hammer to captured p95 3.8 s against a 2.5 s target. Hammer to settled p95 6.9 s against 6 s. Both missed.',
  },
]);

// 15. judges: terminal (real answers) plus the recorded key field and the docs page in a paper panel
{
  const dur = 12;
  const docsAt = 6.5;
  const panel = { x: 1000, y: 300, w: 824, h: 546 };
  const wk = window('key', { fill: docsAt });
  const hostA = meta.actors.host;
  // the key field: the host page at 0.9x, positioned so the field sits in the panel's upper third
  const kScale = 0.9;
  const kw = hostA ? Math.round(hostA.w * kScale) : 1296;
  const kh = hostA ? Math.round(hostA.h * kScale) : 729;
  const fieldRect = rectList.find((r) => r.id === 'key.field' && r.actor === 'host');
  const fx = fieldRect ? fieldRect.x * kScale : kw / 2;
  const fy = fieldRect ? fieldRect.y * kScale : kh / 2;
  const kx = Math.round(panel.w / 2 - fx);
  const ky = Math.round(panel.h * 0.42 - fy);
  const pKey = panesOf(
    'key',
    wk,
    [{ id: 'key', actor: 'host', x: kx, y: ky, w: kw, h: kh, kind: 'bare' }],
    0,
    docsAt,
  );
  const wd = window('docs', { fill: dur - docsAt });
  const docsA = meta.actors.docs;
  const dw = panel.w;
  const dh = docsA ? Math.round(docsA.h * (dw / docsA.w)) : 464;
  const pDocs = panesOf(
    'docs',
    wd,
    [{ id: 'docs', actor: 'docs', x: 0, y: 0, w: dw, h: dh, kind: 'bare' }],
    docsAt,
    dur,
  );
  const esc = (s) => s;
  const cut = (s, n = 10) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);
  const cmds = [
    {
      c: `curl -s -X POST $API/api/judge/rooms -H "x-judge-key: $KEY" -d '{"title":"My lot"}'`,
      o: api?.create
        ? JSON.stringify({
            auctionId: cut(api.create.body.auctionId, 8),
            joinCode: api.create.body.joinCode,
            auctioneerToken: cut(api.create.body.auctioneerToken, 6),
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
  ].map((x) => ({ c: esc(x.c), o: x.o.length > 160 ? x.o.slice(0, 157) + '...' : x.o }));
  scenes.push({
    id: 'judges',
    dur,
    world: 'ink',
    panes: [...pKey, ...pDocs],
    cam: [],
    caps: [],
    ev: { docsAt, unlock: at(wk, 0, 'key.unlock', 3.0), accepted: at(wk, 0, 'key.accepted', 3.8) },
    data: { cmds },
    lines: [
      {
        a: 0.3,
        b: 4.0,
        text: 'For judges. One shared judge key, in the Devpost testing instructions. It opens sandbox rooms over plain HTTP and nothing else. No key is needed for /try.',
      },
      {
        a: 4.0,
        b: 8.8,
        text: 'The key goes into a password field on /try. The docs list every call with a Try-it panel.',
      },
      {
        a: 8.8,
        b: 12,
        text: 'gavel.dualmindlab.tech/try. docs.gavel.dualmindlab.tech/docs/judges/call-the-api. api.gavel.dualmindlab.tech',
      },
    ],
  });
}

card('openItems', 6, [
  {
    a: 0.6,
    b: 2.1,
    text: 'G3 in progress. The honor-period probe is still timing. The final reading is about 12 Nov.',
  },
  { a: 2.1, b: 3.6, text: 'G5 partial. Speech is measured on synthetic, noise-free audio only.' },
  { a: 3.6, b: 6, text: 'Sandbox only. No real money moves.' },
]);
card('outro', 7.5, [
  {
    a: 1.5,
    b: 7.5,
    text: 'Built by Harsh Bhanushali and Dhairya Patel. gavel.dualmindlab.tech. docs.gavel.dualmindlab.tech. github.com/harshbhx/gavel-auction. PayPal sandbox only.',
  },
]);

// ----------------------------------------------------------------------------- props and public/
const lockup = readFileSync(path.join(root, 'brand/svg/lockup-h-color.svg'), 'utf8');
const letters = [
  ...lockup.matchAll(/<g><g transform="translate\(([\d.]+) 0\)">([\s\S]*?)<\/g><\/g>/g),
].map((x) => `<g transform="translate(${x[1]} 0)">${x[2]}</g>`);
if (letters.length !== 5)
  throw new Error('expected 5 wordmark letters in brand/svg/lockup-h-color.svg');
// the letters are drawn in the mark's ink; the brand file hard-codes it, so the colour follows the world
const letterSvg = letters.map((l) => l.replace(/fill="#1d1712"/g, 'fill="currentColor"'));

const props = {
  fps: FPS,
  letters: letterSvg,
  scenes: scenes.map(({ lines, ...sc }) => sc),
};
const propsFile = path.join(here, 'props.json');
writeFileSync(propsFile, JSON.stringify(props));
const total = scenes.reduce((n, s) => n + s.dur, 0);
log(`${scenes.length} scenes, ${total.toFixed(1)} s at ${FPS} fps`);
if (total < 150 || total > 180) warn.push(`duration ${total.toFixed(1)} s is outside 2:30 to 3:00`);

const PUBLIC = path.join(here, 'public');
rmSync(PUBLIC, { recursive: true, force: true });
mkdirSync(PUBLIC, { recursive: true });
// hard links where possible (same filesystem in CI), a copy otherwise
try {
  execFileSync('cp', ['-al', RAW, path.join(PUBLIC, 'raw')]);
} catch {
  cpSync(RAW, path.join(PUBLIC, 'raw'), { recursive: true });
}
cpSync(path.join(root, 'packages/web/src/design/fonts'), path.join(PUBLIC, 'fonts'), {
  recursive: true,
});
cpSync(path.join(root, 'brand/svg'), path.join(PUBLIC, 'brand'), { recursive: true });

// ----------------------------------------------------------------------------- render
const mp4 = path.join(OUT, `${NAME}.mp4`);
const concurrency = process.env.CONCURRENCY || '3';
sh(
  'npx',
  [
    'remotion',
    'render',
    'Film',
    mp4,
    `--props=${propsFile}`,
    `--concurrency=${concurrency}`,
    '--crf=20',
    '--codec=h264',
    '--log=info',
  ],
  'remotion render',
);

const size = (f) => statSync(f).size / 1048576;
if (size(mp4) > 48) {
  const kbps = Math.floor((46 * 8 * 1024) / total);
  log(`mp4 is ${size(mp4).toFixed(1)} MB, re-encoding at ${kbps} kbps`);
  const tmp = path.join(OUT, 'tmp-cap.mp4');
  ff(
    [
      '-i',
      mp4,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-b:v',
      `${kbps}k`,
      '-maxrate',
      `${Math.floor(kbps * 1.3)}k`,
      '-bufsize',
      `${kbps * 2}k`,
      '-pass',
      '1',
      '-an',
      '-f',
      'mp4',
      '/dev/null',
    ],
    'pass 1',
  );
  ff(
    [
      '-i',
      mp4,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-b:v',
      `${kbps}k`,
      '-maxrate',
      `${Math.floor(kbps * 1.3)}k`,
      '-bufsize',
      `${kbps * 2}k`,
      '-pass',
      '2',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      tmp,
    ],
    'pass 2',
  );
  rmSync(mp4);
  execFileSync('mv', [tmp, mp4]);
}
if (WEBM) {
  ff(
    [
      '-i',
      mp4,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '34',
      '-cpu-used',
      '4',
      '-row-mt',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-an',
      path.join(OUT, `${NAME}.webm`),
    ],
    'webm',
  );
}

// ----------------------------------------------------------------------------- poster, SRT, timeline, sheets, report
let cursor = 0;
const timeline = [];
for (const sc of scenes) {
  const caps = [
    ...(sc.lines ?? []),
    ...sc.caps.map((c) => ({
      a: c.a,
      b: c.b,
      text: c.text.replace(/\*\*/g, '').replace(/ \/ /g, ' ') + (c.sub ? ' ' + c.sub : ''),
    })),
  ].map((c) => ({ a: +(cursor + c.a).toFixed(3), b: +(cursor + c.b).toFixed(3), text: c.text }));
  timeline.push({ id: sc.id, start: +cursor.toFixed(3), dur: sc.dur, caps });
  cursor += sc.dur;
}
const title = timeline.find((s) => s.id === 'title');
ff(
  [
    '-ss',
    ((title?.start ?? 0) + 3.6).toFixed(2),
    '-i',
    mp4,
    '-frames:v',
    '1',
    path.join(OUT, `${NAME}-poster.png`),
  ],
  'poster',
);
const tc = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
let n = 0;
const srt = [];
const rows = [];
for (const sc of timeline) {
  for (const c of sc.caps) {
    n += 1;
    srt.push(`${n}\n${tc(c.a)} --> ${tc(c.b)}\n${c.text}\n`);
    rows.push(
      `${String(n).padStart(2)}  ${tc(c.a)} --> ${tc(c.b)}  ${(c.b - c.a).toFixed(1)} s  [${sc.id}] ${c.text}`,
    );
    if (c.b - c.a < 2.5)
      warn.push(`caption ${n} [${sc.id}] shows ${(c.b - c.a).toFixed(1)} s (< 2.5 s)`);
  }
}
writeFileSync(path.join(OUT, `${NAME}.en.srt`), srt.join('\n'));
writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
ff(
  [
    '-i',
    mp4,
    '-vf',
    'fps=1/3,scale=384:216,tile=5x4:padding=6:color=0x1d1712',
    '-vsync',
    '0',
    path.join(OUT, 'contact-%02d.png'),
  ],
  'contact',
);

const report = [
  `duration ${total.toFixed(1)} s, ${FPS} fps, ${W}x${H}`,
  `mp4 ${size(mp4).toFixed(2)} MB${WEBM ? `, webm ${size(path.join(OUT, `${NAME}.webm`)).toFixed(2)} MB` : ''}`,
  '',
  ...timeline.map((s) => `${tc(s.start)}  ${s.dur.toFixed(1).padStart(5)} s  ${s.id}`),
  '',
  ...rows,
  '',
  `warnings (${warn.length}):`,
  ...warn.map((w) => '  ' + w),
].join('\n');
writeFileSync(path.join(OUT, 'report.txt'), report + '\n');
console.log(report);
