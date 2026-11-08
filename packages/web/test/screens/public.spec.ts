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
    ['failed-room-cap', 429, t('demo.failedCap')],
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
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    await shoot('try', 'rooms-on');
  });

  test('rooms off', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/try');
    await expect(page.getByText(t('try.s1.open'))).toBeVisible();
    await shoot('try', 'rooms-off');
  });

  test('rooms full', async ({ page, shoot }) => {
    await mockApi(page, () => caps(true, false));
    await page.goto('/try');
    await expect(page.getByText(t('try.status.busy'))).toBeVisible();
    await shoot('try', 'rooms-full');
  });

  test('server unreachable', async ({ page, shoot }) => {
    await mockApi(page, () => 'fail');
    await page.goto('/try');
    await expect(page.getByText(t('try.status.unreachable'))).toBeVisible();
    await shoot('try', 'unreachable');
  });

  test('create refused', async ({ page, shoot }) => {
    await mockApi(page, (req) => (req.method === 'POST' ? { status: 503 } : caps(true, true)));
    await page.goto('/try');
    await expect(page.getByText(t('try.status.on'))).toBeVisible();
    await page.getByRole('button', { name: t('try.s1.cta') }).click();
    await expect(page.getByText(t('demo.failedBusy'), { exact: false })).toBeVisible();
    await shoot('try', 'create-refused');
  });

  test('code not found', async ({ page, shoot }) => {
    await mockApi(page, (req) =>
      req.path.endsWith('/capabilities') ? caps(true, true) : { status: 404 },
    );
    await page.goto('/try');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill('NOROOM');
    await page.getByRole('button', { name: t('try.s2.go') }).click();
    await expect(page.getByText(t('landing.codeInvalid')).first()).toBeVisible();
    await shoot('try', 'code-not-found');
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
