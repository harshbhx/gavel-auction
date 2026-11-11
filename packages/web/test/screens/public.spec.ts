import { t } from '../../src/copy/t';
import { TEST_IDS } from '../../src/testing/testids';
import { expect, mockApi, ready, test } from './support/harness';
import { REGISTER_ROOM_ID } from './support/frames';

/**
 * Landing, demo launcher, join, operator page, gallery and the not-found page: the screens that
 * need no room. The server is answered from the test, so no network is needed.
 */

const OPEN_ROOM = {
  auctionId: REGISTER_ROOM_ID,
  title: 'Signed first-press vinyl',
  status: 'OPEN',
  joinCode: 'K7M2QX',
};

test.describe('landing', () => {
  test('default', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/');
    await ready(page);
    await shoot('landing', 'default');
  });

  test('code typed', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill('K7M2QX');
    await shoot('landing', 'code-typed');
  });

  test('code not found', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill('NOROOM');
    await page.getByRole('button', { name: t('landing.join') }).click();
    await expect(page.getByText(t('landing.codeInvalid')).first()).toBeVisible();
    await shoot('landing', 'code-not-found');
  });
});

test.describe('demo launcher', () => {
  test('idle', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo');
    await ready(page);
    await shoot('demo', 'idle');
  });

  test('creating room', async ({ page, shoot }) => {
    await mockApi(page, () => 'hang');
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await expect(page.getByRole('button', { name: t('demo.creating') })).toBeVisible();
    await shoot('demo', 'creating');
  });

  const failures: ReadonlyArray<[string, number, string]> = [
    ['failed-demo-off', 404, t('demo.failedOff')],
    ['failed-bad-key', 401, t('demo.failedKey')],
    ['failed-server-error', 500, t('demo.failed')],
  ];
  for (const [state, status, text] of failures) {
    test(state, async ({ page, shoot }) => {
      await mockApi(page, () => ({ status }));
      await page.goto('/demo');
      await page.getByRole('button', { name: t('landing.start') }).click();
      await expect(page.getByText(text).first()).toBeVisible();
      await shoot('demo', state);
    });
  }

  // Since #2044 a 429 from the capabilities probe keeps the key-less judge path, so the operator
  // room cap needs judge rooms switched off (404) and a 429 on the operator create call.
  test('failed-room-cap', async ({ page, shoot }) => {
    await mockApi(page, (req) =>
      req.path === '/api/judge/capabilities' ? { status: 404 } : { status: 429 },
    );
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await expect(page.getByText(t('demo.failedCap')).first()).toBeVisible();
    await shoot('demo', 'failed-room-cap');
  });

  // A rate limit says how long to wait: the Retry-After header becomes "2 min".
  test('failed-rate-limited', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 429, headers: { 'retry-after': '120' } }));
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await expect(
      page.getByText(t('demo.failedRate', { wait: t('time.minutes', { n: 2 }) })).first(),
    ).toBeVisible();
    await shoot('demo', 'failed-rate-limited');
  });

  // A full judge house is a 429 with error judge_room_cap: "busy", not a rate limit.
  test('failed-judge-busy', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 429, json: { error: 'judge_room_cap' } }));
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await expect(page.getByText(t('demo.failedBusy')).first()).toBeVisible();
    await shoot('demo', 'failed-judge-busy');
  });

  test('server unreachable', async ({ page, shoot }) => {
    await mockApi(page, () => 'fail');
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await expect(page.getByText(t('demo.failed')).first()).toBeVisible();
    await shoot('demo', 'failed-unreachable');
  });

  test('scripted instead lands on the console route', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await page.getByRole('button', { name: t('demo.scriptedInstead') }).click();
    await page.waitForURL('**/r/demo/console');
    await shoot('demo', 'scripted-console-route');
  });
});

test.describe('judge panel', () => {
  const caps = (judgeRooms: boolean, accepting: boolean) => ({
    status: 200,
    json: { judgeRooms, accepting },
  });

  test('rooms on', async ({ page, shoot }) => {
    await mockApi(page, () => caps(true, true));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    await shoot('try', 'rooms-on');
  });

  test('rooms off', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.a1.open'))).toBeVisible();
    await shoot('try', 'rooms-off');
  });

  test('rooms full', async ({ page, shoot }) => {
    await mockApi(page, () => caps(true, false));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.busy'))).toBeVisible();
    await shoot('try', 'rooms-full');
  });

  test('server unreachable', async ({ page, shoot }) => {
    await mockApi(page, () => 'fail');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.unreachable'))).toBeVisible();
    await shoot('try', 'unreachable');
  });

  test('create refused', async ({ page, shoot }) => {
    await mockApi(page, (req) => (req.method === 'POST' ? { status: 503 } : caps(true, true)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    await page.getByRole('button', { name: t('try.a1.room') }).click();
    await expect(page.getByText(t('demo.failedBusy'), { exact: false })).toBeVisible();
    await shoot('try', 'create-refused');
  });

  test('code not found', async ({ page, shoot }) => {
    await mockApi(page, (req) =>
      req.path.endsWith('/capabilities') ? caps(true, true) : { status: 404 },
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill('NOROOM');
    await page.getByRole('button', { name: t('try.a2.go') }).click();
    await expect(page.getByText(t('landing.codeInvalid')).first()).toBeVisible();
    await shoot('try', 'code-not-found');
  });

  test('phone bar shows only the run control before a room exists', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) > 560, 'the bar is full width above 560 px');
    await mockApi(page, () => caps(true, true));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    const bar = page.getByRole('navigation', { name: t('try.bar.label') });
    // Under reduced motion the run lands on its final state, so the control reads as a replay.
    const run = (['try.run.go', 'try.run.running', 'try.run.replay'] as const)
      .map((key) => t(key))
      .join('|');
    await expect(bar.getByRole('button', { name: new RegExp(`^(${run})`) })).toBeVisible();
    for (const key of ['try.bar.join', 'try.bar.console', 'try.bar.screen'] as const) {
      await expect(bar.getByRole('button', { name: new RegExp(`^${t(key)}`) })).toHaveCount(0);
    }
  });

  test('console tab explains it opens inside a room', async ({ page, shoot }) => {
    test.skip((page.viewportSize()?.width ?? 1280) <= 560, 'the button is hidden on phones');
    await mockApi(page, () => caps(true, true));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    await page
      .getByRole('navigation', { name: t('try.bar.label') })
      .getByRole('button', { name: new RegExp(`^${t('try.bar.console')}`) })
      .click();
    await expect(page.getByText(t('try.dlg.needsRoom'))).toBeVisible();
    await shoot('try', 'dialog-console');
  });

  test('proven tab lists what is not claimed', async ({ page, shoot }) => {
    test.skip((page.viewportSize()?.width ?? 1280) <= 560, 'the button is hidden on phones');
    await mockApi(page, () => caps(true, true));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await page
      .getByRole('navigation', { name: t('try.bar.label') })
      .getByRole('button', { name: new RegExp(`^${t('try.bar.join')}`) })
      .click();
    await page.getByRole('tab', { name: t('try.tab.proven') }).click();
    await expect(page.getByRole('tabpanel').getByText(t('try.ev.n2'))).toBeVisible();
    await shoot('try', 'dialog-proven');
  });

  test('wide screen fills the width at 1920', async ({ page, shoot }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockApi(page, () => caps(true, true));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    await shoot('try', 'wide-1920');
  });
});

