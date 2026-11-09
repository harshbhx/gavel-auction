// Live red-team walk of the judge journey. Runs against the deployed web app and API.
// Soft assertions: every step records PASS/FAIL, notes, and screenshots, then the walk goes on.
// Secrets (PayPal sandbox buyers) come from the environment only and are never logged or typed
// into any note.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices, request as pwRequest } from 'playwright';

const WEB = (process.env.WEB_URL || '').replace(/\/$/, '');
const API = (process.env.API_URL || '').replace(/\/$/, '');
const PROFILE = process.env.PROFILE || 'desktop';
// SMOKE=1 (judge-smoke workflow): one room, the judge journey only, and the process exits 1
// when any step fails. The red-team extras (wrong-code probe, scripted demo, link crawl, live
// room API probes) are skipped by name.
const SMOKE = process.env.SMOKE === '1';
const SMOKE_SKIP =
  /^(API join endpoint error handling|\/demo: start a second room|\/demo\/scripted|API: join endpoints against the live room|Link crawl)/;
const OUT = path.resolve(process.env.OUT || 'out');
const BUYERS = [
  { email: process.env.PP_EMAIL_A || '', pass: process.env.PP_PASS_A || '' },
  { email: process.env.PP_EMAIL_B || '', pass: process.env.PP_PASS_B || '' },
];
const SHOTS = path.join(OUT, 'shots');
const VIDEOS = path.join(OUT, 'videos');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(VIDEOS, { recursive: true });

const results = [];
const events = []; // console errors, page errors, failed requests, http >= 400, ws events
const links = []; // every anchor seen: { from, href, text, target }
const apiLog = []; // direct API probes
const lastSig = {};
const P = {}; // label -> page
const C = {}; // label -> context
let N = 0;
let cur = null;
let browser;

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
const log = (...a) => console.log(`[${PROFILE}]`, ...a);
const clip = (s, n = 220) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, n);

function note(msg) {
  if (cur) cur.notes.push(clip(msg, 400));
  log('   note:', clip(msg, 300));
}
function check(cond, msg) {
  if (!cond) {
    if (cur) cur.status = 'FAIL';
    note(`CHECK FAILED: ${msg}`);
  }
  return Boolean(cond);
}
function warn(msg) {
  if (cur && cur.status === 'PASS') cur.status = 'WARN';
  note(`WARN: ${msg}`);
}

async function shot(page, name) {
  if (!page || page.isClosed()) return null;
  const file = `${name}.png`;
  try {
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: true, timeout: 15000 });
    return file;
  } catch {
    try {
      await page.screenshot({ path: path.join(SHOTS, file), timeout: 15000 });
      return file;
    } catch {
      return null;
    }
  }
}

async function step(name, fn) {
  if (SMOKE && SMOKE_SKIP.test(name)) return;
  N += 1;
  const id = String(N).padStart(2, '0');
  const rec = { id, name, status: 'PASS', notes: [], shots: [], ms: 0 };
  cur = rec;
  const t0 = Date.now();
  log(`STEP ${id} ${name}`);
  try {
    await fn(rec);
  } catch (e) {
    rec.status = 'FAIL';
    rec.notes.push(`EXCEPTION: ${clip(e && e.message ? e.message.split('\n')[0] : e, 300)}`);
  }
  rec.ms = Date.now() - t0;
  for (const [label, page] of Object.entries(P)) {
    let sig = '';
    try {
      sig = page.url() + '|' + (await page.locator('body').innerText({ timeout: 3000 })).length;
    } catch {}
    if (sig === lastSig[label]) continue;
    lastSig[label] = sig;
    const f = await shot(page, `${PROFILE}-${id}-${slug(name)}-${label}`);
    if (f) rec.shots.push(f);
  }
  results.push(rec);
  log(`  => ${rec.status} (${rec.ms} ms)`);
  cur = null;
}

let reprobeApi = null;
async function reprobe(url, method, label, stepId) {
  if (method !== 'GET' || !reprobeApi) return;
  try {
    const res = await reprobeApi.get(url, { headers: { origin: WEB }, timeout: 20000 });
    const h = res.headers();
    events.push({
      kind: 'reprobe',
      label,
      step: stepId,
      url: clip(url, 160),
      text: `status ${res.status()} acao=${h['access-control-allow-origin']} retry-after=${h['retry-after']} ratelimit=${h['x-ratelimit-remaining'] ?? h['ratelimit-remaining']} server=${h.server} via=${h.via} body=${clip(await res.text(), 100)}`,
    });
  } catch (e) {
    events.push({
      kind: 'reprobe',
      label,
      step: stepId,
      url: clip(url, 160),
      text: `error ${clip(e.message, 100)}`,
    });
  }
}

function hook(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      events.push({
        kind: `console.${m.type()}`,
        label,
        step: cur?.id,
        url: clip(page.url(), 120),
        text: clip(m.text()),
      });
    }
  });
  page.on('pageerror', (e) =>
    events.push({
      kind: 'pageerror',
      label,
      step: cur?.id,
      url: clip(page.url(), 120),
      text: clip(e.message),
    }),
  );
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText || '';
    events.push({ kind: 'requestfailed', label, step: cur?.id, url: clip(r.url(), 160), text: f });
    if (r.url().startsWith(API) && f !== 'net::ERR_ABORTED')
      reprobe(r.url(), r.method(), label, cur?.id);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/judge/rooms') && r.request().method() === 'POST') {
      r.text()
        .then((b) =>
          events.push({
            kind: 'judge-rooms-response',
            label,
            step: cur?.id,
            url: clip(r.url(), 100),
            text: `status ${r.status()} retry-after=${r.headers()['retry-after']} body=${clip(b, 120)}`,
          }),
        )
        .catch(() => {});
    }
    if (r.status() >= 400) {
      events.push({
        kind: `http.${r.status()}`,
        label,
        step: cur?.id,
        url: clip(r.url(), 160),
        text: r.request().method(),
      });
    }
  });
  page.on('websocket', (ws) => {
    events.push({ kind: 'ws.open', label, step: cur?.id, url: clip(ws.url(), 140), text: '' });
    ws.on('socketerror', (e) =>
      events.push({
        kind: 'ws.error',
        label,
        step: cur?.id,
        url: clip(ws.url(), 140),
        text: clip(e),
      }),
    );
    ws.on('close', () =>
      events.push({ kind: 'ws.close', label, step: cur?.id, url: clip(ws.url(), 140), text: '' }),
    );
  });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame())
      events.push({ kind: 'nav', label, step: cur?.id, url: clip(f.url(), 200), text: '' });
  });
}

