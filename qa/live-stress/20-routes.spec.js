// Deep links to every route with bad, missing, malformed and expired codes and tokens.
// Expected: a clear, readable page (not blank, no crash, no raw error text) and a way out.
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

const BAD = [
  ['unknown 6-char code', 'ZZZZZZ'],
  ['lowercase GVL- prefix', 'gvl-zzzzzz'],
  ['space', '%20'],
  ['malformed percent escape', '%E0%A4%A'],
  ['2000 characters', 'A'.repeat(2000)],
  ['script tag', '%3Cscript%3Ewindow.__xss%3D1%3C%2Fscript%3E'],
  ['unicode emoji and RTL', encodeURIComponent('مرحبا💥ünï')],
  ['path traversal', '..%2F..%2Fetc%2Fpasswd'],
];
const ROOM_ROUTES = ['hub', 'bid', 'receipt', 'screen', 'console', 'register', 'return', 'audit'];
const HASHES = ['', '#token=garbage', '#invite=garbage', '#a=x&s=y&c=zzz', '#token='];

const RAW =
  /undefined|\[object|NaN|Traceback|TypeError|Cannot read|stack trace|at https?:|<\/?script/i;

async function judge(page, label, url, w) {
  const r = await gotoOk(page, url);
  if (r.status === 0)
    return finding(page, {
      sev: 'medium',
      title: 'Deep link did not load',
      page: label,
      expected: 'a page',
      actual: r.error,
    });
  if (r.status >= 500)
    await finding(page, {
      sev: 'high',
      title: `Deep link answered ${r.status}`,
      page: label,
      expected: 'a not-found or error page with a way out',
      actual: String(r.status),
    });
  const text = await bodyText(page);
  const xss = await page.evaluate(() => window.__xss === 1).catch(() => false);
  if (xss)
    await finding(page, {
      sev: 'high',
      title: 'Script from the URL executed',
      page: label,
      expected: 'path text is never executed',
      actual: 'window.__xss was set',
    });
  if (text.trim().length < 15)
    await finding(page, {
      sev: 'high',
      title: 'Blank page on a bad link',
      page: label,
      expected: 'an explanation and a way out',
      actual: `text length ${text.trim().length}`,
    });
  else if (RAW.test(text))
    await finding(page, {
      sev: 'medium',
      title: 'Raw error or undefined text on a bad link',
      page: label,
      expected: 'plain wording',
      actual: clip(text.match(RAW)?.[0] + ' in ' + text, 200),
    });
  const exits = await page.locator('a[href], button').count();
  if (exits === 0)
    await finding(page, {
      sev: 'medium',
      title: 'Dead end: no link or button on a bad link',
      page: label,
      expected: 'a way back',
      actual: 'no actions',
    });
  const a = await auditLayout(page);
  if (a.overflowX)
    await finding(page, {
      sev: 'medium',
      title: 'Horizontal scroll on a bad-link page',
      page: label,
      expected: 'no horizontal scroll',
      actual: `${a.scrollW} > ${a.vw}; ${a.offenders.join(' ; ')}`,
    });
  return { text, status: r.status };
}

test('bad codes on /join/<code>', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  let rateLimited = false;
  page.on('response', (r) => {
    if (r.status() === 429) rateLimited = true;
  });
  for (const [name, code] of BAD) {
    if (rateLimited) {
      await finding(page, {
        sev: 'medium',
        title: 'API rate limit hit by a handful of bad-code lookups',
        page: '/join/<bad>',
        steps: 'open /join/<bad code> variants, 400 ms apart',
        expected: 'light lookups are not limited',
        actual: `429 seen at "${name}"; stopped`,
      });
      break;
    }
    await judge(page, `/join/${name}`, `${WEB}/join/${code}`, w);
    await sleep(500);
  }
  await w.flush();
});

test('every room route with missing, bad and malformed tokens', async ({ page }) => {
  const w = watch(page, { allowConsole: true });
  let rateLimited = false;
  page.on('response', (r) => {
    if (r.status() === 429) rateLimited = true;
  });
  for (const route of ROOM_ROUTES) {
    for (const hash of HASHES.slice(0, 3)) {
      if (rateLimited) {
        await finding(page, {
          sev: 'medium',
          title: 'API rate limit hit by bad-token deep links',
          page: `/r/x/${route}`,
          expected: 'light traffic is not limited',
          actual: '429 seen; stopped',
        });
        await w.flush();
        return;
      }
      await judge(page, `/r/ZZZZZZ/${route}${hash}`, `${WEB}/r/ZZZZZZ/${route}${hash}`, w);
      await sleep(350);
    }
  }
  // odd room ids on the two most used routes
  for (const id of [
    '%20',
    'a'.repeat(300),
    encodeURIComponent('<img src=x onerror=window.__xss=1>'),
  ]) {
    for (const route of ['hub', 'bid'])
      await judge(page, `/r/${id.slice(0, 20)}/${route}`, `${WEB}/r/${id}/${route}`, w);
  }
  // extra segments and trailing slashes
  for (const p of [
    '/r/ZZZZZZ',
    '/r/ZZZZZZ/',
    '/r/ZZZZZZ/hub/',
    '/r/ZZZZZZ/hub/extra',
    '/join',
    '/join/',
    '//',
    '/demo/',
    '/try/',
    '/TRY',
    '/Demo',
  ])
    await judge(page, p, WEB + p, w);
  await w.flush();
});

test('real room: wrong route/token combinations', async ({ page }) => {
  const A = loadState().rooms?.A;
  test.skip(!A, 'no room');
  const w = watch(page, { allowConsole: true });
  const u = `${WEB}/r/${A.roomId}`;
  // console and audit with no token, with a garbage token, with the screen token
  await judge(page, 'console without token', `${u}/console`, w);
  await judge(page, 'console with garbage token', `${u}/console#token=nope`, w);
  await judge(page, 'audit without token', `${u}/audit`, w);
  const scr = A.screenUrl ? new URL(A.screenUrl).hash : '';
  if (scr) {
    await judge(page, 'console with the SCREEN token', `${u}/console${scr}`, w);
    await judge(page, 'audit with the SCREEN token', `${u}/audit${scr}`, w);
  }
  // join with wrong ?c= and uppercase/lowercase code
  await judge(page, 'join with wrong ?c=', `${WEB}/join/${A.roomId}?c=WRONG1`, w);
  await judge(
    page,
    'join with ?c= lowercase',
    `${WEB}/join/${A.roomId}?c=${(A.code || '').toLowerCase()}`,
    w,
  );
  await judge(page, 'register with a used or fake invite', `${u}/register#invite=abc.def`, w);
  await w.flush();
});
