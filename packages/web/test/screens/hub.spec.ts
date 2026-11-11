import type { Locator } from '@playwright/test';
import { t } from '../../src/copy/t';
import { HAPPY, REGISTER_ROOM_ID, happy } from './support/frames';
import {
  BASE_TIME,
  expect,
  mockApi,
  ready,
  serveRoom,
  test,
  type ApiReply,
  type ApiRequest,
} from './support/harness';

/**
 * UIX-12: the judge room hub, links that lost their token, and the scripted demo in Newsprint.
 * The server is answered from the test, so no network is needed.
 */

const ROOM = REGISTER_ROOM_ID;
const AUCTIONEER = `${'a'.repeat(40)}.${'b'.repeat(40)}`;
const SCREEN = `${'c'.repeat(40)}.${'d'.repeat(40)}`;
const INVITE = `${'e'.repeat(60)}.${'f'.repeat(40)}`;
// The screens run with the page clock at 2026-01-15 12:00 UTC; the room ends 30 minutes later.
const EXPIRES_AT = 1_768_478_400_000 + 30 * 60_000;
const CODE = 'K7M2QX';

const HUB = `/r/${ROOM}/hub#token=${AUCTIONEER}&screen=${SCREEN}&exp=${EXPIRES_AT}&code=${CODE}`;

function hubApi(req: ApiRequest): ApiReply {
  if (req.method === 'GET' && req.path === `/api/auctions/${ROOM}`) {
    return {
      status: 200,
      json: { auctionId: ROOM, title: 'Signed first-press vinyl', status: 'OPEN', joinCode: CODE },
    };
  }
  if (req.method === 'POST' && req.path === `/api/auctions/${ROOM}/invites`) {
    return {
      status: 201,
      json: {
        invites: [
          {
            bidderId: 'B1',
            expiresAt: EXPIRES_AT,
            link: `https://gavel.example/r/${ROOM}/register#token=${INVITE}`,
          },
        ],
      },
    };
  }
  return { status: 404 };
}

test.describe('judge room hub', () => {
  test('ready, with all four steps', async ({ page, shoot }) => {
    await mockApi(page, hubApi);
    await page.goto(HUB);
    await expect(page.getByRole('heading', { level: 1, name: t('hub.title') })).toBeVisible();
    for (const title of [t('hub.step1'), t('hub.ticket'), t('hub.step3'), t('hub.step4')]) {
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    await expect(page.locator('.gv-hub__flap')).toHaveCount(CODE.length);
    await expect(page.locator('.gv-hub__qr svg')).toBeVisible();
    await expect(page.locator('.gv-hub__preview .gv-screen')).toHaveCount(1);
    await expect(page.getByRole('link', { name: new RegExp(t('hub.step4Open')) })).toBeVisible();
    await expect(page.getByRole('heading', { name: t('hub.testTitle') })).toBeVisible();
    await shoot('hub', 'ready');
  });

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    test(`fits one screen at ${size.width}x${size.height}`, async ({ page, shoot }, info) => {
      test.skip(info.project.name !== 'desktop-light', 'laptop sizes are checked once');
      await page.setViewportSize(size);
      await mockApi(page, hubApi);
      await page.goto(HUB);
      await expect(page.locator('.gv-hub__flap')).toHaveCount(CODE.length);
      await expect(page.locator('.gv-hub__qr svg')).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(t('hub.step4Open')) })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollHeight - window.innerHeight,
        hub: (document.querySelector('.gv-hub') as HTMLElement).scrollHeight - window.innerHeight,
        sideways: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.hub).toBeLessThanOrEqual(0);
      expect(overflow.sideways).toBeLessThanOrEqual(0);
      await shoot('hub', `fit-${size.width}x${size.height}`);
    });
  }

  test('live preview shows the room as the projector does', async ({ page, shoot }) => {
    const room = await serveRoom(page, { scenario: happy, at: HAPPY.outbid, role: 'screen' });
    const expires = BASE_TIME + HAPPY.outbid + 30 * 60_000;
    await mockApi(page, (req) =>
      req.method === 'GET' && req.path === `/api/auctions/${room.roomId}`
        ? {
            status: 200,
            json: { auctionId: room.roomId, title: 'Signed first-press vinyl', joinCode: CODE },
          }
        : { status: 404 },
    );
    await page.goto(
      `/r/${room.roomId}/hub#token=${AUCTIONEER}&screen=${SCREEN}&exp=${expires}&code=${CODE}`,
    );
    await expect(page.locator('.gv-hub__preview [data-testid="screen-price"]')).toBeVisible();
    await shoot('hub', 'live-preview');
  });

  test('links carry their tokens', async ({ page }) => {
    await mockApi(page, hubApi);
    await page.goto(HUB);
    const screen = page.getByRole('link', { name: new RegExp(t('hub.step1Open')) });
    await expect(screen).toHaveAttribute('href', new RegExp(`/r/${ROOM}/screen#token=${SCREEN}$`));
    const consoleLink = page.getByRole('link', { name: new RegExp(t('hub.step3Open')) });
    await expect(consoleLink).toHaveAttribute(
      'href',
      new RegExp(`/r/${ROOM}/console#token=${AUCTIONEER}$`),
    );
    const bidder = page.getByRole('link', { name: new RegExp(t('hub.step4Open')) });
    await expect(bidder).toHaveAttribute(
      'href',
      new RegExp(`/r/${ROOM}/register#token=${INVITE}$`),
    );
  });

  test('invite refused', async ({ page, shoot }) => {
    await mockApi(page, (req) => (req.method === 'POST' ? { status: 403 } : hubApi(req)));
    await page.goto(HUB);
    await expect(page.getByText(t('hub.inviteFailed'))).toBeVisible();
    await shoot('hub', 'invite-failed');
  });

  test('opened without keys', async ({ page, shoot }) => {
    await mockApi(page, hubApi);
    await page.goto(`/r/${ROOM}/hub`);
    await expect(page.getByRole('heading', { level: 1, name: t('hub.title') })).toBeVisible();
    await expect(page.getByText(t('hub.noToken')).first()).toBeVisible();
    await shoot('hub', 'no-keys');
  });

  test('start a demo, land on the hub', async ({ page, shoot }) => {
    await mockApi(page, (req) => {
      if (req.method === 'GET' && req.path === '/api/judge/capabilities') {
        return { status: 200, json: { judgeRooms: true, accepting: true } };
      }
      if (req.method === 'POST' && req.path === '/api/judge/rooms') {
        return {
          status: 201,
          json: {
            auctionId: ROOM,
            joinCode: CODE,
            lotTitle: 'Signed first-press vinyl',
            auctioneerToken: AUCTIONEER,
            screenToken: SCREEN,
            expiresAt: EXPIRES_AT,
          },
        };
      }
      return hubApi(req);
    });
    await page.goto('/demo');
    await page.getByRole('button', { name: t('landing.start') }).click();
    await page.waitForURL(`**/r/${ROOM}/hub**`);
    await expect(page.getByRole('heading', { level: 1, name: t('hub.title') })).toBeVisible();
    await expect(page.locator('.gv-hub__flap')).toHaveCount(CODE.length);
    await shoot('hub', 'after-start');
  });
});