async function newActor(label) {
  const base =
    PROFILE === 'iphone' ? { ...devices['iPhone 14'] } : { viewport: { width: 1280, height: 800 } };
  delete base.defaultBrowserType;
  const size = base.viewport || { width: 1280, height: 800 };
  const ctx = await browser.newContext({
    ...base,
    recordVideo: { dir: path.join(VIDEOS, label), size },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  hook(page, label);
  ctx.on('page', (p) => hook(p, `${label}-popup`));
  C[label] = ctx;
  P[label] = page;
  return page;
}

async function visibleText(page) {
  try {
    return clip(await page.locator('body').innerText({ timeout: 5000 }), 900);
  } catch {
    return '';
  }
}

async function harvest(page, from) {
  try {
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: a.href,
        raw: a.getAttribute('href'),
        text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60),
        target: a.target || '',
        hashOk: a.getAttribute('href')?.startsWith('#')
          ? !!document.getElementById(a.getAttribute('href').slice(1))
          : null,
      })),
    );
    for (const l of found) links.push({ from, ...l });
    return found;
  } catch {
    return [];
  }
}

async function clickText(page, re, opts = {}) {
  const roles = opts.roles || ['button', 'link'];
  for (const role of roles) {
    const loc = page.getByRole(role, { name: re });
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        if (opts.enabledOnly && !(await el.isEnabled().catch(() => false))) continue;
        await el.click({ timeout: 8000 });
        return `${role}:${clip(await el.innerText().catch(() => ''), 40)}`;
      }
    }
  }
  return null;
}

async function listActions(page) {
  try {
    return await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      return Array.from(document.querySelectorAll('button,[role=button],a[href]'))
        .filter(vis)
        .map(
          (e) =>
            `${e.tagName.toLowerCase()}:${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40)}${e.disabled ? '(disabled)' : ''}`,
        )
        .slice(0, 40);
    });
  } catch {
    return [];
  }
}

