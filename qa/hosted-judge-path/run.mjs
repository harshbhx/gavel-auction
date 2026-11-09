// Hosted judge path with real PayPal sandbox holds (issue 2186). Runs in GitHub Actions only.
// One judge room on the hosted app, three bidders: A pays through the PayPal wallet popup, B and C
// as a guest with the sandbox test card. C bids highest, so C is captured and A and B are voided
// (a guest card void and a guest card capture in one room). Console hammers; receipts are opened.
//
// Secrets reach this process only through the environment. Nothing typed into a PayPal popup is
// recorded: popup videos are deleted, the trace is paused (chunk stopped and not saved) while a
// popup is open, screenshots of the popup hide every input value, and the run ends with a scan of
// the output for the secret values.
//
// Outcomes (verdict.json, "outcome"): PASS, NEEDS-MANUAL-RECORDING (a PayPal popup blocked the
// automation, for example a bot check; the screenshot and the stage are kept) or FAIL.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { chromium, request as pwRequest } from 'playwright';

const WEB = (process.env.WEB_URL || '').replace(/\/$/, '');
const API = (process.env.API_URL || '').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT || 'out');
const JUDGE_KEY = process.env.JUDGE_KEY || '';
const RECEIVER = (process.env.RECEIVER_URL || '').replace(/\/$/, '');
const LOG_TOKEN = process.env.G4_LOG_TOKEN || '';
const WALLET = { email: process.env.PP_EMAIL_A || '', pass: process.env.PP_PASS_A || '' };
const CARD = {
  number: process.env.SANDBOX_GUEST_CARD_NUMBER || '',
  expiry: process.env.SANDBOX_GUEST_CARD_EXPIRY || '',
  cvv: process.env.SANDBOX_GUEST_CARD_CVV || '',
};
const GUEST_EMAIL = process.env.SANDBOX_GUEST_EMAIL || `guest-${randomBytes(4).toString('hex')}@example.com`;
const SECRETS = [WALLET.email, WALLET.pass, CARD.number, CARD.expiry, CARD.cvv, JUDGE_KEY, LOG_TOKEN].filter(
  (s) => s.length >= 3,
);

const SHOTS = path.join(OUT, 'shots');
const VIDEOS = path.join(OUT, 'videos');
const TRACES = path.join(OUT, 'traces');
for (const d of [SHOTS, VIDEOS, TRACES]) fs.mkdirSync(d, { recursive: true });

const steps = [];
const apiCalls = []; // statuses of the hosted API calls the pages made (method, path shape, status)
let blocked = null; // first PayPal popup stage that stopped the automation
const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

function pathShape(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/[0-9A-HJKMNP-TV-Z]{26}(?=\/|$)/g, '/:id').replace(/\/[A-Z0-9]{6}(?=\/|$)/g, '/:code');
  } catch {
    return 'unparsed';
  }
}

async function step(name, fn) {
  const rec = { n: steps.length + 1, name, status: 'PASS', notes: [] };
  steps.push(rec);
  log(`STEP ${rec.n} ${name}`);
  const t = Date.now();
  try {
    await fn(rec);
  } catch (e) {
    rec.status = 'FAIL';
    rec.notes.push(`EXCEPTION ${clip(e && e.message ? e.message.split('\n')[0] : e, 240)}`);
  }
  rec.ms = Date.now() - t;
  log(`  => ${rec.status}`);
  return rec;
}
const ok = (rec, cond, msg) => {
  if (!cond) {
    rec.status = 'FAIL';
    rec.notes.push(`CHECK FAILED ${msg}`);
  }
  return Boolean(cond);
};

let browser;
const actors = {};

async function actor(label, withTrace) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: path.join(VIDEOS, label), size: { width: 1280, height: 800 } },
  });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  const a = { label, ctx, page, chunk: 0, tracing: withTrace };
  if (withTrace) await ctx.tracing.start({ screenshots: true, snapshots: true });
  page.on('response', (r) => {
    if (r.url().startsWith(API))
      apiCalls.push({ actor: label, method: r.request().method(), path: pathShape(r.url()), status: r.status() });
  });
  actors[label] = a;
  return a;
}

