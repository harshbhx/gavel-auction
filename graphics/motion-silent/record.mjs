// Records the judge flow of GAVEL for the silent video (GFX-14). CI only (see silent-video.yml).
// It drives the real web app against a local server with judge rooms on and simulated holds, with
// one browser context per actor (host, two phones, console, big screen). Every actor is recorded with
// a CDP screencast (JPEG frames with wall clock timestamps), so all actors share one clock and the
// composer can cut any window out of any actor. A fake cursor is drawn in the page (the screencast
// has no cursor) and moves along eased paths, so there is no jitter.
/* global window */
// Usage: PW_DIR=<dir with playwright> WEB_URL=... node record.mjs <outDir>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.env.PW_DIR ?? process.cwd(), 'x.js'));
const { chromium } = require('playwright');

const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:4180').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const DOCS = process.env.DOCS_URL ?? 'https://docs.gavel.dualmindlab.tech/docs/judges/call-the-api';
const OUT = path.resolve(process.argv[2] ?? 'out/raw');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[record]', ...a);
const marks = []; // { id, start, end, ok, note } in epoch seconds
const events = []; // named instants inside shots: { id, t }
const rects = []; // element boxes in actor CSS px, for the film's macro crops: { id, actor, x, y, w, h }
const actors = {}; // name -> { page, ctx, cdp, frames, dir, w, h, dsf, cur }
let room = null;
let code = null;
let consoleUrl = null;
let screenUrl = null;
let auditUrl = null;

// ----------------------------------------------------------------------------- cursor
const CURSOR = `(() => {
  if (window.__gvCur) return;
  window.__gvCur = true;
  const st = { x: -80, y: -80 };
  const build = () => {
    if (document.getElementById('gv-cur')) return;
    const c = document.createElement('div');
    c.id = 'gv-cur';
    c.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    c.innerHTML =
      '<div id="gv-ring" style="position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;border:3px solid #ff6a1f;opacity:0"></div>' +
      '<svg width="30" height="38" viewBox="0 0 30 38" style="position:absolute;left:0;top:0;overflow:visible"><path d="M2 2 L2 29 L9 23 L14 35 L19 33 L14 21 L24 21 Z" fill="#1d1712" stroke="#efe6d3" stroke-width="2.2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    c.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
  };
  const move = (e) => {
    st.x = e.clientX; st.y = e.clientY;
    build();
    document.getElementById('gv-cur').style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('mousedown', (e) => {
    move(e);
    const r = document.getElementById('gv-ring');
    r.getAnimations().forEach((a) => a.cancel());
    r.style.opacity = '0.95';
    r.animate([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 0.95 }], { duration: 160, fill: 'forwards' });
  }, true);
  document.addEventListener('mouseup', () => {
    const r = document.getElementById('gv-ring');
    if (!r) return;
    r.getAnimations().forEach((a) => a.cancel());
    r.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 320, fill: 'forwards' });
  }, true);
  const ready = () => build();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();`;

// ----------------------------------------------------------------------------- screencast recorder
const MIN_GAP = 0.043; // seconds between kept frames (about 23 fps)
async function startRec(a) {
  mkdirSync(a.dir, { recursive: true });
  a.frames = [];
  let n = 0;
  let last = 0;
  let pending = null;
  let timer = null;
  const keep = (data, ts) => {
    const f = `f${String(n++).padStart(6, '0')}.jpg`;
    writeFileSync(path.join(a.dir, f), Buffer.from(data, 'base64'));
    a.frames.push([ts, f]);
    last = ts;
    pending = null;
  };
  a.flush = () => {
    if (pending) keep(pending.data, pending.ts);
  };
  a.cdp.on('Page.screencastFrame', (ev) => {
    a.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    const ts = ev.metadata.timestamp;
    if (ts - last >= MIN_GAP) keep(ev.data, ts);
    else {
      pending = { data: ev.data, ts };
      clearTimeout(timer);
      timer = setTimeout(a.flush, 70);
    }
  });
  await a.cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 84,
    maxWidth: Math.round(a.w * a.dsf),
    maxHeight: Math.round(a.h * a.dsf),
    everyNthFrame: 1,
  });
}

async function actor(name, { w, h, dsf = 1, phone = false }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dsf,
    isMobile: phone,
    hasTouch: false,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const a = { name, ctx, page, cdp, w, h, dsf, dir: path.join(OUT, name), mx: w / 2, my: h * 0.9 };
  actors[name] = a;
  page.on('pageerror', (e) => log(name, 'pageerror', String(e.message).slice(0, 160)));
  await startRec(a);
  return a;
}

