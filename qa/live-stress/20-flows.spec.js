// Flows under abuse: rapid clicks, back/forward/refresh mid-flow, two tabs, many actors,
// resize and rotate, and the pacing of the scripted demo.
import {
  test,
  WEB,
  auditLayout,
  bodyText,
  clip,
  finding,
  gotoOk,
  loadState,
  reportAudit,
  sleep,
  watch,
} from './lib.js';

const room = () => loadState().rooms?.A;

async function ensureHub(page, A) {
  await gotoOk(page, A.hubUrl);
  await page.waitForSelector('.gv-hub__flap, .gv-hub__pending', { timeout: 20000 }).catch(() => {});
}

test('hub: rapid clicks on every button', async ({ page }) => {
  const A = room();
  test.skip(!A, 'no room');
  const w = watch(page, { allowConsole: true });
  let invitePosts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/invites$/.test(r.url())) invitePosts += 1;
  });
  await ensureHub(page, A);
  for (const name of [/copy code/i, /copy join link/i, /share all links/i]) {
    const b = page.getByRole('button', { name }).first();
    if (!(await b.isVisible().catch(() => false))) {
      await finding(page, {
        sev: 'medium',
        title: `Hub is missing the "${name.source}" button`,
        page: 'hub',
        expected: 'button present',
        actual: 'not visible',
      });
      continue;
    }
    for (let i = 0; i < 12; i += 1)
      await b.click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
  }
  const inv = page.getByRole('button', { name: /new bidder invite/i }).first();
  if (await inv.isVisible().catch(() => false)) {
    await inv.evaluate((b) => {
      for (let i = 0; i < 6; i += 1) b.click();
    });
    await page.waitForTimeout(4000);
    if (invitePosts > 1)
      await finding(page, {
        sev: 'medium',
        title: 'New bidder invite double submit mints several invites',
        page: 'hub',
        steps: 'click "New bidder invite" six times in one tick',
        expected: 'one invite request while busy',
        actual: `${invitePosts} POST /invites`,
        cause:
          'packages/web/src/screens/hub/JudgeHub.tsx invite handler (busy flag set after the first await)',
      });
    const open = page.getByRole('link', { name: /open bidder/i }).first();
    if (!(await open.isVisible().catch(() => false)))
      await finding(page, {
        sev: 'high',
        title: 'After "New bidder invite" there is no Open bidder link',
        page: 'hub',
        expected: 'link or QR with the invite',
        actual: clip(await bodyText(page), 200),
      });
  } else
    await finding(page, {
      sev: 'medium',
      title: 'Hub has no "New bidder invite" button',
      page: 'hub',
      expected: 'button',
      actual: 'missing',
    });
  await w.flush();
});

test('hub: refresh, back and forward keep the room and the keys', async ({ page }) => {
  const A = room();
  test.skip(!A, 'no room');
  const w = watch(page, { allowConsole: true });
  await ensureHub(page, A);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.gv-hub__flap', { timeout: 20000 }).catch(() => {});
  let t = await bodyText(page);
  if (!/join code/i.test(t))
    await finding(page, {
      sev: 'high',
      title: 'Hub loses the room after a refresh',
      page: 'hub',
      steps: 'open the hub, press reload',
      expected: 'same hub with the code',
      actual: clip(t, 200),
    });
  await gotoOk(page, `${WEB}/`);
  await page.goBack({ waitUntil: 'load' });
  await page.waitForSelector('.gv-hub__flap', { timeout: 20000 }).catch(() => {});
  t = await bodyText(page);
  if (!/join code/i.test(t))
    await finding(page, {
      sev: 'high',
      title: 'Back to the hub shows no code',
      page: 'hub',
      steps: 'hub -> landing -> browser back',
      expected: 'hub with the code',
      actual: clip(t, 200),
    });
  await page.goForward({ waitUntil: 'load' }).catch(() => {});
  await page.goBack({ waitUntil: 'load' }).catch(() => {});
  await w.flush();
});