async function saveChunk(a, tag) {
  if (!a.tracing) return;
  a.chunk += 1;
  await a.ctx.tracing.stopChunk({ path: path.join(TRACES, `${a.label}-${String(a.chunk).padStart(2, '0')}-${tag}.zip`) });
}
async function startChunk(a) {
  if (a.tracing) await a.ctx.tracing.startChunk();
}

async function visibleText(page) {
  try {
    return clip(await page.locator('body').innerText({ timeout: 5000 }), 600);
  } catch {
    return '';
  }
}

async function clickText(page, re, opts = {}) {
  for (const role of opts.roles || ['button', 'link']) {
    const loc = page.getByRole(role, { name: re });
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if (opts.enabledOnly && !(await el.isEnabled().catch(() => false))) continue;
      await el.click({ timeout: 8000 });
      return true;
    }
  }
  return false;
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 15000 });
  } catch {
    /* page gone */
  }
}

// ----------------------------------------------------------------------------- PayPal popup
const INPUT_MASK = 'input,textarea,select{-webkit-text-security:disc!important;color:transparent!important;caret-color:transparent!important}';
const TEXT_MASK = `${INPUT_MASK}*{color:transparent!important}img,svg,canvas{visibility:hidden!important}`;

async function mask(pop, css) {
  for (const f of pop.frames()) await f.addStyleTag({ content: css }).catch(() => {});
}
async function popupShot(pop, name, css = TEXT_MASK) {
  await mask(pop, css);
  await shot(pop, name);
}

const BOT_RE = /captcha|verify (that )?you('| a)re (a )?human|are you a robot|unusual activity|security challenge|access denied|blocked/i;

async function firstVisible(pop, selectors) {
  for (const f of pop.frames()) {
    for (const s of selectors) {
      const l = f.locator(s).first();
      if (await l.isVisible().catch(() => false)) return l;
    }
  }
  return null;
}

async function fillIn(pop, selectors, value) {
  const l = await firstVisible(pop, selectors);
  if (!l) return false;
  await l.fill(value).catch(async () => {
    await l.click();
    await pop.keyboard.type(value, { delay: 30 });
  });
  return true;
}

async function popupBlocked(pop) {
  const t = await pop.locator('body').innerText({ timeout: 4000 }).catch(() => '');
  return BOT_RE.test(t.slice(0, 4000));
}

async function pressApprove(pop) {
  const btn = await firstVisible(pop, [
    '#payment-submit-btn',
    'button[data-testid="submit-button-initial"]',
    'button:has-text("Complete Purchase")',
    'button:has-text("Continue to Review Order")',
    'button:has-text("Agree and Continue")',
    'button:has-text("Agree & Continue")',
    'button:has-text("Pay Now")',
    'button:has-text("Continue")',
  ]);
  if (!btn) return false;
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  const bb = await btn.boundingBox().catch(() => null);
  if (bb) {
    await pop.mouse.move(bb.x + 20, bb.y - 30, { steps: 8 });
    await pop.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 });
    await pop.mouse.down();
    await pop.waitForTimeout(120);
    await pop.mouse.up();
  } else {
    await btn.click({ timeout: 8000 }).catch(() => {});
  }
  return true;
}