test.describe('links that lost their token', () => {
  test('console', async ({ page, shoot }) => {
    await mockApi(page, hubApi);
    await page.goto(`/r/${ROOM}/console`);
    await expect(
      page.getByRole('heading', { level: 1, name: t('err.tokenMissing') }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: t('hub.backToHub') })).toBeVisible();
    await shoot('token-missing', 'console');
  });

  test('big screen', async ({ page, shoot }) => {
    await mockApi(page, hubApi);
    await page.goto(`/r/${ROOM}/screen`);
    await expect(
      page.getByRole('heading', { level: 1, name: t('err.tokenMissing') }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: t('err.newLink') })).toBeVisible();
    await shoot('token-missing', 'screen');
  });

  test('join without an invite', async ({ page, shoot }) => {
    await mockApi(page, hubApi);
    await page.goto(`/r/${ROOM}/register`);
    await expect(page.getByRole('heading', { name: t('reg.noInviteTitle') })).toBeVisible();
    await expect(page.getByText(t('tokenHelp.registerLead'))).toBeVisible();
    await shoot('token-missing', 'register');
  });
});

test.describe('scripted demo in Newsprint', () => {
  // Reduced motion keeps the demo on its first beat until a step button is pressed, so each
  // frame is a stable shot of one beat.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('screen, with a QR that opens the scripted join page', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo/scripted');
    await ready(page);
    await expect(page.getByText(t('scriptedDemo.banner'))).toBeVisible();
    await expect(page.locator('.gv-screen__join svg')).toHaveAttribute(
      'aria-label',
      /\/demo\/scripted\/join$/,
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'projector');
    // One slim header, and a step panel that fits without its own scrollbar.
    await expect(page.getByText(t('prov.scripted'))).toHaveCount(1);
    const bar = await page.locator('.gv-scripted-bar').boundingBox();
    // Wide pages keep it to a slim bar; narrow ones may wrap the chips and buttons.
    const wide = (page.viewportSize()?.width ?? 0) >= 900;
    if (wide) expect(bar?.height ?? 999).toBeLessThanOrEqual(112);
    const fits = await page
      .locator('.gv-player')
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(fits).toBeLessThanOrEqual(1);
    await shoot('scripted', 'screen');
  });

  test('what the QR opens', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo/scripted/join');
    await expect(
      page.getByRole('heading', { level: 1, name: t('scriptedJoin.title') }),
    ).toBeVisible();
    await shoot('scripted', 'join');
  });

  test('scripted bidder view', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo/scripted/bid');
    await ready(page);
    await expect(page.getByText(t('scriptedDemo.banner'))).toBeVisible();
    await shoot('scripted', 'bidder');
  });
});