// ----------------------------------------------------------------------------- pointer helpers
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
async function glide(a, x, y, ms = 700) {
  const steps = Math.max(14, Math.round(ms / 16));
  const x0 = a.mx;
  const y0 = a.my;
  for (let i = 1; i <= steps; i += 1) {
    const p = ease(i / steps);
    await a.page.mouse.move(x0 + (x - x0) * p, y0 + (y - y0) * p);
    await sleep(ms / steps);
  }
  a.mx = x;
  a.my = y;
}
async function box(a, loc) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(250);
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function click(a, loc, { ms = 800, pause = 350 } = {}) {
  const { x, y } = await box(a, loc);
  await glide(a, x, y, ms);
  await sleep(pause);
  await a.page.mouse.down();
  await sleep(110);
  await a.page.mouse.up();
  await sleep(250);
}
async function pressHold(a, loc, holdMs) {
  const { x, y } = await box(a, loc);
  await glide(a, x, y, 700);
  await sleep(300);
  await a.page.mouse.down();
  await sleep(holdMs);
  await a.page.mouse.up();
}
async function scrollBy(a, dy, ms = 900) {
  const steps = Math.max(10, Math.round(ms / 16));
  for (let i = 0; i < steps; i += 1) {
    await a.page.mouse.wheel(0, dy / steps);
    await sleep(ms / steps);
  }
}
async function restoreCursor(a) {
  await a.page.mouse.move(a.mx, a.my);
}
async function typeSlow(a, loc, text, delay = 120) {
  await click(a, loc, { ms: 600, pause: 200 });
  await a.page.keyboard.type(text, { delay });
}
async function go(a, url, { wait = 1200 } = {}) {
  await a.page.goto(url, { waitUntil: 'load' });
  await restoreCursor(a);
  await sleep(wait);
}
const btn = (a, re) => a.page.getByRole('button', { name: re }).first();

// ----------------------------------------------------------------------------- shots
async function shot(id, fn) {
  const start = Date.now() / 1000;
  let ok = true;
  let note = '';
  log('shot', id);
  try {
    let timer;
    await Promise.race([
      fn(),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('shot timed out after 100 s')), 100000);
      }),
    ]);
    clearTimeout(timer);
  } catch (e) {
    ok = false;
    note = String(e && e.message ? e.message.split('\n')[0] : e).slice(0, 240);
    log('  FAILED', id, note);
    for (const [n, a] of Object.entries(actors)) {
      await a.page.screenshot({ path: path.join(OUT, `fail-${id}-${n}.png`) }).catch(() => {});
    }
  }
  marks.push({ id, start, end: Date.now() / 1000, ok, note });
  log(`  ${id} took ${(Date.now() / 1000 - start).toFixed(1)} s`);
}
const ev = (id) => events.push({ id, t: Date.now() / 1000 });
/** Remembers where an element sits in an actor's viewport (for camera moves). Never throws. */
async function rect(id, a, loc) {
  try {
    const b = await loc.first().boundingBox({ timeout: 3000 });
    if (b) rects.push({ id, actor: a.name, x: b.x, y: b.y, w: b.width, h: b.height });
  } catch {
    /* no box, no rect */
  }
}

function writeMeta() {
  for (const a of Object.values(actors)) a.flush?.();
  const meta = {
    actors: Object.fromEntries(
      Object.entries(actors).map(([n, a]) => [n, { w: a.w, h: a.h, dsf: a.dsf, frames: a.frames }]),
    ),
    marks,
    events,
    rects,
    room: Boolean(room),
  };
  writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
}

