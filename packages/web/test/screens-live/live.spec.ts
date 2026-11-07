import { t } from '../../src/copy/t';
import {
  ADMIN_KEY,
  API,
  createRoom,
  expect,
  hammer,
  ready,
  seedSession,
  test,
  type Joined,
  type LiveRoom,
} from './support';

/**
 * Screen tour against the deployed site. Part one needs nothing but the two URLs. Part two makes
 * throwaway rooms through the public HTTP routes (it needs the staging operator key) and walks the
 * join, register, bid, console, big screen, audit and receipt routes on them. Nothing is mocked and
 * no payment is made: registration stops before the PayPal step.
 */

const UNKNOWN_ROOM = 'room-that-does-not-exist-0000';

test.describe('live: no room needed', () => {
  test('landing', async ({ page, shoot }) => {
    await page.goto('/');
    await ready(page);
    await shoot('landing', 'default');
  });

  test('landing, code typed', async ({ page, shoot }) => {
    await page.goto('/');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill('K7M2QX');
    await shoot('landing', 'code-typed');
  });

  test('landing, code not found', async ({ page, shoot }) => {
    await page.goto('/');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill('NOROOM');
    await page.getByRole('button', { name: t('landing.join') }).click();
    await expect(page.getByText(t('landing.codeInvalid')).first()).toBeVisible();
    await shoot('landing', 'code-not-found');
  });

  test('demo launcher', async ({ page, shoot }) => {
    await page.goto('/demo');
    await ready(page);
    await shoot('demo', 'idle');
  });

  test('join, room not found', async ({ page, shoot }) => {
    await page.goto(`/join/${UNKNOWN_ROOM}`);
    await expect(page.getByText(t('join.notFound')).first()).toBeVisible();
    await shoot('join', 'not-found');
  });

  test('operator page, key form', async ({ page, shoot }) => {
    await page.goto('/ops');
    await ready(page);
    await shoot('ops', 'key-form');
  });

  test('operator page, wrong key', async ({ page, shoot }) => {
    await page.goto('/ops');
    // A made-up key on purpose: the real operator key is never typed into a page that is shot.
    await page.getByLabel(t('ops.keyLabel')).fill('not-the-operator-key');
    await page.getByRole('button', { name: t('ops.load') }).click();
    await expect(page.getByText(t('ops.failed')).first()).toBeVisible();
    await shoot('ops', 'load-failed');
  });

  test('replay, recording not found', async ({ page, shoot }) => {
    await page.goto('/replay/recording-that-does-not-exist');
    await expect(page.locator('p[role="alert"]').first()).toBeVisible();
    await shoot('replay', 'not-found');
  });

  test('page not found', async ({ page, shoot }) => {
    await page.goto('/nowhere');
    await ready(page);
    await shoot('not-found', 'unknown-route');
  });
});

test.describe('live: a throwaway room', () => {
  test.skip(
    ADMIN_KEY === '' || API === '',
    'no operator key: set the secret to take the room screens',
  );

  let open: (LiveRoom & Joined) | undefined;
  let ended: (LiveRoom & Joined) | undefined;

  test.beforeAll(async () => {
    open = await createRoom('Screen tour, open lot');
    ended = await createRoom('Screen tour, ended lot');
    await hammer(ended);
  });

  function room(): LiveRoom & Joined {
    if (open === undefined) throw new Error('the open room was not created');
    return open;
  }

  function endedRoom(): LiveRoom & Joined {
    if (ended === undefined) throw new Error('the ended room was not created');
    return ended;
  }

  test('landing, code of a real room', async ({ page, shoot }) => {
    await page.goto('/');
    await page.getByLabel(t('ui.code.char', { n: 1, length: 6 })).fill(room().joinCode);
    await shoot('landing', 'real-code-typed');
    await page.getByRole('button', { name: t('landing.join') }).click();
    await page.waitForURL(/\/join\//);
    await shoot('join', 'open-by-code');
  });

  test('join, open room', async ({ page, shoot }) => {
    await page.goto(`/join/${room().auctionId}`);
    await expect(page.getByText(room().title).first()).toBeVisible();
    await shoot('join', 'open');
  });

  test('join, ended room', async ({ page, shoot }) => {
    await page.goto(`/join/${endedRoom().auctionId}`);
    await expect(page.getByText(t('join.ended')).first()).toBeVisible();
    await shoot('join', 'ended');
  });

  test('register, first step', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/register#token=${room().inviteToken}`);
    await expect(page.getByLabel(t('reg.name'))).toBeVisible();
    await shoot('register', 'step1-name');
  });

  test('register, name filled', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/register#token=${room().inviteToken}`);
    await page.getByLabel(t('reg.name')).fill('Priya');
    await shoot('register', 'step1-name-filled');
  });

  test('bid room, open lot', async ({ page, shoot }) => {
    await seedSession(page, room());
    await page.goto(`/r/${room().auctionId}/bid`);
    await expect(page.getByText(t('bid.price')).first()).toBeVisible();
    await shoot('bid', 'open-lot');
  });

  test('bid room, ended lot', async ({ page, shoot }) => {
    await seedSession(page, endedRoom());
    await page.goto(`/r/${endedRoom().auctionId}/bid`);
    await ready(page);
    await shoot('bid', 'ended-lot');
  });

  test('bid room, no session', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/bid`);
    await ready(page);
    await shoot('bid', 'no-session');
  });

  test('console, open lot', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/console#token=${room().auctioneerToken}`);
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).waitFor();
    await shoot('console', 'live-no-bids');
  });

  test('console, ended lot', async ({ page, shoot }) => {
    await page.goto(`/r/${endedRoom().auctionId}/console#token=${endedRoom().auctioneerToken}`);
    await ready(page);
    await shoot('console', 'ended');
  });

  test('console, no token', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/console`);
    await ready(page);
    await shoot('console', 'no-token');
  });

  test('big screen, open lot', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/screen#token=${room().screenToken}`);
    await page.locator('main.gv-screen').waitFor();
    await shoot('screen', 'lobby-no-bids');
  });

  test('big screen, ended lot', async ({ page, shoot }) => {
    await page.goto(`/r/${endedRoom().auctionId}/screen#token=${endedRoom().screenToken}`);
    await page.locator('main.gv-screen').waitFor();
    await shoot('screen', 'ended');
  });

  test('audit trail, open lot', async ({ page, shoot }) => {
    await page.goto(`/r/${room().auctionId}/audit#token=${room().auctioneerToken}`);
    await expect(page.getByText(t('audit.title')).first()).toBeVisible();
    await shoot('audit', 'trail');
  });

  test('audit trail, ended lot', async ({ page, shoot }) => {
    await page.goto(`/r/${endedRoom().auctionId}/audit#token=${endedRoom().auctioneerToken}`);
    await expect(page.getByText(t('audit.title')).first()).toBeVisible();
    await shoot('audit', 'trail-ended');
  });

  test('receipt, no hold', async ({ page, shoot }) => {
    await seedSession(page, endedRoom());
    await page.goto(`/r/${endedRoom().auctionId}/receipt`);
    await ready(page);
    await shoot('receipt', 'ended-lot');
  });
});