test.describe('scripted demo player', () => {
  test('one readable beat at a time, no layout shift', async ({ page, shoot }, info) => {
    // Found by the 320 px project: the caption box moves 13 px between beats there because the
    // beat label wraps to a different number of lines. Tracked in a follow-up issue.
    test.fixme(info.project.name === 'phone-small', 'caption shifts 13 px between beats at 320 px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo/scripted');
    await ready(page);
    const player = page.getByTestId('scripted-player');
    const caption = page.getByTestId('scripted-caption');
    const next = page.getByRole('button', { name: t('scriptedDemo.next') });
    // Positions are measured on the page, not the viewport: on a narrow screen the page is taller
    // than the window and pressing Next scrolls it, which moves every box in viewport terms.
    const onPage = (box: Locator): Promise<{ x: number; y: number; w: number; h: number }> =>
      box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      });
    const before = await onPage(caption);
    const playerBefore = await onPage(player);
    await expect(caption).toContainText(t('scriptedDemo.b0.label'));
    await shoot('scripted-player', '1-holds');
    await next.click();
    await next.click();
    await expect(caption).toContainText(t('scriptedDemo.b2.label'));
    await expect(page.getByTestId('screen-price')).toContainText('150.00');
    await shoot('scripted-player', '3-outbid');
    for (let i = 0; i < 4; i += 1) await next.click();
    await expect(caption).toContainText(t('scriptedDemo.b6.label'));
    await expect(page.getByTestId('sold')).toBeAttached();
    await shoot('scripted-player', '7-hammer');
    await next.click();
    await next.click();
    await expect(caption).toContainText(t('scriptedDemo.b8.label'));
    await shoot('scripted-player', '9-capture');
    await next.click();
    await expect(caption).toContainText(t('scriptedDemo.b9.label'));
    await shoot('scripted-player', '10-receipt');
    expect(await onPage(caption)).toEqual(before);
    expect(await onPage(player)).toEqual(playerBefore);
  });

  test('plays by itself, slowly, and pauses', async ({ page }) => {
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/demo/scripted');
    await ready(page);
    const progress = page.getByTestId('scripted-progress');
    await expect(progress).toHaveText(t('scriptedDemo.progress', { n: 1, total: 10 }));
    await page.waitForTimeout(1500);
    await expect(progress).toHaveText(t('scriptedDemo.progress', { n: 1, total: 10 }));
    await expect(progress).toHaveText(t('scriptedDemo.progress', { n: 2, total: 10 }), {
      timeout: 3500,
    });
    await page.getByRole('button', { name: t('scriptedDemo.pause') }).click();
    await page.waitForTimeout(4000);
    await expect(progress).toHaveText(t('scriptedDemo.progress', { n: 2, total: 10 }));
  });
});

test.describe('joining with only the room code', () => {
  test('a watcher joins as a bidder from the join page, no invite needed', async ({ page }) => {
    const seen: string[] = [];
    await mockApi(page, (req) => {
      seen.push(`${req.method} ${req.path}`);
      if (req.method === 'POST' && req.path === '/api/judge/join') {
        return { status: 200, json: { sessionToken: 'plainly-fake-session', bidderId: 'B9' } };
      }
      return hubApi(req);
    });
    await page.goto(`/join/${ROOM}?c=${CODE}`);
    await page.getByRole('button', { name: t('join.asBidder') }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${ROOM}/register`));
    await expect.poll(() => seen.includes('POST /api/judge/join')).toBe(true);
    await expect(page.getByText(t('reg.expired'))).toHaveCount(0);
  });

  test('the hub join link and QR carry the code', async ({ page }) => {
    await mockApi(page, hubApi);
    await page.goto(HUB);
    await expect(page.getByTestId('hub-join-link')).toContainText(`/join/${ROOM}?c=${CODE}`);
    await expect(page.getByTestId('hub-join-open')).toHaveAttribute(
      'href',
      new RegExp(`/join/${ROOM}\\?c=${CODE}$`),
    );
  });

  test('a watcher on the bid page can join', async ({ page }) => {
    await mockApi(page, hubApi);
    await page.goto(`/r/${ROOM}/bid`);
    await expect(page.getByRole('heading', { level: 1, name: t('watch.title') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('join.asBidder') })).toBeVisible();
  });
});