let browser;
async function main() {
  // Watchdog: a stuck run still leaves a usable recording of the shots that finished.
  setTimeout(
    () => {
      log('WATCHDOG: run took more than 11 minutes, writing what exists');
      writeMeta();
      process.exit(3);
    },
    11 * 60 * 1000,
  ).unref();
  browser = await chromium.launch({ args: ['--hide-scrollbars'] });
  const host = await actor('host', { w: 1440, h: 810 });
  const phoneA = await actor('phoneA', { w: 390, h: 844, dsf: 2, phone: true });
  const phoneB = await actor('phoneB', { w: 390, h: 844, dsf: 2, phone: true });
  const cons = await actor('console', { w: 1600, h: 900 });
  const screen = await actor('screen', { w: 1280, h: 720 });
  const docs = await actor('docs', { w: 1280, h: 720 });
  // park every actor on a neutral first frame
  for (const a of [phoneA, phoneB, cons, screen]) await a.page.goto('about:blank');
  await sleep(800);

  // 0. the judge key field on /try (a password field: the throwaway key of this run shows as dots
  //    and is never in the frames). Needs JUDGE_KEY on the API host; without it the shot fails and
  //    the film falls back to type only.
  await shot('key', async () => {
    await go(host, `${WEB}/try`, { wait: 1500 });
    const field = host.page.getByLabel(/judge key/i).first();
    await field.waitFor({ state: 'visible', timeout: 12000 });
    await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await rect('key.field', host, field);
    await glide(host, 700, 400, 600);
    await sleep(700);
    await typeSlow(host, field, process.env.JUDGE_KEY ?? '', 45);
    await sleep(500);
    const unlock = btn(host, /^unlock$/i);
    await rect('key.unlock', host, unlock);
    await click(host, unlock, { ms: 700 });
    ev('key.unlock');
    await host.page
      .getByText(/judge key accepted/i)
      .first()
      .waitFor({ timeout: 15000 });
    ev('key.accepted');
    await rect('key.accepted', host, host.page.getByText(/judge key accepted/i));
    await sleep(2600);
  });

  // 1. the judge page, start a room
  await shot('try', async () => {
    await go(host, `${WEB}/try`, { wait: 1500 });
    await host.page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    const start = btn(host, /start (a |your )?(demo|live|sandbox|room)/i);
    await start.waitFor({ state: 'visible' });
    await rect('try.start', host, start);
    await click(host, start, { ms: 900, pause: 400 });
    ev('try.clicked');
    await host.page.waitForURL(/\/r\/[^/]+\/hub/, { timeout: 60000 });
    await sleep(700);
  });
  room = /\/r\/([^/?#]+)\//.exec(host.page.url())?.[1] ?? null;
  log('room', room ? 'ok' : 'MISSING');

  // 2. the hub: code and the ticket QR
  await shot('hub', async () => {
    await host.page.waitForSelector('.gv-hub__flaps, .gv-hub__pending', { timeout: 20000 });
    await sleep(1800);
    const flaps = await host.page.locator('.gv-hub__flap').allInnerTexts();
    code = flaps.join('').replace(/\s/g, '') || null;
    await rect('hub.flaps', host, host.page.locator('.gv-hub__flaps'));
    await rect(
      'hub.qr',
      host,
      host.page.locator('canvas, svg[aria-label*="QR" i], img[alt*="QR" i]'),
    );
    log('code', code ? code.length + ' chars' : 'MISSING');
    const anchors = await host.page.locator('a[href]').evaluateAll((as) =>
      as.map((a) => ({
        text: (a.innerText || a.getAttribute('aria-label') || '').trim(),
        href: a.href,
      })),
    );
    consoleUrl = anchors.find((x) => /open console/i.test(x.text))?.href ?? null;
    screenUrl = anchors.find((x) => /open screen/i.test(x.text))?.href ?? null;
    auditUrl =
      (await host.page
        .locator('[data-testid="hub-audit-link"]')
        .first()
        .getAttribute('href')
        .catch(() => null)) ?? null;
    log('links', Boolean(consoleUrl), Boolean(screenUrl), Boolean(auditUrl));
    // slow look down the hub, then back to the top
    await glide(host, 800, 380, 800);
    await sleep(2200);
    await scrollBy(host, 300, 900);
    await sleep(1500);
    await scrollBy(host, -300, 700);
    await sleep(600);
  });

  // 3. the big screen and the console open (lobby), recorded in the background of the next shots
  await shot('lobby', async () => {
    if (screenUrl) await go(screen, screenUrl, { wait: 2500 });
    if (consoleUrl) await go(cons, consoleUrl, { wait: 2500 });
    await sleep(800);
  });

  // 4. a bidder types the room code on the landing page, joins, and registers
  await shot('joinA', async () => {
    await go(phoneA, `${WEB}/`, { wait: 1800 });
    const input = phoneA.page.locator('input').first();
    await rect('joinA.input', phoneA, input);
    await typeSlow(phoneA, input, code ?? '');
    await sleep(400);
    await click(phoneA, btn(phoneA, /join with a code/i), { ms: 600 });
    await sleep(1800);
    ev('joinA.joinPage');
    const asBidder = phoneA.page
      .getByRole('button', { name: /join with the demo|join as bidder/i })
      .first();
    await asBidder.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(1000);
    await click(phoneA, asBidder, { ms: 600 });
    await sleep(1400);
  });

  await shot('holdA', async () => {
    const name = phoneA.page.getByLabel(/display name/i).first();
    await name.waitFor({ state: 'visible', timeout: 15000 });
    await typeSlow(phoneA, name, 'Asha');
    await sleep(400);
    await click(phoneA, btn(phoneA, /continue to bidding|continue/i), { ms: 600 });
    await sleep(1400);
    const radios = phoneA.page.getByRole('radio');
    await rect('holdA.ceiling', phoneA, phoneA.page.getByRole('radiogroup'));
    if ((await radios.count()) > 1) await click(phoneA, radios.nth(1), { ms: 600 });
    else if ((await radios.count()) > 0) await click(phoneA, radios.first(), { ms: 600 });
    ev('holdA.ceiling');
    await sleep(1500);
    // press and hold the approve button for 3 seconds
    const hold = phoneA.page.getByRole('button', { name: /approve|your hold|hold/i }).first();
    await hold.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(200);
    await rect('holdA.hold', phoneA, hold);
    ev('holdA.press');
    await pressHold(phoneA, hold, 3400);
    ev('holdA.released');
    await phoneA.page
      .getByText(/hold of .* is in place/i)
      .first()
      .waitFor({ timeout: 30000 });
    ev('holdA.held');
    await sleep(4200);
  });

  // 5. a second bidder joins from the link the ticket QR holds
  await shot('joinB', async () => {
    await go(phoneB, `${WEB}/join/${encodeURIComponent(room)}${code ? `?c=${code}` : ''}`, {
      wait: 1200,
    });
    const asBidder = phoneB.page
      .getByRole('button', { name: /join with the demo|join as bidder/i })
      .first();
    await asBidder.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(600);
    await click(phoneB, asBidder, { ms: 600 });
    const name = phoneB.page.getByLabel(/display name/i).first();
    await name.waitFor({ state: 'visible', timeout: 15000 });
    await typeSlow(phoneB, name, 'Ben', 80);
    await sleep(300);
    await click(phoneB, btn(phoneB, /continue to bidding|continue/i), { ms: 500 });
    await sleep(1000);
    const radios = phoneB.page.getByRole('radio');
    if ((await radios.count()) > 0) await click(phoneB, radios.first(), { ms: 500 });
    await sleep(800);
    const hold = phoneB.page.getByRole('button', { name: /approve|your hold|hold/i }).first();
    await pressHold(phoneB, hold, 3300);
    await phoneB.page
      .getByText(/hold of .* is in place/i)
      .first()
      .waitFor({ timeout: 30000 });
    await sleep(1500);
  });

  // 6. the auctioneer opens the lot
  await shot('open', async () => {
    await restoreCursor(cons);
    const open = btn(cons, /open lot/i);
    await open.waitFor({ state: 'visible', timeout: 15000 });
    await rect('open.button', cons, open);
    await sleep(1000);
    await click(cons, open, { ms: 800 });
    await sleep(2200);
  });

  // 7. both bidders go to the bid screen
  await shot('bidscreens', async () => {
    for (const a of [phoneA, phoneB]) {
      if (!/\/bid/.test(a.page.url())) {
        await btn(a, /continue to bidding/i)
          .click({ timeout: 4000 })
          .catch(() => {});
        await sleep(1500);
      }
      if (!/\/bid/.test(a.page.url()))
        await go(a, `${WEB}/r/${encodeURIComponent(room)}/bid`, { wait: 1500 });
    }
    await sleep(2500);
  });

  // 8. bids arrive
  const bidOnce = async (a, re) => {
    const b = a.page
      .getByRole('button', { name: re })
      .filter({ hasNotText: /custom/i })
      .first();
    await b.waitFor({ state: 'visible', timeout: 15000 });
    await click(a, b, { ms: 700 });
    await sleep(700);
    const ok = a.page.getByRole('button', { name: /^confirm|place bid|^yes/i }).first();
    if (await ok.isVisible().catch(() => false)) await click(a, ok, { ms: 500 });
    await sleep(1900);
  };
  await shot('bids', async () => {
    ev('bids.first');
    await bidOnce(phoneA, /^bid \$/i);
    ev('bids.second');
    await bidOnce(phoneB, /^\+\$|^bid \$/i);
    ev('bids.third');
    await bidOnce(phoneA, /^\+\$|^bid \$/i);
    await sleep(1200);
  });

  // 9. the hammer, held for 3 seconds
  await shot('hammer', async () => {
    await restoreCursor(cons);
    const h = btn(cons, /^hammer$|hammer$/i);
    await h.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(900);
    await click(cons, h, { ms: 800 });
    await sleep(1000);
    const dlg = cons.page.getByRole('dialog').first();
    const hb = (await dlg.isVisible().catch(() => false))
      ? dlg.getByRole('button', { name: /hold to hammer|hold/i }).first()
      : cons.page.getByRole('button', { name: /hold to hammer|hold 3 seconds/i }).first();
    await rect('hammer.hold', cons, hb);
    ev('hammer.press');
    await pressHold(cons, hb, 3400);
    ev('hammer.released');
    await sleep(4200);
    ev('hammer.after');
  });

  await shot('sold', async () => {
    await sleep(3600);
  });

  // 10. receipts on the two phones
  await shot('receipt', async () => {
    await Promise.all([
      go(phoneA, `${WEB}/r/${encodeURIComponent(room)}/receipt`, { wait: 2600 }),
      go(phoneB, `${WEB}/r/${encodeURIComponent(room)}/receipt`, { wait: 2600 }),
    ]);
    const make = btn(phoneA, /create share link/i);
    if (await make.isVisible().catch(() => false)) {
      await click(phoneA, make, { ms: 700 });
      await sleep(2200);
    }
    await rect(
      'receipt.qr',
      phoneA,
      phoneA.page.locator('canvas, img[alt*="QR" i], svg[aria-label*="QR" i]'),
    );
    await sleep(800);
  });

  // 11. verify the ledger of the room (host session holds the reviewer link)
  await shot('verify', async () => {
    // The real export of this room, fetched with the read-only reviewer key from the audit link.
    const reviewer = auditUrl ? /token=([^&]+)/.exec(new URL(auditUrl).hash)?.[1] : null;
    if (!reviewer) throw new Error('no reviewer key in the audit link');
    const res = await fetch(`${API}/api/judge/rooms/${encodeURIComponent(room)}/ledger`, {
      headers: { authorization: `Bearer ${decodeURIComponent(reviewer)}` },
    });
    if (!res.ok) throw new Error(`ledger export answered ${res.status}`);
    const text = JSON.stringify(await res.json(), null, 2);
    const edited = text.replace(/"at": (\d+)/, (_m, n) => `"at": ${Number(n) + 1}`);
    if (edited === text) throw new Error('nothing to edit in the export');
    await go(host, `${WEB}/verify`, { wait: 1500 });
    const area = host.page.getByLabel(/paste a ledger export/i).first();
    await area.waitFor({ state: 'visible', timeout: 15000 });
    await click(host, area, { ms: 800 });
    await sleep(300);
    await area.fill(text);
    await sleep(900);
    const check = btn(host, /check the chain/i);
    await click(host, check, { ms: 800 });
    const badge = host.page.locator('.gv-chain__badge').first();
    await host.page
      .getByText(/chain verified/i)
      .first()
      .waitFor({ timeout: 20000 });
    ev('verify.clicked');
    await badge.scrollIntoViewIfNeeded();
    await sleep(300);
    await rect('verify.badge', host, badge);
    await sleep(1900);
    // one entry is edited after sealing
    await click(host, area, { ms: 800 });
    await area.fill(edited);
    ev('verify.edit');
    await sleep(500);
    await click(host, check, { ms: 700 });
    await host.page
      .getByText(/chain broken/i)
      .first()
      .waitFor({ timeout: 20000 });
    ev('verify.broken');
    await host.page
      .getByText(/chain broken/i)
      .first()
      .scrollIntoViewIfNeeded();
    await sleep(300);
    await rect('verify.broken', host, host.page.locator('.gv-chain__badge'));
    await sleep(2500);
  });

  // 12. the ledger lab: AG Grid, and one edited entry
  await shot('lab', async () => {
    await go(host, `${WEB}/ledger`, { wait: 2500 });
    await host.page.waitForSelector('.ag-root', { timeout: 30000 });
    await sleep(2000);
    await scrollBy(host, 300, 800);
    await sleep(1200);
    const tamper = btn(host, /edit entry|tamper|simulate/i);
    ev('lab.before');
    await click(host, tamper, { ms: 800 });
    ev('lab.tampered');
    await sleep(3600);
  });

  // 13. the docs page that explains the judge API (public docs site)
  await shot('docs', async () => {
    await go(docs, DOCS, { wait: 2000 });
    await sleep(900);
    await glide(docs, 900, 420, 600);
    await scrollBy(docs, 520, 1000);
    await sleep(1000);
    await scrollBy(docs, 520, 1000);
    await sleep(1200);
  });

  await sleep(800);
  for (const a of Object.values(actors)) {
    await a.cdp.send('Page.stopScreencast').catch(() => {});
    a.flush?.();
  }
  writeMeta();
  const fails = marks.filter((m) => !m.ok);
  log(`done: ${marks.length} shots, ${fails.length} failed`);
  for (const f of fails) log('  failed', f.id, f.note);
  for (const [n, a] of Object.entries(actors)) log('frames', n, a.frames.length);
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
});
