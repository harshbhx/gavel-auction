// Offline, slow 3G, flaky API, websocket drop, blocked images and fonts, JavaScript disabled.
import {
  test,
  WEB,
  API,
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
const OFFLINE_WORDS = /offline|reconnect|connection|no network|not connected/i;

test('offline and back online on the live pages', async ({ page, context }) => {
  const A = room();
  const targets = [
    ['/', WEB + '/'],
    ['/demo/scripted', WEB + '/demo/scripted'],
  ];
  if (A) targets.push(['hub', A.hubUrl], ['screen', A.screenUrl || A.joinUrl], ['join', A.joinUrl]);
  const w = watch(page, { allowConsole: true, ignoreFailed: /./ });
  for (const [label, url] of targets) {
    await gotoOk(page, url);
    await page.waitForTimeout(2500);
    await context.setOffline(true);
    await page.waitForTimeout(5000);
    const t = await bodyText(page);
    if (t.trim().length < 15)
      await finding(page, {
        sev: 'high',
        title: 'Page goes blank when the network drops',
        page: label,
        steps: 'load the page, go offline for 7 s',
        expected: 'content stays with an offline notice',
        actual: 'blank',
      });
    else if (/hub|screen|join/.test(label) && !OFFLINE_WORDS.test(t))
      await finding(page, {
        sev: 'medium',
        title: 'Live page gives no offline notice',
        page: label,
        steps: 'load the live page, go offline for 7 s',
        expected: 'a visible "You are offline. Reconnecting." style notice',
        actual: clip(t, 160),
      });
    await context.setOffline(false);
    await page.waitForTimeout(8000);
    const t2 = await bodyText(page);
    if (/hub|screen|join/.test(label) && OFFLINE_WORDS.test(t2) && /you are offline/i.test(t2))
      await finding(page, {
        sev: 'medium',
        title: 'Offline notice stays after the network returns',
        page: label,
        steps: 'offline 7 s then online, wait 12 s',
        expected: 'notice clears and the page updates',
        actual: clip(t2, 160),
      });
  }
  await context.setOffline(false);
  await w.flush();
});

test('offline navigation: what a fresh load shows', async ({ page, context }) => {
  await gotoOk(page, WEB + '/');
  await context.setOffline(true);
  const r = await page
    .goto(WEB + '/try', { timeout: 15000 })
    .then(() => 'loaded')
    .catch((e) => clip(e.message, 100));
  const t = await bodyText(page);
  test
    .info()
    .annotations.push({ type: 'offline-navigation', description: `${r}; text: ${clip(t, 100)}` });
  if (r === 'loaded' && t.trim().length < 15)
    await finding(page, {
      sev: 'low',
      title: 'Offline load of a visited route shows a blank page',
      page: '/try',
      expected: 'cached page or a clear offline page',
      actual: 'blank',
    });
  await context.setOffline(false);
});

test('slow 3G: time to first content and a loading state', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  const w = watch(page, { allowConsole: true });
  for (const p of ['/', '/try', '/demo/scripted']) {
    const t0 = Date.now();
    await page.goto(WEB + p, { waitUntil: 'commit', timeout: 120000 });
    let firstText = null;
    for (let i = 0; i < 300 && firstText === null; i += 1) {
      const t = await bodyText(page);
      if (t.trim().length > 20) firstText = Date.now() - t0;
      else await sleep(200);
    }
    test
      .info()
      .annotations.push({ type: 'slow3g', description: `${p} first text after ${firstText} ms` });
    if (firstText === null || firstText > 15000)
      await finding(page, {
        sev: 'medium',
        title: 'Slow 3G: no readable content within 15 s',
        page: p,
        steps: 'throttle to 400 kbps, 400 ms latency, open the page',
        expected: 'content or a loading state within 15 s',
        actual: `first text after ${firstText} ms`,
      });
    await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});
    await settle(page);
    if (/\//.test(p))
      await reportAudit(page, await auditLayout(page), { skipLandmarks: true, skipEmpty: true });
  }
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await w.flush();
});
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
}