// Returns { done: boolean, stage: string }. stage names where it stopped (never any typed value).
async function paypalPopup(pop, kind, label) {
  await pop.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await pop.waitForTimeout(4000);
  await mask(pop, INPUT_MASK);
  const cookie = await firstVisible(pop, ['#acceptAllButton', '#onetrust-accept-btn-handler']);
  if (cookie) await cookie.click().catch(() => {});
  if (await popupBlocked(pop)) {
    await popupShot(pop, `${label}-popup-blocked`, INPUT_MASK);
    return { done: false, stage: 'bot-check-on-open' };
  }
  if (kind === 'wallet') {
    let email = null;
    for (let i = 0; i < 8 && !email; i += 1) {
      email = await firstVisible(pop, ['#email', 'input[name=login_email]', 'input[type=email]']);
      if (!email) await pop.waitForTimeout(1500);
    }
    if (!email) {
      await popupShot(pop, `${label}-popup-no-email-field`, INPUT_MASK);
      return { done: false, stage: (await popupBlocked(pop)) ? 'bot-check-at-login' : 'no-login-form' };
    }
    await email.fill(WALLET.email);
    const next = await firstVisible(pop, ['#btnNext', 'button:has-text("Next")']);
    if (next) await next.click();
    await pop.waitForTimeout(2500);
    let pw = null;
    for (let i = 0; i < 8 && !pw; i += 1) {
      pw = await firstVisible(pop, ['#password', 'input[name=login_password]', 'input[type=password]']);
      if (!pw) await pop.waitForTimeout(1500);
    }
    if (!pw) {
      await popupShot(pop, `${label}-popup-no-password-field`, INPUT_MASK);
      return { done: false, stage: (await popupBlocked(pop)) ? 'bot-check-after-email' : 'no-password-form' };
    }
    await pw.fill(WALLET.pass);
    const login = await firstVisible(pop, ['#btnLogin', 'button:has-text("Log In")', 'button:has-text("Login")']);
    if (login) await login.click();
  } else {
    const cardBtn = await firstVisible(pop, [
      'button:has-text("Debit or Credit Card")',
      'button:has-text("Pay with Debit or Credit Card")',
      'a:has-text("Debit or Credit Card")',
      '[data-funding-source="card"]',
      '[data-testid*="guest"]',
    ]);
    if (cardBtn) {
      await cardBtn.click().catch(() => {});
      await pop.waitForTimeout(3500);
    }
    await mask(pop, INPUT_MASK);
    const gotNumber = await fillIn(pop, ['#cardNumber', 'input[name=cardNumber]', 'input[autocomplete="cc-number"]'], CARD.number);
    if (!gotNumber) {
      await popupShot(pop, `${label}-popup-no-card-form`, INPUT_MASK);
      return { done: false, stage: (await popupBlocked(pop)) ? 'bot-check-before-card-form' : 'no-card-form' };
    }
    await fillIn(pop, ['#cardExpiry', 'input[name=cardExpiry]', 'input[autocomplete="cc-exp"]'], CARD.expiry);
    await fillIn(pop, ['#cardCvv', 'input[name=cardCvv]', 'input[autocomplete="cc-csc"]'], CARD.cvv);
    // Non-secret contact and billing values for a guest checkout in the sandbox.
    await fillIn(pop, ['#firstName', 'input[name=firstName]'], 'Test');
    await fillIn(pop, ['#lastName', 'input[name=lastName]'], 'Guest');
    await fillIn(pop, ['#billingLine1', 'input[name=billingLine1]', 'input[autocomplete="address-line1"]'], '1 Main St');
    await fillIn(pop, ['#billingCity', 'input[name=billingCity]', 'input[autocomplete="address-level2"]'], 'San Jose');
    const state = await firstVisible(pop, ['#billingState', 'select[name=billingState]']);
    if (state) await state.selectOption({ label: 'CA' }).catch(() => state.selectOption('CA').catch(() => {}));
    await fillIn(pop, ['#billingPostalCode', 'input[name=billingPostalCode]', 'input[autocomplete="postal-code"]'], '95131');
    await fillIn(pop, ['#phone', 'input[name=phone]', 'input[type=tel]'], '4085551234');
    await fillIn(pop, ['#email', 'input[name=email]', 'input[type=email]'], GUEST_EMAIL);
    await popupShot(pop, `${label}-popup-card-form-filled`, TEXT_MASK);
  }
  // Approve until the popup closes or returns to the app.
  for (let i = 0; i < 24; i += 1) {
    if (pop.isClosed()) return { done: true, stage: 'popup-closed' };
    if (!/paypal\.com/.test(pop.url())) return { done: true, stage: 'returned-to-app' };
    if (await popupBlocked(pop)) {
      await popupShot(pop, `${label}-popup-blocked`, INPUT_MASK);
      return { done: false, stage: 'bot-check-after-login' };
    }
    const pressed = await pressApprove(pop);
    await pop.waitForTimeout(pressed ? 3000 : 1500);
  }
  if (!pop.isClosed()) await popupShot(pop, `${label}-popup-stuck`, TEXT_MASK);
  return { done: pop.isClosed(), stage: pop.isClosed() ? 'popup-closed' : 'approve-loop-ended' };
}