test.describe('join', () => {
  test('open room', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 200, json: OPEN_ROOM }));
    await page.goto(`/join/${REGISTER_ROOM_ID}`);
    await expect(page.getByText(OPEN_ROOM.title).first()).toBeVisible();
    await shoot('join', 'open');
  });

  test('loading', async ({ page, shoot }) => {
    await mockApi(page, () => 'hang');
    await page.goto(`/join/${REGISTER_ROOM_ID}`);
    await ready(page);
    await shoot('join', 'loading');
  });

  test('auction ended', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 200, json: { ...OPEN_ROOM, status: 'DONE' } }));
    await page.goto(`/join/${REGISTER_ROOM_ID}`);
    await expect(page.getByText(t('join.ended')).first()).toBeVisible();
    await shoot('join', 'ended');
  });

  test('not found', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto(`/join/${REGISTER_ROOM_ID}`);
    await expect(page.getByText(t('join.notFound')).first()).toBeVisible();
    await shoot('join', 'not-found');
  });
});

test.describe('operator page', () => {
  test('key form', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 401 }));
    await page.goto('/ops');
    await ready(page);
    await shoot('ops', 'key-form');
  });

  test('summary', async ({ page, shoot }) => {
    await mockApi(page, () => ({
      status: 200,
      json: {
        logs: [
          '12:00:01 room opened',
          '12:00:09 hold approved',
          '12:01:30 hammer',
          '12:01:31 capture ok',
        ],
        sagas: [
          { auctionId: REGISTER_ROOM_ID, lotId: 'lot-1', state: 'CAPTURED' },
          { auctionId: REGISTER_ROOM_ID, lotId: 'lot-2', state: 'VOIDING' },
        ],
        paypal: { authorized: 7, captured: 3, voided: 4 },
      },
    }));
    await page.goto('/ops');
    await page.getByLabel(t('ops.keyLabel')).fill('operator-key');
    await page.getByRole('button', { name: t('ops.load') }).click();
    await expect(page.getByText(t('ops.sagas')).first()).toBeVisible();
    await shoot('ops', 'summary');
  });

  test('summary without lots', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 200, json: { logs: [], sagas: [], paypal: {} } }));
    await page.goto('/ops');
    await page.getByLabel(t('ops.keyLabel')).fill('operator-key');
    await page.getByRole('button', { name: t('ops.load') }).click();
    await expect(page.getByText(t('ops.noSagas')).first()).toBeVisible();
    await shoot('ops', 'summary-empty');
  });

  test('load failed', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 401 }));
    await page.goto('/ops');
    await page.getByLabel(t('ops.keyLabel')).fill('wrong-key');
    await page.getByRole('button', { name: t('ops.load') }).click();
    await expect(page.getByText(t('ops.failed')).first()).toBeVisible();
    await shoot('ops', 'load-failed');
  });
});

test.describe('gallery and errors', () => {
  test('gallery primitives', async ({ page, shoot }) => {
    await page.goto('/gallery');
    await ready(page);
    await shoot('gallery', 'primitives');
  });

  test('gallery dialog open', async ({ page, shoot }) => {
    await page.goto('/gallery');
    await page.getByTestId(TEST_IDS.dialogOpen).click();
    await page.getByRole('dialog').waitFor();
    await shoot('gallery', 'dialog-open');
  });

  test('gallery ladder specimen', async ({ page, shoot }) => {
    await page.goto('/gallery?ladder');
    await ready(page);
    await shoot('gallery', 'ladder-specimen');
  });

  test('page not found', async ({ page, shoot }) => {
    await page.goto('/nowhere');
    await ready(page);
    await shoot('not-found', 'unknown-route');
  });

  test('unknown scripted scenario', async ({ page, shoot }) => {
    await page.goto('/r/demo/bid?scripted=1&scenario=no_such_scenario');
    await ready(page);
    await shoot('not-found', 'unknown-scenario');
  });

  test('room route without a session', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto(`/r/${REGISTER_ROOM_ID}/bid`);
    await ready(page);
    await shoot('bid', 'no-session');
  });
});