function roomFromUrl(u) {
  const m = /\/r\/([^/?#]+)\//.exec(u);
  return m ? decodeURIComponent(m[1]) : null;
}

async function waitUrl(page, re, ms = 20000) {
  try {
    await page.waitForURL(re, { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- PayPal sandbox approval
async function paypalPopup(pop, buyer) {
  const first = async (sels) => {
    for (const s of sels) {
      const l = pop.locator(s).first();
      if (await l.isVisible().catch(() => false)) return l;
    }
    return null;
  };
  await pop.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  note(`paypal popup url host: ${new URL(pop.url() || 'about:blank').hostname || 'blank'}`);
  await pop.waitForTimeout(4000);
  const cookie = await first(['#acceptAllButton', '#onetrust-accept-btn-handler']);
  if (cookie) await cookie.click().catch(() => {});
  let email = null;
  for (let i = 0; i < 10 && !email; i += 1) {
    email = await first([
      '#email',
      'input[name=login_email]',
      'input[type=email]',
      'input[autocomplete=username]',
    ]);
    if (!email) await pop.waitForTimeout(1500);
  }
  if (!email) {
    note('paypal: no email field found (page may differ or a challenge is shown)');
    return false;
  }
  await email.fill(buyer.email);
  const next = await first(['#btnNext', 'button:has-text("Next")']);
  if (next) {
    await next.click();
    await pop.waitForTimeout(2500);
  }
  let pw = null;
  for (let i = 0; i < 10 && !pw; i += 1) {
    pw = await first(['#password', 'input[name=login_password]', 'input[type=password]']);
    if (!pw) await pop.waitForTimeout(1500);
  }
  if (!pw) {
    note('paypal: no password field (challenge or captcha?)');
    return false;
  }
  await pw.fill(buyer.pass);
  const login = await first(['#btnLogin', 'button:has-text("Log In")', 'button:has-text("Login")']);
  if (login) await login.click();
  for (let i = 0; i < 20; i += 1) {
    if (pop.isClosed()) return true;
    if (!/paypal\.com/.test(pop.url())) {
      note(`paypal: returned to ${new URL(pop.url()).hostname}`);
      return true;
    }
    const ok = await first([
      '#payment-submit-btn',
      'button[data-testid="submit-button-initial"]',
      'button:has-text("Continue to Review Order")',
      'button:has-text("Complete Purchase")',
      'button:has-text("Agree and Continue")',
      'button:has-text("Agree & Continue")',
      'button:has-text("Pay Now")',
      'button:has-text("Continue")',
    ]);
    if (ok) {
      const label = clip(await ok.innerText().catch(() => ''), 40);
      note(`paypal: clicking "${label}" (iteration ${i})`);
      await ok.scrollIntoViewIfNeeded().catch(() => {});
      const bb = await ok.boundingBox().catch(() => null);
      if (bb) {
        await pop.mouse.move(bb.x + 20, bb.y - 40, { steps: 8 });
        await pop.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 });
        await pop.waitForTimeout(400);
        await pop.mouse.down();
        await pop.waitForTimeout(120);
        await pop.mouse.up();
        await pop.waitForTimeout(3000);
        const alertTxt = await pop
          .locator('[role=alert], .notification, [data-testid*=error]')
          .first()
          .innerText({ timeout: 1000 })
          .catch(() => '');
        note(
          `paypal: after real mouse click url=${new URL(pop.url()).pathname} alert="${clip(alertTxt, 120)}" btn still shown=${await ok.isVisible().catch(() => false)}`,
        );
        if (i >= 2) await ok.press('Enter').catch(() => {});
        continue;
      }
      await ok.click({ timeout: 8000 }).catch(async (e) => {
        note(`paypal: click failed ${clip(e.message, 80)}; forcing`);
        await ok.click({ force: true }).catch(() => {});
      });
      await pop.waitForTimeout(4000);
    } else {
      await pop.waitForTimeout(1500);
    }
  }
  return pop.isClosed();
}

async function registerBidder(page, label, name, buyerIdx) {
  const buyer = BUYERS[buyerIdx];
  // step 1: name
  const nameField = page.getByLabel(/display name/i).first();
  if (!(await nameField.isVisible().catch(() => false))) {
    note(`${label}: no name field; page says: ${await visibleText(page)}`);
    return false;
  }
  await nameField.fill(name);
  await clickText(page, /continue to bidding|continue/i, { roles: ['button'], enabledOnly: true });
  await page.waitForTimeout(800);
  // step 2: ceiling radio
  const radios = page.getByRole('radio');
  const rc = await radios.count();
  note(`${label}: ceiling options: ${rc}`);
  if (rc > 0)
    await radios
      .first()
      .check({ force: true })
      .catch(() => radios.first().click());
  await shot(page, `${PROFILE}-${cur.id}-${label}-ceiling`);
  // approve: two-tap alternative (more reliable than a 3 s press)
  const alt = page.getByRole('button', { name: /two taps/i }).first();
  const altVisible = await alt.isVisible().catch(() => false);
  if (!altVisible) {
    note(`${label}: no two-tap confirm button; actions: ${(await listActions(page)).join(' | ')}`);
    const hb = page.getByRole('button', { name: /approve|your hold|hold/i }).first();
    const bb = await hb.boundingBox().catch(() => null);
    if (!bb) return false;
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(3600);
    await page.mouse.up();
    note(`${label}: used press-and-hold approve`);
    const ok = await page
      .getByText(/hold of .* is in place/i)
      .first()
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    note(`${label}: after hold -> ${clip(await visibleText(page), 200)}`);
    return ok;
  }
  const popupP = page
    .context()
    .waitForEvent('page', { timeout: 40000 })
    .catch(() => null);
  await alt.click();
  await page
    .getByRole('button', { name: /tap again to confirm/i })
    .first()
    .click({ timeout: 8000 })
    .catch((e) => note(`${label}: second tap: ${clip(e.message, 100)}`));
  const pop = await popupP;
  let paid = false;
  if (!buyer.email || !buyer.pass) {
    note(`${label}: no sandbox buyer credentials in env; hold approval skipped`);
  } else if (pop) {
    note(`${label}: paypal popup opened`);
    paid = await paypalPopup(pop, buyer).catch((e) => {
      note(`${label}: paypal driver: ${clip(e.message, 120)}`);
      return false;
    });
  } else {
    // may have redirected the tab itself
    const u = page.url();
    note(`${label}: no popup; tab url host ${new URL(u).hostname}`);
    if (/paypal\.com/.test(u)) {
      paid = await paypalPopup(page, buyer).catch(() => false);
    }
  }
  const held = await page
    .getByText(/hold of .* is in place/i)
    .first()
    .waitFor({ timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  note(
    `${label}: after approval -> ${clip(await visibleText(page), 200)} (paypal driver finished: ${paid})`,
  );
  return held;
}

// ---------------------------------------------------------------- the walk
async function main() {
  browser = await chromium.launch();
  const t0 = Date.now();
  let roomId = null;
  let code = null;
  let hubUrl = null;
  let consoleUrl = null;
  let screenUrl = null;
  let hubInfo = {};

  // ---- API probes before anything else
  const api = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { origin: WEB } });
  reprobeApi = api;
  async function probe(label, method, url, body, expectStatuses, headers) {
    const t = Date.now();
    let status = 'ERR';
    let text = '';
    let hdr = {};
    try {
      const res = await api.fetch(url, {
        method,
        data: body,
        headers: headers || {},
        timeout: 30000,
      });
      status = res.status();
      text = clip(await res.text(), 200);
      hdr = res.headers();
    } catch (e) {
      text = clip(e.message, 150);
    }
    const ok = expectStatuses === null ? true : expectStatuses.includes(status);
    apiLog.push({
      label,
      method,
      url,
      status,
      expected: expectStatuses,
      ok,
      body: text,
      ms: Date.now() - t,
      acao: hdr['access-control-allow-origin'],
    });
    note(
      `${ok ? 'ok ' : 'UNEXPECTED '}${method} ${url} -> ${status} ${text}${hdr['access-control-allow-origin'] ? ` [ACAO ${hdr['access-control-allow-origin']}]` : ''}`,
    );
    if (!ok) check(false, `${label}: got ${status}, wanted ${expectStatuses}`);
    return { status, text };
  }

  await step('API health and judge capabilities', async () => {
    await probe('healthz', 'GET', '/healthz', undefined, [200]);
    const cap = await probe('capabilities', 'GET', '/api/judge/capabilities', undefined, [200]);
    check(/"judgeRooms":true/.test(cap.text), 'judge rooms are enabled');
    check(/"accepting":true/.test(cap.text), 'judge rooms accepting new rooms');
    const pre = await api.fetch('/api/judge/join', {
      method: 'OPTIONS',
      headers: {
        origin: WEB,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    const acao = pre.headers()['access-control-allow-origin'];
    note(
      `CORS preflight /api/judge/join from ${WEB}: status ${pre.status()}, allow-origin ${acao}`,
    );
    check(acao === WEB || acao === '*', 'CORS allows the web origin for /api/judge/join');
  });

  await step('API join endpoint error handling (1 wrong code only)', async () => {
    await probe('join empty body', 'POST', '/api/judge/join', {}, [400]);
    await probe(
      'join bad name char',
      'POST',
      '/api/judge/join',
      { code: 'ABCDEF', displayName: '<b>' },
      [400],
    );
    await probe(
      'join extra field',
      'POST',
      '/api/judge/join',
      { code: 'ABCDEF', displayName: 'QA', x: 1 },
      [400],
    );
    await probe(
      'join wrong code',
      'POST',
      '/api/judge/join',
      { code: 'ZZZZZZ', displayName: 'QA Probe' },
      [404],
    );
    await probe('join GET', 'GET', '/api/judge/join', undefined, [404, 405]);
    await probe(
      'invite join without invite',
      'POST',
      '/api/auctions/ZZZZZZ/join',
      {},
      [400, 401, 404],
    );
    await probe('room summary of unknown id', 'GET', '/api/auctions/ZZZZZZ', undefined, [404]);
  });

  // ---- static pages
  const pages = [
    '/',
    '/try',
    '/demo',
    '/demo/scripted',
    '/demo/scripted/join',
    '/demo/scripted/bid',
    '/ops',
    '/replay/demo',
    '/gallery',
    '/join/ZZZZZZ',
    '/r/nope/hub',
    '/r/nope/bid',
    '/r/nope/receipt',
    '/r/nope/screen',
    '/r/nope/console',
    '/r/nope/register',
    '/this-does-not-exist',
  ];
  const host = await newActor('host');
  await step('Every top-level page loads (status, h1, errors)', async () => {
    for (const p of pages) {
      let status = 'ERR';
      try {
        const res = await host.goto(WEB + p, { waitUntil: 'load', timeout: 45000 });
        status = res ? res.status() : 'none';
      } catch (e) {
        status = `ERR ${clip(e.message, 60)}`;
      }
      await host.waitForTimeout(600);
      const h1 = clip(
        await host
          .locator('h1')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => '(no h1)'),
        80,
      );
      const acts = await listActions(host);
      const body = await visibleText(host);
      await harvest(host, p);
      const lowSignal =
        /not found|404/i.test(body) &&
        !/this-does-not-exist|\/r\/nope|ZZZZZZ|gallery|replay/.test(p);
      note(
        `${p} -> ${status}; h1="${h1}"; actions=${acts.length}${acts.length === 0 ? ' DEAD END' : ''}`,
      );
      check(status === 200, `${p} status ${status}`);
      if (lowSignal) check(false, `${p} shows a not-found message`);
      if (acts.length === 0) check(false, `${p} has no link or button at all (dead end)`);
      if (p.startsWith('/r/nope') || p.startsWith('/join/ZZZZZZ') || p === '/this-does-not-exist') {
        note(`   unknown-room page text: ${clip(body, 160)}`);
      }
      await shot(host, `${PROFILE}-pages-${slug(p) || 'home'}`);
    }
  });

  await step('Landing: enter a room code field', async () => {
    await host.goto(WEB + '/', { waitUntil: 'load' });
    const boxes = await host.locator('input').count();
    note(
      `landing inputs: ${boxes}; actions: ${(await listActions(host)).slice(0, 12).join(' | ')}`,
    );
    check(boxes >= 1, 'a way to enter a join code is present on the landing');
    await host.locator('input').first().click();
    await host.keyboard.type('ABC123', { delay: 80 });
    const go = host.getByRole('button', { name: /join with a code/i }).first();
    note(
      `join-with-a-code enabled after typing 6 chars: ${await go.isEnabled().catch(() => 'n/a')}`,
    );
    check(
      await go.isEnabled().catch(() => false),
      'join with a code button enables once six characters are typed',
    );
  });

  // ---- /try -> start a room
  await step('/try: start a demo room and land on the hub', async () => {
    const startPath = PROFILE === 'iphone' ? '/demo' : '/try';
    note(`starting the room from ${startPath}`);
    await host.goto(WEB + startPath, { waitUntil: 'load' });
    note(`${startPath} banner/probe text: ${clip(await visibleText(host), 260)}`);
    const clicked = await clickText(host, /start (a |your )?(demo|live|sandbox|room)/i, {
      roles: ['button'],
      enabledOnly: true,
    });
    check(clicked !== null, 'start button found and enabled');
    const arrived = await waitUrl(host, /\/r\/[^/]+\/(hub|console)/, 60000);
    hubUrl = host.url();
    note(`after start, url: ${hubUrl.replace(/#.*/, '#<hash>')}`);
    check(arrived, 'navigated to the room hub');
    check(/\/hub/.test(hubUrl), 'lands on /hub (not the console)');
    roomId = roomFromUrl(hubUrl);
    const hash = new URL(hubUrl).hash;
    note(`hub hash keys: ${hash.replace(/=[^&]+/g, '=<redacted>')}`);
    check(/token=|a=|s=|code=/.test(hash), 'hub url carries keys in the fragment');
  });

  await step('Hub: code, QR, links, copy buttons', async () => {
    await host.waitForTimeout(4000);
    await host
      .waitForSelector('.gv-hub__flaps, .gv-hub__pending', { timeout: 20000 })
      .catch(() => {});
    const flaps = await host
      .locator('.gv-hub__flaps')
      .first()
      .getAttribute('aria-label')
      .catch(() => null);
    code = flaps
      ? flaps.replace(/^.*?:?\s*([A-Z0-9](?:\s[A-Z0-9])+|[A-Z0-9]+)\s*$/, '$1').replace(/\s/g, '')
      : null;
    const flapsText = await host
      .locator('.gv-hub__flap')
      .allInnerTexts()
      .catch(() => []);
    if (flapsText.length) code = flapsText.join('');
    note(`hub join code: ${code}`);
    check(Boolean(code), 'join code visible on the hub');
    const anchors = await harvest(host, 'hub');
    hubInfo.anchors = anchors.map((a) => ({
      text: a.text,
      raw: (a.raw || '').replace(/(token|invite)=[^&#]+/g, '$1=<r>'),
      target: a.target,
    }));
    for (const a of hubInfo.anchors)
      note(`hub link: "${a.text}" -> ${a.raw} ${a.target ? `(target ${a.target})` : ''}`);
    const acts = await listActions(host);
    note(`hub actions: ${acts.join(' | ')}`);
    const qr = await host.locator('.gv-hub svg, .gv-hub canvas, .gv-hub img').count();
    note(`hub QR/graphic elements: ${qr}`);
    check(qr > 0, 'QR present on the hub');
    // find the bidder link and judge it
    const bidderA = anchors.find((a) => /open bidder|bidder/i.test(a.text));
    if (bidderA) {
      note(
        `"Open bidder" href: ${bidderA.raw.replace(/#.*/, '#<frag>')} fragment present: ${bidderA.raw.includes('#')}; has ?c=: ${/[?&]c=/.test(bidderA.raw)}; contains code: ${code ? bidderA.raw.includes(code) : 'n/a'}`,
      );
      check(
        /#invite=|#/.test(bidderA.raw) || (code && bidderA.raw.includes(code)),
        '"Open bidder" link carries an invite or the room code',
      );
    } else {
      check(false, 'no "Open bidder" link on the hub');
    }
    const consoleA = anchors.find((a) => /open console/i.test(a.text));
    const screenA = anchors.find((a) => /open screen/i.test(a.text));
    consoleUrl = consoleA?.href || null;
    screenUrl = screenA?.href || null;
    check(Boolean(consoleUrl), 'Open console link present');
    check(Boolean(screenUrl), 'Open screen link present');
    // share all links text
    const shared = await clickText(host, /share all links/i, { roles: ['button'] });
    if (shared) {
      await host.waitForTimeout(500);
      const txt = await host.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      note(
        `share-all text (redacted): ${clip(txt.replace(/(token|invite)=[^\s&]+/g, '$1=<r>'), 300)}`,
      );
    } else {
      warn('no "Share all links" button');
    }
  });

  // helper: get a fresh single-use invite link via the hub copy button
  async function freshInvite() {
    await clickText(host, /new bidder invite/i, { roles: ['button'] }).catch(() => {});
    await host.waitForTimeout(3000);
    const href = await host
      .getByRole('link', { name: /open bidder/i })
      .first()
      .getAttribute('href')
      .catch(() => '');
    await clickText(host, /copy bidder link/i, { roles: ['button'] });
    await host.waitForTimeout(400);
    const clipTxt = await host.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    note(
      `copy-bidder-link/QR target length ${clipTxt.length} bytes; is invite link: ${/\/register#/.test(clipTxt)}; Open-bidder href length ${(href || '').length}`,
    );
    check(
      /\/register#|\/join\//.test(clipTxt),
      'Copy bidder link / QR carries a working link (invite, or a join link that can register)',
    );
    return href ? new URL(href, WEB).href : '';
  }

  // ---- bidder A: by code (the way a judge types it)
  const bidA = await newActor('bidderA');
  let aRegistered = false;
  await step('Bidder A joins by room CODE (landing -> join -> Join as bidder)', async () => {
    check(Boolean(code), 'have a code');
    await bidA.goto(WEB + '/', { waitUntil: 'load' });
    await bidA.locator('input').first().click();
    await bidA.keyboard.type(code || '', { delay: 80 });
    await bidA.waitForTimeout(500);
    await clickText(bidA, /join with a code/i, { roles: ['button'], enabledOnly: true });
    await bidA.waitForTimeout(3000);
    note(`url after typing code: ${bidA.url()}`);
    note(`join page: ${await visibleText(bidA)}`);
    check(/\/join\//.test(bidA.url()) || /\/r\//.test(bidA.url()), 'code leads to a join page');
    const asBidder = await clickText(bidA, /join with the demo|join as bidder/i, {
      roles: ['button', 'link'],
    });
    check(asBidder !== null, '"Join as bidder" present');
    await bidA.waitForTimeout(3000);
    note(`url after "Join as bidder": ${bidA.url().replace(/#.*/, '#<frag>')}`);
    const body = await visibleText(bidA);
    note(`page after "Join as bidder": ${body}`);
    const onForm = await bidA
      .getByLabel(/display name/i)
      .first()
      .isVisible()
      .catch(() => false);
    check(onForm, 'registration form (display name) is shown after joining by code');
    if (!onForm) {
      check(
        !/expired|start again/i.test(body),
        'join-by-code does not dead-end with an "expired" message',
      );
    }
  });

  // ---- watcher flow (Dhairya: watcher gets kicked on join as bidder)
  const watcher = await newActor('watcher');
  await step('Watcher: hub join link, Just watch, then join as bidder', async () => {
    const joinUrl = `${WEB}/join/${encodeURIComponent(roomId)}${code ? `?c=${code}` : ''}`;
    await watcher.goto(joinUrl, { waitUntil: 'load' });
    await watcher
      .getByRole('button', { name: /just watch/i })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    note(`join page for room link: ${await visibleText(watcher)}`);
    const w = await clickText(watcher, /just watch|watch/i);
    check(w !== null, '"Just watch" present');
    await watcher.waitForTimeout(3500);
    note(`watching url: ${watcher.url()}`);
    note(`watching page: ${await visibleText(watcher)}`);
    check(/\/bid/.test(watcher.url()), 'watch leads to the bid/watch screen');
    await harvest(watcher, 'watcher-bid');
    const acts = await listActions(watcher);
    note(`watcher actions: ${acts.join(' | ')}`);
    const wantsJoin = acts.some((a) => /join|register|bidder/i.test(a));
    check(wantsJoin, 'a watcher can find a way to join as a bidder from the watch screen');
    if (wantsJoin) {
      await clickText(watcher, /join|register|become a bidder|bidder/i).catch(() => {});
      await watcher.waitForTimeout(3000);
      note(`after watcher clicks join: ${watcher.url()} :: ${await visibleText(watcher)}`);
      check(
        !/^\/?$/.test(new URL(watcher.url()).pathname),
        'watcher is NOT kicked back to the landing page',
      );
    }
    // the exact path Dhairya reports: back to the join page, Join as bidder
    await watcher.goto(joinUrl, { waitUntil: 'load' });
    await watcher
      .getByRole('button', { name: /join with the demo|join as bidder/i })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    note(`revisit join page url: ${watcher.url()}`);
    const again = await clickText(watcher, /join with the demo|join as bidder/i);
    await watcher.waitForTimeout(3000);
    note(
      `watcher after "Join as bidder": url ${watcher.url().replace(/#.*/, '#<f>')} :: ${await visibleText(watcher)}`,
    );
    check(again !== null, 'watcher revisit shows "Join as bidder" (not auto-redirected away)');
    const onForm = await watcher
      .getByLabel(/display name/i)
      .first()
      .isVisible()
      .catch(() => false);
    check(onForm, 'watcher reaches the registration form');
    check(new URL(watcher.url()).pathname !== '/', 'watcher not kicked to /');
  });

  await step('Direct nav to /r/<room>/register with no invite', async () => {
    await watcher.goto(`${WEB}/r/${encodeURIComponent(roomId)}/register`, {
      waitUntil: 'load',
    });
    await watcher.waitForTimeout(1500);
    const body = await visibleText(watcher);
    note(`register without invite: ${body}`);
    check(/display name/i.test(body), 'register page can be used from a room code (no invite)');
  });

  // ---- bidders via invite / QR link
  let inviteA = '';
  let inviteB = '';
  await step('Hub: mint bidder invite links (QR targets)', async () => {
    inviteA = await freshInvite();
    inviteB = await freshInvite();
    note(`invite A ${inviteA ? 'ok' : 'EMPTY'} :: ${inviteA.replace(/#.*/, '#<f>')}`);
    note(`invite B ${inviteB ? 'ok' : 'EMPTY'} :: ${inviteB.replace(/#.*/, '#<f>')}`);
    check(Boolean(inviteA) && Boolean(inviteB), 'two invite links available');
    check(inviteA !== inviteB, 'invites differ');
  });

  async function viaJoinPage(page, label) {
    const joinUrl = `${WEB}/join/${encodeURIComponent(roomId)}${code ? `?c=${code}` : ''}`;
    await page.goto('about:blank');
    await page.goto(joinUrl, { waitUntil: 'load' });
    await page
      .getByRole('button', { name: /join with the demo|join as bidder/i })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    note(`${label}: join page buttons: ${(await listActions(page)).join(' | ')}`);
    await clickText(page, /join with the demo|join as bidder/i, { roles: ['button'] });
    await page.waitForTimeout(3000);
    note(`${label}: after join choice url ${page.url().replace(/#.*/, '#<f>')}`);
  }

  await step('Bidder A registers (demo hold) and holds', async () => {
    const onForm = await bidA
      .getByLabel(/display name/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!onForm) await viaJoinPage(bidA, 'bidderA');
    aRegistered = await registerBidder(bidA, 'bidderA', 'QA Alice', 0);
    check(aRegistered, 'hold is in place for bidder A');
  });

  const bidB = await newActor('bidderB');
  let bRegistered = false;
  await step('Bidder B joins from the hub join link/QR target (demo hold)', async () => {
    await viaJoinPage(bidB, 'bidderB');
    bRegistered = await registerBidder(bidB, 'bidderB', 'QA Bob', 1);
    check(bRegistered, 'hold is in place for bidder B');
  });

  // ---- console + screen
  const screenPage = await newActor('screen');
  await step('Big screen opens and shows the lobby and join code', async () => {
    if (!screenUrl) return check(false, 'no screen link');
    await screenPage.goto(screenUrl, { waitUntil: 'load' });
    await screenPage.waitForTimeout(3000);
    const body = await visibleText(screenPage);
    note(`screen: ${body}`);
    check(!!body && !/could not|not found|expired/i.test(body), 'screen renders live room');
    check(code ? body.includes(code) : true, 'screen shows join code');
    await harvest(screenPage, 'screen');
  });

  const cons = await newActor('console');
  await step('Console: opens, open lot', async () => {
    if (!consoleUrl) return check(false, 'no console link');
    await cons.goto(consoleUrl, { waitUntil: 'load' });
    await cons.waitForTimeout(3000);
    note(`console actions: ${(await listActions(cons)).join(' | ')}`);
    await harvest(cons, 'console');
    const opened = await clickText(cons, /open lot/i, { roles: ['button'], enabledOnly: true });
    note(`open lot: ${opened}`);
    await cons.waitForTimeout(2500);
    note(`console after open: ${await visibleText(cons)}`);
  });

  await step('Bids from two bidders', async () => {
    for (const [label, page] of [
      ['bidderA', bidA],
      ['bidderB', bidB],
    ]) {
      if (!/\/bid/.test(page.url())) {
        await clickText(page, /continue to bidding/i).catch(() => {});
        await page.waitForTimeout(2500);
      }
      if (!/\/bid/.test(page.url()))
        await page.goto(`${WEB}/r/${encodeURIComponent(roomId)}/bid`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      note(`${label} bid screen: ${await visibleText(page)}`);
      note(`${label} actions: ${(await listActions(page)).join(' | ')}`);
    }
    const bidOnce = async (label, page, re) => {
      const c = await clickText(page, re, { roles: ['button'], enabledOnly: true });
      note(`${label} clicked ${c}`);
      await page.waitForTimeout(500);
      await clickText(page, /^confirm|place bid|yes/i, {
        roles: ['button'],
        enabledOnly: true,
      }).catch(() => {});
      await page.waitForTimeout(2500);
      note(`${label} after bid: ${await visibleText(page)}`);
      return c;
    };
    check((await bidOnce('bidderA', bidA, /^bid \$/i)) !== null, 'bidder A can place a quick bid');
    check((await bidOnce('bidderB', bidB, /^\+\$|^bid \$/i)) !== null, 'bidder B can bid higher');
    await cons.waitForTimeout(1500);
    note(`console bid stream: ${await visibleText(cons)}`);
    check(/QA (Alice|Bob)|paddle/i.test(await visibleText(cons)), 'console sees the bids/bidders');
    note(`screen: ${await visibleText(screenPage)}`);
  });

  await step('Console actions: pause, resume, extend 30 s', async () => {
    const p = await clickText(cons, /^pause/i, { roles: ['button'], enabledOnly: true });
    check(p !== null, 'Pause present/enabled');
    await cons.waitForTimeout(2500);
    note(`bidder A while paused: ${await visibleText(bidA)}`);
    check(/paused/i.test(await visibleText(bidA)), 'bidder sees the paused banner');
    const r = await clickText(cons, /^resume/i, { roles: ['button'], enabledOnly: true });
    check(r !== null, 'Resume present');
    await cons.waitForTimeout(1500);
    const e = await clickText(cons, /extend/i, { roles: ['button'], enabledOnly: true });
    check(e !== null, 'Extend present');
    note(`extend button: ${e}`);
    await cons.waitForTimeout(1500);
    const acts = await listActions(cons);
    note(`console actions now: ${acts.join(' | ')}`);
    check(
      acts.some((a) => /extend 30/i.test(a)),
      'an "Extend 30 s" action exists',
    );
  });

  await step('Hammer: close the lot from the console', async () => {
    const h = await clickText(cons, /^hammer$|hammer$/i, { roles: ['button'], enabledOnly: true });
    note(`hammer click: ${h}`);
    await cons.waitForTimeout(1200);
    const dlg = cons.getByRole('dialog').first();
    if (await dlg.isVisible().catch(() => false)) {
      note(`hammer dialog: ${clip(await dlg.innerText(), 200)}`);
      const btns = await dlg.getByRole('button').allInnerTexts();
      note(`dialog buttons: ${btns.join(' | ')}`);
      const hb = dlg.getByRole('button', { name: /hold to hammer/i }).first();
      const box = await hb.boundingBox().catch(() => null);
      if (box) {
        await cons.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await cons.mouse.down();
        await cons.waitForTimeout(3800);
        await cons.mouse.up();
        note('held the dialog hammer button for 3.8 s with the mouse');
      } else {
        await hb.focus().catch(() => {});
        await cons.keyboard.press('Enter');
        note('no hold box; pressed Enter on the hammer button');
      }
    } else {
      note('no dialog; trying press-and-hold on hold-to-hammer');
      const hold = cons.getByRole('button', { name: /hold to hammer|hold 3 seconds/i }).first();
      const box = await hold.boundingBox().catch(() => null);
      if (box) {
        await cons.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await cons.mouse.down();
        await cons.waitForTimeout(3600);
        await cons.mouse.up();
      } else {
        check(false, 'no hammer control reachable');
      }
    }
    await cons.waitForTimeout(6000);
    const body = await visibleText(cons);
    note(`console after hammer: ${body}`);
    check(/sold|closed|done|settl|captur/i.test(body), 'console shows the lot as closed/sold');
    const sb = await visibleText(screenPage);
    note(`screen after hammer: ${sb}`);
    check(/sold|passed|captured|released/i.test(sb), 'screen shows the result');
  });

  await step('Receipt for bidder A and B, share link', async () => {
    for (const [label, page] of [
      ['bidderA', bidA],
      ['bidderB', bidB],
    ]) {
      await page.goto(`${WEB}/r/${encodeURIComponent(roomId)}/receipt`, {
        waitUntil: 'load',
      });
      await page.waitForTimeout(6000);
      const body = await visibleText(page);
      note(`${label} receipt: ${body}`);
      check(!/no receipt for this session/i.test(body), `${label}: a receipt exists`);
      await harvest(page, `receipt-${label}`);
      if (label === 'bidderA') {
        note(`receipt actions: ${(await listActions(page)).join(' | ')}`);
        const made = await clickText(page, /create share link/i, { roles: ['button'] });
        note(`create share link clicked: ${made}`);
        await page.waitForTimeout(3500);
        const fieldVal = await page
          .getByLabel(/receipt link/i)
          .first()
          .inputValue()
          .catch(() => '');
        const sh = await clickText(page, /copy link/i, { roles: ['button'] });
        note(`share clicked: ${sh}; field has link: ${fieldVal ? 'yes' : 'NO'}`);
        await page.waitForTimeout(800);
        let txt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
        if (!/^https?:/.test(txt)) txt = fieldVal;
        note(
          `share link copied: ${txt ? txt.replace(/(token|t|s)=[^&#\s]+/g, '$1=<r>').slice(0, 160) : 'EMPTY'}`,
        );
        if (txt && /^https?:/.test(txt)) {
          const fresh = await browser.newContext({
            recordVideo: { dir: path.join(VIDEOS, 'sharelink') },
          });
          const sp = await fresh.newPage();
          hook(sp, 'sharelink');
          P.sharelink = sp;
          const res = await sp.goto(txt, { waitUntil: 'load' }).catch(() => null);
          await sp.waitForTimeout(3000);
          note(`share link opens: status ${res?.status()} :: ${await visibleText(sp)}`);
          check(
            res?.status() === 200 && !/not found|expired|no receipt/i.test(await visibleText(sp)),
            'share link opens a receipt for a stranger',
          );
        } else {
          check(false, 'receipt share link could not be copied');
        }
      }
    }
  });
  delete P.sharelink;

  await step('/demo: start a second room, land on hub', async () => {
    if (!process.env.EXTRA_ROOM) {
      note(
        'skipped: one room per profile keeps inside the host limit of 4 creates per hour per address',
      );
      return;
    }
    const demo = await newActor('demo');
    await demo.goto(WEB + '/demo', { waitUntil: 'load' });
    const c = await clickText(demo, /start a demo auction|start/i, {
      roles: ['button'],
      enabledOnly: true,
    });
    check(c !== null, 'start button on /demo');
    const arrived = await waitUrl(demo, /\/r\/[^/]+\/(hub|console)/, 60000);
    note(`/demo -> ${demo.url().replace(/#.*/, '#<f>')}`);
    check(arrived, '/demo reaches a room');
    check(/\/hub/.test(demo.url()), '/demo lands on the hub');
    await harvest(demo, 'demo-hub');
    await demo.waitForTimeout(3000);
    note(`/demo hub: ${await visibleText(demo)}`);
  });

  // ---- scripted demo
  const sc = await newActor('scripted');
  await step('/demo/scripted: pace and readability', async () => {
    await sc.goto(WEB + '/demo/scripted', { waitUntil: 'load' });
    await sc.evaluate(() => {
      window.__mut = { n: 0, texts: [], t0: performance.now() };
      window.__chg = [];
      window.__last = '';
      setInterval(() => {
        const t = document.body.innerText;
        if (t !== window.__last) {
          window.__last = t;
          const price = (t.match(/\$[0-9,]+\.[0-9]{2}/) || [''])[0];
          const sold = /SOLD/i.test(t) ? ' SOLD' : '';
          window.__chg.push(Math.round(performance.now() - window.__mut.t0) + 'ms ' + price + sold);
        }
      }, 150);
      new MutationObserver((ms) => {
        window.__mut.n += ms.length;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
    note(`scripted start actions: ${(await listActions(sc)).join(' | ')}`);
    await clickText(sc, /play|start|run|begin|watch/i, {
      roles: ['button'],
      enabledOnly: true,
    }).catch(() => {});
    const samples = [];
    let last = '';
    let changes = 0;
    for (let s = 0; s < 40; s += 1) {
      await sc.waitForTimeout(1000);
      const txt = await visibleText(sc);
      if (txt !== last) {
        changes += 1;
        last = txt;
      }
      samples.push(txt);
      if (s % 8 === 0) await shot(sc, `${PROFILE}-scripted-t${String(s).padStart(2, '0')}`);
    }
    const mut = await sc.evaluate(() => window.__mut.n);
    const chg = await sc.evaluate(() => window.__chg);
    note(`timeline of visible changes (150 ms sampling): ${chg.join(' | ')}`);
    note(
      `over 40 s: visible-text changed ${changes} times; DOM mutations ${mut} (${(mut / 40).toFixed(0)}/s)`,
    );
    note(`text at t=5: ${clip(samples[5], 200)}`);
    note(`text at t=20: ${clip(samples[20], 200)}`);
    note(`text at t=39: ${clip(samples[39], 200)}`);
    check(
      changes <= 20,
      `scripted demo changes visible text ${changes} times in 40 s (readable pace is under 1 change per 2 s)`,
    );
    check(
      mut / 40 < 60,
      `scripted demo DOM churn ${(mut / 40).toFixed(0)} mutations/s is too high to read`,
    );
    await harvest(sc, 'scripted');
    note(`scripted actions at end: ${(await listActions(sc)).join(' | ')}`);
    const join = await sc.goto(WEB + '/demo/scripted/join', { waitUntil: 'load' });
    note(`scripted join: ${join?.status()} :: ${await visibleText(sc)}`);
    const bid = await sc.goto(WEB + '/demo/scripted/bid', { waitUntil: 'load' });
    note(`scripted bid: ${bid?.status()} :: ${await visibleText(sc)}`);
  });

  // ---- API join with the live room code (after the UI so a seat is not consumed first)
  await step('API: join endpoints against the live room', async () => {
    const ok = await probe(
      'judge join valid',
      'POST',
      '/api/judge/join',
      { code, displayName: 'QA API One' },
      [200, 410],
    );
    if (ok.status === 410) note('room already ended by the hammer, 410 is expected here');
    else check(/sessionToken/.test(ok.text), 'join returns a session token');
    const ok2 = await probe(
      'judge join valid (second bidder)',
      'POST',
      '/api/judge/join',
      { code, displayName: 'QA API Two' },
      [200, 410],
    );
    if (ok.status === 200) check(ok.text !== ok2.text, 'second join gets a distinct session');
    await probe(
      'judge join lowercase code',
      'POST',
      '/api/judge/join',
      { code: String(code).toLowerCase(), displayName: 'QA Low' },
      [200, 404, 410],
    );
    await probe(
      'judge join code with spaces',
      'POST',
      '/api/judge/join',
      { code: ` ${code} `, displayName: 'QA Space' },
      [200, 410],
    );
    const sum = await probe('room summary by id', 'GET', `/api/auctions/${roomId}`, undefined, [
      200,
    ]);
    check(/joinCode/.test(sum.text), 'room summary has joinCode');
    await probe('room summary by CODE', 'GET', `/api/auctions/${code}`, undefined, [200, 404]);
    await probe(
      'invite join by code without invite',
      'POST',
      `/api/auctions/${code}/join`,
      {},
      [400, 401, 404],
    );
  });

  // ---- link crawl
  await step('Link crawl: every link seen on every page', async () => {
    const seen = new Map();
    for (const l of links) {
      if (!l.href || /^(mailto|tel|javascript):/.test(l.href)) continue;
      const key = l.href.replace(/(token|invite)=[^&]+/g, '$1=<r>');
      if (!seen.has(key)) seen.set(key, { ...l, key });
    }
    note(`unique links seen: ${seen.size}`);
    const probePage = await newActor('crawl');
    for (const l of seen.values()) {
      if (l.hashOk === false) {
        check(false, `in-page anchor ${l.raw} (from ${l.from}) has no target element`);
        continue;
      }
      const u = new URL(l.href);
      if (u.origin === WEB) {
        // hub/console/screen links carry keys of a live room: skip loading those, they were used above
        if (/^\/r\/[^/]+\/(console|screen|audit)$/.test(u.pathname) && u.hash) continue;
        let status = 'ERR';
        try {
          const res = await probePage.goto(l.href, { waitUntil: 'load', timeout: 30000 });
          status = res ? res.status() : 200;
        } catch (e) {
          status = `ERR ${clip(e.message, 40)}`;
        }
        await probePage.waitForTimeout(500);
        const body = await visibleText(probePage);
        const acts = await listActions(probePage);
        const bad =
          status !== 200 ||
          (/not found|404|could not find/i.test(body) &&
            !/\/r\/|\/join\/|\/replay\//.test(u.pathname));
        if (bad || acts.length === 0) {
          check(
            false,
            `link "${l.text}" -> ${u.pathname} (from ${l.from}): status ${status}${acts.length === 0 ? ', dead end' : ''}: ${clip(body, 100)}`,
          );
        }
      } else {
        let status = 'ERR';
        try {
          const res = await api.fetch(l.href, {
            method: 'GET',
            timeout: 20000,
            headers: { origin: '' },
            maxRedirects: 5,
          });
          status = res.status();
        } catch (e) {
          status = `ERR ${clip(e.message, 40)}`;
        }
        if (typeof status !== 'number' || status >= 400) {
          if ([403, 429, 999].includes(status))
            warn(`external ${l.href} -> ${status} (may block bots)`);
          else check(false, `external link "${l.text}" ${l.href} (from ${l.from}) -> ${status}`);
        }
      }
    }
  });
  delete P.crawl;

  // ---- close and name videos
  const vids = [];
  for (const [label, page] of Object.entries(P)) {
    try {
      const v = page.video();
      if (v) vids.push({ label, v });
    } catch {}
  }
  for (const ctx of Object.values(C)) await ctx.close().catch(() => {});
  for (const { label, v } of vids) {
    try {
      const p = await v.path();
      const dest = path.join(VIDEOS, `${PROFILE}-${label}.webm`);
      fs.renameSync(p, dest);
    } catch {}
  }
  await browser.close();

  // ---- outputs
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const md = [];
  md.push(`### Live red team (${PROFILE})`);
  md.push('');
  md.push(
    `Web ${WEB} / API ${API} / ${((Date.now() - t0) / 1000).toFixed(0)} s / ${results.length} steps, ${failed} failed`,
  );
  md.push('');
  md.push('| # | Step | Result | Notes (first failures) | Screenshots |');
  md.push('|---|------|--------|------------------------|-------------|');
  for (const r of results) {
    const bad = r.notes
      .filter((n) => /CHECK FAILED|EXCEPTION|WARN/.test(n))
      .slice(0, 3)
      .join('<br>')
      .replace(/\|/g, '/');
    md.push(`| ${r.id} | ${r.name} | ${r.status} | ${bad || ''} | ${r.shots.length} |`);
  }
  md.push('');
  const errs = events.filter(
    (e) => e.kind !== 'nav' && e.kind !== 'ws.open' && e.kind !== 'ws.close',
  );
  md.push(`Console errors / failed or error responses: ${errs.length}`);
  md.push('');
  md.push('| step | actor | kind | url | text |');
  md.push('|---|---|---|---|---|');
  for (const e of errs.slice(0, 60))
    md.push(
      `| ${e.step || ''} | ${e.label} | ${e.kind} | ${clip(e.url, 80).replace(/\|/g, '/')} | ${clip(e.text, 100).replace(/\|/g, '/')} |`,
    );
  fs.writeFileSync(path.join(OUT, `summary-${PROFILE}.md`), md.join('\n'));
  fs.writeFileSync(
    path.join(OUT, `results-${PROFILE}.json`),
    JSON.stringify(
      {
        results,
        apiLog,
        links: [...new Map(links.map((l) => [l.href + l.from, l])).values()].map((l) => ({
          ...l,
          href: l.href.replace(/(token|invite)=[^&#]+/g, '$1=<r>'),
          raw: (l.raw || '').replace(/(token|invite)=[^&#]+/g, '$1=<r>'),
        })),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(OUT, `events-${PROFILE}.json`),
    JSON.stringify(
      events.map((e) => ({ ...e, url: e.url.replace(/(token|invite)=[^&#]+/g, '$1=<r>') })),
      null,
      2,
    ),
  );
  log(`done: ${failed} failed of ${results.length}`);
  if (SMOKE && (failed > 0 || results.length === 0)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = SMOKE ? 1 : 0; // red team: artifacts matter more than the exit code
});