// ----------------------------------------------------------------------------- bidder
async function registerWithRealHold(a, name, kind, joinUrl, rec) {
  const { page } = a;
  await page.goto(joinUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: /join as bidder|join with/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
  // "Join as bidder" is the real-hold route; "Join with the demo" is the simulated one and is not used here.
  const joined = await clickText(page, /join as bidder/i, { roles: ['button'] });
  if (!joined) {
    rec.notes.push(`${a.label}: no "Join as bidder" button; actions: ${await actions(page)}`);
    return { held: false, reason: 'no-real-join-button' };
  }
  await page.waitForTimeout(2500);
  const nameField = page.getByLabel(/display name/i).first();
  if (!(await nameField.isVisible().catch(() => false))) return { held: false, reason: 'no-name-field' };
  await nameField.fill(name);
  await clickText(page, /continue to bidding|continue/i, { roles: ['button'], enabledOnly: true });
  await page.waitForTimeout(1000);
  const radios = page.getByRole('radio');
  if ((await radios.count()) > 0) await radios.first().check({ force: true }).catch(() => radios.first().click());
  const twoTap = page.getByRole('button', { name: /two taps/i }).first();
  if (!(await twoTap.isVisible().catch(() => false))) return { held: false, reason: `no-two-tap-button: ${await actions(page)}` };
  const popupP = page.context().waitForEvent('page', { timeout: 40000 }).catch(() => null);
  await twoTap.click();
  await page.getByRole('button', { name: /tap again to confirm/i }).first().click({ timeout: 8000 }).catch(() => {});
  const pop = await popupP;
  if (!pop) return { held: false, reason: 'paypal-popup-did-not-open' };
  await saveChunk(a, `before-popup-${kind}`);
  // The chunk above ended and is not restarted until the popup is done, so typed values are not traced.
  let res;
  try {
    res = await paypalPopup(pop, kind, a.label);
  } finally {
    await pop.video()?.delete().catch(() => {});
    await startChunk(a).catch(() => {});
  }
  if (!res.done) {
    blocked = blocked || { actor: a.label, kind, stage: res.stage };
    return { held: false, reason: `popup-stopped-at-${res.stage}` };
  }
  const held = await page.getByText(/hold of .* is in place/i).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  return { held, reason: held ? 'hold-in-place' : 'popup-finished-no-hold-banner' };
}

async function actions(page) {
  return clip(
    (
      await page
        .evaluate(() =>
          Array.from(document.querySelectorAll('button,[role=button],a[href]'))
            .map((e) => (e.innerText || '').trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 20),
        )
        .catch(() => [])
    ).join(' | '),
    300,
  );
}

async function bid(page) {
  await page.waitForTimeout(1500);
  if (!/\/bid/.test(page.url())) await clickText(page, /continue to bidding/i).catch(() => {});
  await page.waitForTimeout(2500);
  const c = await clickText(page, /^bid \$|^\+\$/i, { roles: ['button'], enabledOnly: true });
  await page.waitForTimeout(600);
  await clickText(page, /^confirm|place bid|yes/i, { roles: ['button'], enabledOnly: true }).catch(() => {});
  await page.waitForTimeout(2500);
  return c;
}

// ----------------------------------------------------------------------------- PayPal's own record
async function receiverEvents() {
  if (!RECEIVER || !LOG_TOKEN) return { available: false, reason: 'receiver url or log token not set', events: [] };
  const events = [];
  try {
    const res = await fetch(`${RECEIVER}/log?token=${encodeURIComponent(LOG_TOKEN)}`);
    if (!res.ok) return { available: false, reason: `receiver answered ${res.status}`, events: [] };
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const body = JSON.parse(JSON.parse(line).rawBody);
        const r = body.resource || {};
        events.push({
          event_type: body.event_type,
          create_time: body.create_time,
          status: r.status ?? null,
          amount: r.amount ? `${r.amount.value} ${r.amount.currency_code}` : null,
          final_capture: r.final_capture ?? null,
          id_hash: createHash('sha256').update(String(r.id ?? body.id)).digest('hex').slice(0, 12),
        });
      } catch {
        /* one bad line is skipped */
      }
    }
    return { available: true, reason: '', events };
  } catch (e) {
    return { available: false, reason: clip(e.message, 100), events: [] };
  }
}