test('flaky API: every third API call fails or is slow', async ({ page }) => {
  const A = room();
  test.skip(!A, 'no room');
  let n = 0;
  await page.route(`${API}/**`, async (route) => {
    n += 1;
    if (n % 3 === 0) return route.abort('failed');
    if (n % 3 === 1) await sleep(1500);
    return route.continue();
  });
  const w = watch(page, { allowConsole: true, ignoreFailed: /./ });
  for (const [label, url] of [
    ['hub', A.hubUrl],
    ['join', A.joinUrl],
    ['screen', A.screenUrl || A.joinUrl],
  ]) {
    await gotoOk(page, url, { noSettle: true });
    await page.waitForTimeout(12000);
    const t = await bodyText(page);
    if (t.trim().length < 15)
      await finding(page, {
        sev: 'high',
        title: 'Blank page when API calls fail intermittently',
        page: label,
        steps: 'abort every third API request, wait 12 s',
        expected: 'content or an error with retry',
        actual: 'blank',
      });
    const spinner = await page
      .locator(
        '[aria-busy="true"], [role=progressbar], .gv-loading, [class*=spinner i], [class*=skeleton i]',
      )
      .count();
    if (
      spinner > 0 &&
      /loading|please wait|checking/i.test(t) &&
      !/retry|try again|offline|could not/i.test(t)
    )
      await finding(page, {
        sev: 'medium',
        title: 'Endless loading state with no retry after API failures',
        page: label,
        expected: 'error with retry after a few seconds',
        actual: clip(t, 160),
      });
  }
  await w.flush();
});

test('websocket dropped by the network then reconnect', async ({ page }) => {
  const A = room();
  test.skip(!A, 'no room');
  let opens = 0;
  let first = true;
  await page.routeWebSocket(/.*/, (ws) => {
    opens += 1;
    const server = ws.connectToServer();
    if (first) {
      first = false;
      setTimeout(() => {
        server.close({ code: 1006 });
        ws.close({ code: 1006 });
      }, 4000);
    }
  });
  const w = watch(page, { allowConsole: true });
  await gotoOk(page, A.screenUrl || A.hubUrl, { noSettle: true });
  await page.waitForTimeout(25000);
  const t = await bodyText(page);
  if (opens < 2)
    await finding(page, {
      sev: 'high',
      title: 'Page does not reconnect its websocket after a drop',
      page: 'screen/hub',
      steps: 'close the socket from the network side 4 s after open, wait 25 s',
      expected: 'a second socket opens (backoff reconnect)',
      actual: `${opens} socket(s) opened in 29 s; text: ${clip(t, 140)}`,
    });
  if (t.trim().length < 15)
    await finding(page, {
      sev: 'high',
      title: 'Blank after a websocket drop',
      page: 'screen/hub',
      expected: 'content',
      actual: 'blank',
    });
  await w.flush();
});

test('images and fonts blocked', async ({ page }) => {
  await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'font' || t === 'media') return route.abort('failed');
    return route.continue();
  });
  const w = watch(page, { allowConsole: true, ignoreFailed: /./ });
  for (const p of ['/', '/try', '/demo', '/demo/scripted']) {
    await gotoOk(page, WEB + p);
    const a = await auditLayout(page);
    await reportAudit(page, a, { skipEmpty: true, skipLandmarks: true });
    const broken = await page.evaluate(
      () =>
        [...document.images].filter(
          (i) =>
            i.complete &&
            i.naturalWidth === 0 &&
            !i.alt &&
            i.getAttribute('role') !== 'presentation',
        ).length,
    );
    if (broken)
      await finding(page, {
        sev: 'low',
        title: 'Images without alt text show as broken',
        page: p,
        steps: 'block all images and fonts',
        expected: 'alt text or hidden decoration',
        actual: `${broken} img with no alt`,
      });
  }
  await w.flush();
});

test('JavaScript disabled', async ({ browser }) => {
  const ctx = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 720 },
  });
  const page = await ctx.newPage();
  for (const p of ['/', '/try', '/demo', '/join/ZZZZZZ']) {
    await page.goto(WEB + p, { waitUntil: 'load' }).catch(() => {});
    const t = (await bodyText(page)).trim();
    const noscript = /javascript|enable|requires/i.test(t);
    if (t.length < 15 || !noscript)
      await finding(page, {
        sev: 'low',
        title: 'With JavaScript off the page is blank or has no explanation',
        page: p,
        steps: 'disable JavaScript, open the page',
        expected: 'a <noscript> message',
        actual: `text length ${t.length}: ${clip(t, 100)}`,
      });
  }
  await ctx.close();
});