test('watcher then bidder: join page, Just watch, Join as a bidder, back/forward/refresh', async ({
  page,
}) => {
  const A = room();
  test.skip(!A, 'no room');
  const w = watch(page, { allowConsole: true });
  await gotoOk(page, A.joinUrl);
  const text0 = await bodyText(page);
  const asBidder = () =>
    page
      .getByRole('link', { name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i })
      .or(
        page.getByRole('button', {
          name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i,
        }),
      )
      .first();
  const watchBtn = page
    .getByRole('link', { name: /just watch|watch/i })
    .or(page.getByRole('button', { name: /just watch|watch/i }))
    .first();
  if (
    !(await asBidder()
      .isVisible()
      .catch(() => false))
  )
    return finding(page, {
      sev: 'high',
      title: 'Join page has no "Join as bidder" action',
      page: 'join',
      expected: 'join as bidder',
      actual: clip(text0, 240),
    });
  if (!(await watchBtn.isVisible().catch(() => false)))
    await finding(page, {
      sev: 'low',
      title: 'Join page has no "Just watch" action',
      page: 'join',
      expected: 'a watch option',
      actual: clip(text0, 200),
    });
  else {
    await watchBtn.click();
    await page.waitForTimeout(3000);
    const t = await bodyText(page);
    if (/expired|start again|not found/i.test(t))
      await finding(page, {
        sev: 'high',
        title: 'Just watch ends on an expired or error page',
        page: 'join',
        steps: 'press Just watch on a live room',
        expected: 'the live screen',
        actual: clip(t, 200),
      });
    // the reported bug: a watcher who now joins as a bidder is thrown out
    const again = asBidder();
    if (await again.isVisible().catch(() => false)) {
      await again.click();
      await page.waitForTimeout(3000);
      const t2 = await bodyText(page);
      const form = await page
        .getByLabel(/display name/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (!form)
        await finding(page, {
          sev: 'high',
          title: 'Watcher cannot become a bidder',
          page: 'join',
          steps: 'Just watch, then Join as a bidder',
          expected: 'registration form',
          actual: `url ${page.url().replace(/#.*/, '')}; ${clip(t2, 200)}`,
          cause: 'packages/web/src/App.tsx openJoin / WatcherGate',
        });
    } else
      await finding(page, {
        sev: 'medium',
        title: 'No way to become a bidder from the watcher view',
        page: 'watch view',
        steps: 'Just watch',
        expected: 'a Join as bidder control',
        actual: clip(t, 200),
      });
  }
  // fresh: rapid double click on Join as a bidder
  await gotoOk(page, A.joinUrl);
  let navs = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navs += 1;
  });
  await asBidder()
    .evaluate((b) => {
      for (let i = 0; i < 8; i += 1) b.click();
    })
    .catch(() => {});
  await page.waitForTimeout(3000);
  const form = await page
    .getByLabel(/display name/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (!form)
    await finding(page, {
      sev: 'high',
      title: 'Rapid clicks on Join as a bidder leave the user without a form',
      page: 'join',
      steps: 'click Join as a bidder eight times in one tick',
      expected: 'registration form',
      actual: clip(await bodyText(page), 200),
    });
  // mid-flow: type a name, refresh, back, forward
  const name = page.getByLabel(/display name/i).first();
  if (form) {
    await name.fill('Mid Flow');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const still = await page
      .getByLabel(/display name/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!still)
      await finding(page, {
        sev: 'high',
        title: 'Refreshing the registration form kicks the user out',
        page: 'register',
        steps: 'open the form, press reload',
        expected: 'the form again (invite kept)',
        actual: `url ${page.url().replace(/#.*/, '')}; ${clip(await bodyText(page), 200)}`,
        cause: 'invite token is single use and removed from the URL on first load',
      });
    await page.goBack({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.goForward({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1200);
    const t = await bodyText(page);
    if (t.trim().length < 15)
      await finding(page, {
        sev: 'high',
        title: 'Blank page after back and forward in registration',
        page: 'register',
        expected: 'form or a clear message',
        actual: 'blank',
      });
  }
  await w.flush();
});

test('two tabs, same session', async ({ context }) => {
  const A = room();
  test.skip(!A, 'no room');
  const p1 = await context.newPage();
  const p2 = await context.newPage();
  const w1 = watch(p1, { allowConsole: true });
  const w2 = watch(p2, { allowConsole: true });
  await gotoOk(p1, A.joinUrl);
  await gotoOk(p2, A.joinUrl);
  for (const p of [p1, p2]) {
    const b = p
      .getByRole('link', { name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i })
      .or(
        p.getByRole('button', {
          name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i,
        }),
      )
      .first();
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await sleep(3000);
  const ok = [];
  for (const p of [p1, p2])
    ok.push(
      await p
        .getByLabel(/display name/i)
        .first()
        .isVisible()
        .catch(() => false),
    );
  if (ok.includes(false))
    await finding(ok[0] ? p2 : p1, {
      sev: 'medium',
      title: 'Second tab in the same session does not reach the form',
      page: 'register',
      steps: 'open the join page in two tabs, join as a bidder in both',
      expected: 'both tabs show the form',
      actual: `tab1 form=${ok[0]} tab2 form=${ok[1]}: ${clip(await bodyText(ok[0] ? p2 : p1), 180)}`,
    });
  await w1.flush();
  await w2.flush();
});

test('six actors in parallel contexts: 2 bidders, 3 watchers, 1 hub', async ({ browser }) => {
  const A = room();
  test.skip(!A, 'no room');
  const actors = [];
  const mk = async (label, url) => {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const page = await ctx.newPage();
    const w = watch(page, { allowConsole: true });
    let wsOpen = 0;
    page.on('websocket', () => {
      wsOpen += 1;
    });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    actors.push({ label, ctx, page, w, ws: () => wsOpen });
  };
  await mk('hub', A.hubUrl);
  await mk('watch1', A.screenUrl || A.joinUrl);
  await mk('watch2', A.screenUrl || A.joinUrl);
  await mk('watch3', A.joinUrl);
  await mk('bidder1', A.joinUrl);
  await mk('bidder2', A.joinUrl);
  await sleep(6000);
  for (const a of actors) {
    const t = await bodyText(a.page);
    if (t.trim().length < 15)
      await finding(a.page, {
        sev: 'high',
        title: `Actor ${a.label} sees a blank page with six clients in the room`,
        page: a.label,
        expected: 'content',
        actual: 'blank',
      });
    if (/something went wrong|error|expired/i.test(t) && !/no error/i.test(t))
      await finding(a.page, {
        sev: 'medium',
        title: `Actor ${a.label} sees an error with six clients`,
        page: a.label,
        expected: 'normal view',
        actual: clip(t, 200),
      });
  }
  // two bidders press Join as a bidder at the same moment
  await Promise.all(
    actors
      .filter((a) => a.label.startsWith('bidder'))
      .map(async (a) => {
        const b = a.page
          .getByRole('link', {
            name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i,
          })
          .or(
            a.page.getByRole('button', {
              name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i,
            }),
          )
          .first();
        if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
      }),
  );
  await sleep(3500);
  for (const a of actors.filter((x) => x.label.startsWith('bidder'))) {
    const form = await a.page
      .getByLabel(/display name/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!form)
      await finding(a.page, {
        sev: 'high',
        title: 'Simultaneous bidders: one does not get the registration form',
        page: a.label,
        expected: 'form',
        actual: clip(await bodyText(a.page), 200),
      });
  }
  for (const a of actors) {
    await a.w.flush();
    await a.ctx.close();
  }
});

test('resize and rotate mid-flow keep state and layout', async ({ page }) => {
  const A = room();
  test.skip(!A, 'no room');
  const w = watch(page, { allowConsole: true });
  const vp = page.viewportSize();
  await gotoOk(page, A.joinUrl);
  const b = page
    .getByRole('link', { name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i })
    .or(
      page.getByRole('button', {
        name: /use the paypal sandbox|join with the demo|join as (a )?bidder/i,
      }),
    )
    .first();
  if (await b.isVisible().catch(() => false)) await b.click();
  await page.waitForTimeout(2500);
  const name = page.getByLabel(/display name/i).first();
  const hasForm = await name.isVisible().catch(() => false);
  if (hasForm) await name.fill('Rotate Me');
  for (const s of [
    { width: vp.height, height: vp.width },
    { width: 320, height: 568 },
    { width: 1920, height: 1080 },
    { width: 768, height: 1024 },
    vp,
  ]) {
    await page.setViewportSize(s);
    await page.waitForTimeout(500);
    const a = await auditLayout(page);
    await reportAudit(page, a, { skipLandmarks: true, skipEmpty: s.width < 1000 });
    if (hasForm) {
      const v = await name.inputValue().catch(() => null);
      if (v !== 'Rotate Me')
        await finding(page, {
          sev: 'medium',
          title: 'Typed name is lost when the window is resized',
          page: 'register',
          steps: `type a name, resize to ${s.width}x${s.height}`,
          expected: 'value kept',
          actual: `value "${v}"`,
        });
    }
  }
  await w.flush();
});

test('scripted demo: pacing, rapid clicks, refresh and back/forward', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  await page.addInitScript(() => {
    window.__snaps = [];
    const sample = () => {
      const m = document.querySelector('main') || document.body;
      const heads = [...m.querySelectorAll('h1,h2,h3,[aria-live]')]
        .map((e) => e.innerText.trim())
        .join('|');
      window.__snaps.push({
        t: performance.now(),
        len: (m.innerText || '').length,
        heads,
        text: (m.innerText || '').slice(0, 4000),
      });
    };
    setInterval(() => document.body && sample(), 250);
  });
  await gotoOk(page, WEB + '/demo/scripted', { noSettle: true });
  const start = page.getByRole('button', { name: /start|play|begin|run/i }).first();
  if (await start.isVisible().catch(() => false)) await start.click().catch(() => {});
  await page.waitForTimeout(30000);
  const snaps = await page.evaluate(() => window.__snaps);
  // a "change" is a sample whose text differs; measure how many characters changed per second and
  // how long each distinct visible text stays on screen
  const changes = [];
  let prev = snaps[0]?.text;
  let prevT = snaps[0]?.t;
  for (const s of snaps.slice(1)) {
    if (s.text !== prev) {
      const diff = Math.abs(s.text.length - (prev || '').length) + (s.text === prev ? 0 : 1);
      changes.push({ t: s.t, dwell: s.t - prevT, diff });
      prev = s.text;
      prevT = s.t;
    }
  }
  const secs = (snaps[snaps.length - 1]?.t - snaps[0]?.t) / 1000 || 1;
  const fast = changes.filter((c) => c.dwell < 1500).length;
  const median =
    changes.map((c) => c.dwell).sort((a, b) => a - b)[Math.floor(changes.length / 2)] || 0;
  const note = `${changes.length} text changes in ${secs.toFixed(0)} s (${(changes.length / secs).toFixed(2)}/s), ${fast} lasted under 1.5 s, median dwell ${(median / 1000).toFixed(1)} s`;
  test.info().annotations.push({ type: 'scripted-pacing', description: note });
  if (
    changes.length / secs > 1 ||
    fast > changes.length * 0.4 ||
    (changes.length > 3 && median < 2000)
  )
    await finding(page, {
      sev: 'high',
      title: 'Scripted demo changes faster than a person can read',
      page: '/demo/scripted',
      steps:
        'open the scripted demo, press start if offered, watch 30 s sampling the main text every 250 ms',
      expected: 'steps stay on screen at least 3 s, one idea at a time',
      actual: note,
      cause: 'packages/web/src/net/scriptedMode.ts, screens/demo scripted scenario tick interval',
    });
  else if (changes.length === 0)
    await finding(page, {
      sev: 'medium',
      title: 'Scripted demo never changes in 30 s',
      page: '/demo/scripted',
      expected: 'it plays',
      actual: 'no text change; start control: ' + (await start.isVisible().catch(() => false)),
    });
  // rapid clicks on every button, then refresh and back/forward
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button'))
      if (!b.disabled) for (let i = 0; i < 5; i += 1) b.click();
  });
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await gotoOk(page, WEB + '/demo/scripted/bid');
  await page.goBack({ waitUntil: 'load' }).catch(() => {});
  await page.goForward({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(1000);
  if ((await bodyText(page)).trim().length < 15)
    await finding(page, {
      sev: 'high',
      title: 'Scripted demo blank after rapid clicks, refresh, back/forward',
      page: '/demo/scripted/bid',
      expected: 'content',
      actual: 'blank',
    });
  await w.flush();
});