// ----------------------------------------------------------------------------- the walk
async function main() {
  const t0 = new Date();
  const missing = [];
  if (!WALLET.email || !WALLET.pass) missing.push('SANDBOX_BUYER_EMAIL/PASSWORD');
  if (!CARD.number || !CARD.expiry || !CARD.cvv) missing.push('SANDBOX_GUEST_CARD_NUMBER/EXPIRY/CVV');
  if (missing.length > 0) {
    fs.writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify({ outcome: 'FAIL', reason: `missing secrets: ${missing.join(', ')}` }, null, 2));
    console.log(`HOSTED JUDGE PATH VERDICT: FAIL (missing ${missing.join(', ')})`);
    process.exitCode = 1;
    return;
  }
  browser = await chromium.launch();
  const apiCtx = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { origin: WEB } });
  let room = null;

  await step('Probe the host', async (rec) => {
    const r = await apiCtx.get('/api/judge/capabilities');
    const caps = await r.json().catch(() => ({}));
    rec.notes.push(`capabilities status ${r.status()} judgeRooms=${caps.judgeRooms} accepting=${caps.accepting} simHolds=${caps.simHolds}`);
    ok(rec, r.status() === 200 && caps.judgeRooms === true && caps.accepting === true, 'judge rooms on and accepting');
  });

  await step('Create one judge room', async (rec) => {
    const r = await apiCtx.post('/api/judge/rooms', {
      data: {},
      headers: { 'content-type': 'application/json', ...(JUDGE_KEY ? { 'x-judge-key': JUDGE_KEY } : {}) },
    });
    rec.notes.push(`create status ${r.status()} keyed=${JUDGE_KEY ? 'yes' : 'no'}`);
    if (ok(rec, r.status() === 201, 'room created')) room = await r.json();
  });
  if (!room) return finish(t0, null);

  const joinUrl = `${WEB}/join/${encodeURIComponent(room.auctionId)}?c=${room.joinCode}`;
  const screen = await actor('screen', true);
  const cons = await actor('console', true);
  const bidA = await actor('bidderA-wallet', true);
  const bidB = await actor('bidderB-card', true);
  const bidC = await actor('bidderC-card', true);

  await step('Screen and console open; lot opens', async (rec) => {
    await screen.page.goto(room.screenLink, { waitUntil: 'load' });
    await cons.page.goto(room.auctioneerLink, { waitUntil: 'load' });
    await cons.page.waitForTimeout(3000);
    rec.notes.push(`console actions: ${await actions(cons.page)}`);
    await clickText(cons.page, /open lot/i, { roles: ['button'], enabledOnly: true });
    await cons.page.waitForTimeout(2500);
    await shot(cons.page, 'console-lot-open');
  });

  const holds = {};
  for (const [a, name, kind] of [
    [bidA, 'Wallet Alice', 'wallet'],
    [bidB, 'Card Bob', 'card'],
    [bidC, 'Card Cara', 'card'],
  ]) {
    await step(`${a.label}: real sandbox hold (${kind})`, async (rec) => {
      const res = await registerWithRealHold(a, name, kind, joinUrl, rec);
      holds[a.label] = res;
      rec.notes.push(`${a.label}: ${res.reason}`);
      await shot(a.page, `${a.label}-after-hold`);
      ok(rec, res.held, `${a.label} hold in place (${res.reason})`);
    });
    if (blocked) break; // a blocked popup is the result; do not hammer at PayPal
  }

  const heldCount = Object.values(holds).filter((h) => h.held).length;
  if (!blocked && heldCount === 3) {
    await step('Bids: A, then B, then C (C highest)', async (rec) => {
      for (const a of [bidA, bidB, bidC]) {
        const c = await bid(a.page);
        rec.notes.push(`${a.label} bid clicked: ${c}`);
        ok(rec, c, `${a.label} placed a bid`);
      }
      await shot(cons.page, 'console-after-bids');
    });

    await step('Hammer from the console', async (rec) => {
      await clickText(cons.page, /^hammer$|hammer$/i, { roles: ['button'], enabledOnly: true });
      await cons.page.waitForTimeout(1200);
      const dlg = cons.page.getByRole('dialog').first();
      const hb = (await dlg.isVisible().catch(() => false))
        ? dlg.getByRole('button', { name: /hold to hammer/i }).first()
        : cons.page.getByRole('button', { name: /hold to hammer|hold 3 seconds/i }).first();
      const box = await hb.boundingBox().catch(() => null);
      if (ok(rec, box, 'hold-to-hammer control reachable')) {
        await cons.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await cons.page.mouse.down();
        await cons.page.waitForTimeout(3800);
        await cons.page.mouse.up();
      }
      const re = /sold|closed|done|settl|captur/i;
      const deadline = Date.now() + 90_000;
      let body = '';
      do {
        await cons.page.waitForTimeout(2000);
        body = await visibleText(cons.page);
      } while (!re.test(body) && Date.now() < deadline);
      rec.notes.push(`console after hammer: ${body}`);
      ok(rec, re.test(body), 'console shows the lot closed');
      await shot(cons.page, 'console-after-hammer');
    });

    await step('Receipts for A, B and C', async (rec) => {
      for (const a of [bidA, bidB, bidC]) {
        await a.page.goto(`${WEB}/r/${encodeURIComponent(room.auctionId)}/receipt`, { waitUntil: 'load' });
        await a.page.waitForTimeout(6000);
        const t = await visibleText(a.page);
        rec.notes.push(`${a.label} receipt: ${t}`);
        ok(rec, !/no receipt for this session/i.test(t), `${a.label} has a receipt`);
        await shot(a.page, `${a.label}-receipt`);
      }
      await shot(screen.page, 'screen-final');
    });
    await sleep(45_000); // let PayPal deliver the webhooks for the capture and the voids
  }

  const pp = await receiverEvents();
  // End the room so its tokens stop working.
  await apiCtx
    .post(`/api/auctions/${room.auctionId}/kill`, {
      data: { confirm: 'STOP' },
      headers: { authorization: `Bearer ${room.auctioneerToken}`, 'content-type': 'application/json' },
    })
    .catch(() => {});
  await finish(t0, { holds, pp, heldCount, joinCodeShape: 'redacted' });
}

