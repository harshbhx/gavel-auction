// Creates the two rooms the whole run reuses, through the real /try page. The first room is also
// the double-submit test: ten fast clicks on the start button, with a guard that lets only one
// room-creation request through to the server and counts how many the page tried to send.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { API, OUT, STATE_FILE, WEB, clip, redact } from './lib.js';

const state = { rooms: {}, notes: [], startedAt: new Date().toISOString() };
const note = (m) => {
  state.notes.push(m);
  console.log('[setup]', m);
};
const emit = (rec) =>
  fs.appendFileSync(
    path.join(OUT, 'findings.jsonl'),
    JSON.stringify({ project: 'setup', spec: 'global-setup', viewport: '1440x900', ...rec }) + '\n',
  );

async function wake() {
  for (let i = 0; i < 8; i += 1) {
    try {
      const r = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return false;
}

async function readHub(page) {
  await page
    .waitForSelector('.gv-hub__flaps, .gv-hub__pending', { timeout: 25000 })
    .catch(() => {});
  await page.waitForSelector('.gv-hub__flap', { timeout: 15000 }).catch(() => {});
  const flaps = await page
    .locator('.gv-hub__flap')
    .allInnerTexts()
    .catch(() => []);
  const code = flaps.join('').replace(/\s/g, '') || null;
  const anchors = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.href,
      text: (a.innerText || '').trim(),
    })),
  );
  const pick = (re) => anchors.find((a) => re.test(a.text))?.href || null;
  return {
    code,
    consoleUrl: pick(/console/i),
    screenUrl: pick(/screen/i),
    bidderUrl: pick(/bidder/i),
  };
}

async function makeRoom(browser, label, rapid) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let posts = 0;
  let status = 0;
  await page.route('**/api/judge/rooms', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    if (posts > 1)
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: '{"error":"stress-guard"}',
      });
    const res = await route.fetch();
    status = res.status();
    return route.fulfill({ response: res });
  });
  try {
    await page.goto(`${WEB}/try`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    const btn = page.getByRole('button', { name: /start a demo room/i }).first();
    if (!(await btn.isVisible().catch(() => false))) {
      note(
        `${label}: no start button visible: ${clip(
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
          160,
        )}`,
      );
      return null;
    }
    if (!(await btn.isEnabled().catch(() => false))) {
      note(
        `${label}: start button disabled: ${clip(
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
          160,
        )}`,
      );
      return null;
    }
    if (rapid) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          /start a demo room/i.test(x.innerText),
        );
        for (let i = 0; i < 10; i += 1) b.click();
      });
      for (let i = 0; i < 5; i += 1) {
        await btn.click({ timeout: 1000, noWaitAfter: true }).catch(() => {});
        await page.waitForTimeout(30);
      }
    } else {
      await btn.click();
    }
    const arrived = await page
      .waitForURL(/\/r\/[^/]+\/(hub|console)/, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (rapid && posts > 1)
      emit({
        id: 'S-1',
        sev: 'high',
        title: 'Start button double submit sends several room-creation requests',
        page: '/try',
        steps: 'open /try, click "Start a demo room" 15 times as fast as possible',
        expected: 'exactly one POST /api/judge/rooms (button locks on the first click)',
        actual: `the page sent ${posts} POSTs (the guard let only the first through and answered the rest 429). Unguarded, this would spend ${posts} of the 5 live rooms and the 4/hour address limit`,
        evidence: '',
        cause:
          'packages/web/src/screens/demo/DemoLauncher.tsx start() / judge panel start handler: busy state is set after render, so synchronous clicks all pass',
      });
    if (!arrived) {
      note(
        `${label}: did not reach hub; POSTs ${posts}, status ${status}; page says: ${clip(
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
          200,
        )}`,
      );
      emit({
        id: `S-${label}`,
        sev: 'high',
        title: 'Start a demo room did not reach the hub',
        page: '/try',
        steps: 'click start once',
        expected: 'hub page',
        actual: `url ${redact(page.url())}, status ${status}, text: ${clip(
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
          160,
        )}`,
      });
      return null;
    }
    const hubUrl = page.url();
    const roomId = decodeURIComponent(/\/r\/([^/?#]+)\//.exec(hubUrl)[1]);
    const hub = await readHub(page);
    const joinUrl = `${WEB}/join/${encodeURIComponent(roomId)}${hub.code ? `?c=${hub.code}` : ''}`;
    note(
      `${label}: room ${roomId.slice(0, 4)}.. code ${hub.code}, posts ${posts}, hub links console=${!!hub.consoleUrl} screen=${!!hub.screenUrl} bidder=${!!hub.bidderUrl}`,
    );
    return { roomId, hubUrl, joinUrl, ...hub, posts, createdAt: Date.now() };
  } finally {
    await ctx.close();
  }
}

export default async function globalSetup() {
  fs.mkdirSync(OUT, { recursive: true });
  const up = await wake();
  note(`API healthz up: ${up}`);
  if (!up)
    emit({
      id: 'S-0',
      sev: 'high',
      title: 'API did not answer /healthz for 4 minutes',
      page: API,
      steps: 'GET /healthz with retries',
      expected: '200',
      actual: 'no answer',
    });
  let accepting = null;
  try {
    const cap = await fetch(`${API}/api/judge/capabilities`, {
      signal: AbortSignal.timeout(20000),
    });
    const txt = await cap.text();
    accepting = /"accepting":true/.test(txt);
    note(`capabilities ${cap.status}: ${clip(txt, 160)}`);
  } catch (e) {
    note(`capabilities error ${clip(e.message, 80)}`);
  }
  if (accepting !== false) {
    const browser = await chromium.launch();
    try {
      state.rooms.A = await makeRoom(browser, 'A', true);
      // Second room only if the first worked; a single click this time.
      if (state.rooms.A) state.rooms.B = await makeRoom(browser, 'B', false);
    } finally {
      await browser.close();
    }
  } else {
    note('judge rooms are not accepting; room specs will skip');
    emit({
      id: 'S-cap',
      sev: 'info',
      title: 'Judge rooms not accepting at run time',
      page: '/try',
      steps: 'GET /api/judge/capabilities',
      expected: 'accepting true',
      actual: 'accepting false (cap or paused); room-bound specs skipped',
    });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}