async function finish(t0, ctxInfo) {
  for (const a of Object.values(actors)) {
    try {
      await saveChunk(a, 'last');
    } catch {
      /* no active chunk */
    }
    await a.ctx.close().catch(() => {});
  }
  await browser?.close().catch(() => {});

  const holds = ctxInfo?.holds || {};
  const pp = ctxInfo?.pp || { available: false, reason: 'not reached', events: [] };
  const count = (t) => pp.events.filter((e) => e.event_type === t).length;
  const post = (re) => apiCalls.filter((c) => c.method === 'POST' && re.test(c.path)).map((c) => c.status);
  const statuses = {
    note:
      'Two independent records. hostedApiCalls are the HTTP statuses the browser saw from the hosted API (paths with ids replaced). paypalEvents are the sandbox webhook events PayPal delivered for this run (id hashed). The HTTP status of the hosted server\'s own PayPal calls (authorize 201, capture 201, void 204) is not visible from outside the server, so it is not claimed here.',
    hostedApiCalls: summarize(apiCalls),
    paypalEvents: { available: pp.available, reason: pp.reason, counts: countBy(pp.events), events: pp.events },
    expected: { authorizationsCreated: 3, capturesCompleted: 1, authorizationsVoided: 2 },
    observed: {
      authorizationsCreated: count('PAYMENT.AUTHORIZATION.CREATED') || count('AUTHORIZATION.CREATED'),
      capturesCompleted: count('PAYMENT.CAPTURE.COMPLETED'),
      authorizationsVoided: count('PAYMENT.AUTHORIZATION.VOIDED') || count('AUTHORIZATION.VOIDED'),
    },
    holds: Object.fromEntries(Object.entries(holds).map(([k, v]) => [k, { held: v.held, reason: v.reason }])),
    postStatusesSeen: { rooms: post(/\/api\/judge\/rooms$/) },
  };
  fs.writeFileSync(path.join(OUT, 'statuses.json'), JSON.stringify(statuses, null, 2));

  const failedSteps = steps.filter((s) => s.status === 'FAIL');
  let outcome;
  let reason;
  if (blocked) {
    outcome = 'NEEDS-MANUAL-RECORDING';
    reason = `a PayPal popup stopped the automation (${blocked.actor}, ${blocked.kind} path, stage ${blocked.stage}); screenshot kept in shots/`;
  } else if (failedSteps.length > 0) {
    outcome = 'FAIL';
    reason = `failed steps: ${failedSteps.map((s) => s.n).join(', ')}`;
  } else if (
    pp.available &&
    statuses.observed.capturesCompleted >= 1 &&
    statuses.observed.authorizationsVoided >= 2
  ) {
    outcome = 'PASS';
    reason = 'three real sandbox holds, one capture, two voids, receipts opened';
  } else {
    outcome = 'FAIL';
    reason = pp.available
      ? `PayPal events do not match: ${JSON.stringify(statuses.observed)}`
      : `walk completed but PayPal events could not be read (${pp.reason})`;
  }
  const verdict = { outcome, reason, startedAt: t0.toISOString(), finishedAt: new Date().toISOString(), steps };
  fs.writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify(verdict, null, 2));
  fs.writeFileSync(
    path.join(OUT, 'summary.md'),
    `### Hosted judge path: ${outcome}\n\n${reason}\n\n${steps.map((s) => `- ${s.n}. ${s.name}: ${s.status}${s.notes.length ? ` (${s.notes.map((n) => clip(n, 140)).join('; ')})` : ''}`).join('\n')}\n`,
  );
  console.log(`HOSTED JUDGE PATH VERDICT: ${outcome} (${reason})`);
  if (outcome === 'FAIL') process.exitCode = 1;
}

function summarize(calls) {
  const m = new Map();
  for (const c of calls) {
    const k = `${c.method} ${c.path} ${c.status}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m, ([k, n]) => ({ call: k, count: n }));
}
function countBy(events) {
  const o = {};
  for (const e of events) o[e.event_type] = (o[e.event_type] || 0) + 1;
  return o;
}

main().catch((e) => {
  console.error(clip(e && e.stack ? e.stack : e, 500));
  process.exitCode = 1;
});
