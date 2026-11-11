import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, FROZEN_AT, mockApi, ready, test } from './support/harness';

/**
 * The Home screen a returning visitor lands on. The history is put in localStorage before the page
 * loads; the clock is frozen, so "2 hours ago" and the greeting are the same on every run.
 */

const NOW = FROZEN_AT.getTime();
const MIN = 60_000;

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return {
    roomId: 'room-home-1',
    roles: ['bidder'],
    createdAt: NOW - 150 * MIN,
    lastSeenAt: NOW - 120 * MIN,
    expiresAt: NOW + 20 * MIN,
    lotTitle: 'Signed print, edition of 20',
    lastPriceCents: 54000,
    holdCents: 96000,
    result: 'won',
    paddle: 7,
    name: null,
    receipt: true,
    code: 'K7M2QX',
    ...over,
  };
}

async function remember(page: Page, rooms: Record<string, unknown>[]): Promise<void> {
  await page.addInitScript(
    (doc) => {
      window.localStorage.setItem('gavel.history.v1', JSON.stringify(doc));
    },
    { v: 1, rooms },
  );
}

const EARLIER = [
  entry({
    roomId: 'room-home-2',
    lotTitle: 'Signed vinyl record',
    result: 'lost',
    lastPriceCents: 12000,
    lastSeenAt: NOW - 26 * 60 * MIN,
    expiresAt: NOW - 24 * 60 * MIN,
    code: null,
  }),
  entry({
    roomId: 'room-home-3',
    lotTitle: 'Gala weekend for two',
    roles: ['auctioneer'],
    result: 'stopped',
    lastPriceCents: 80000,
    paddle: null,
    lastSeenAt: NOW - 3 * 24 * 60 * MIN,
    expiresAt: NOW - 70 * 60 * MIN,
    code: null,
  }),
];

test.describe('home', () => {
  test.beforeEach(async ({ page }) => {
    // The entrance and the count-up are off, so every picture shows the settled screen.
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('won, room still there', async ({ page, shoot }) => {
    await remember(page, [entry({}), ...EARLIER]);
    await mockApi(page, () => ({
      status: 200,
      json: { auctionId: 'room-home-1', status: 'DONE' },
    }));
    await page.goto('/');
    await ready(page);
    await expect(page.getByRole('link', { name: t('home.link.receipt') })).toBeVisible();
    await shoot('home', 'won-live');
  });

  test('the whole screen is above the fold on a desktop', async ({ page }) => {
    const size = page.viewportSize();
    test.skip(
      size === null || size.width !== 1440 || size.height !== 900,
      'desktop 1440 x 900 only',
    );
    await remember(page, [entry({}), ...EARLIER]);
    await mockApi(page, () => ({
      status: 200,
      json: { auctionId: 'room-home-1', status: 'DONE' },
    }));
    await page.goto('/');
    await ready(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Docs/ })).toBeInViewport();
  });

  test('lost, only one room: the last auction spans the full width', async ({ page, shoot }) => {
    await remember(page, [entry({ result: 'lost' })]);
    await mockApi(page, () => ({
      status: 200,
      json: { auctionId: 'room-home-1', status: 'DONE' },
    }));
    await page.goto('/');
    await ready(page);
    await expect(page.getByRole('heading', { name: t('home.earlier.kicker') })).toHaveCount(0);
    await shoot('home', 'lost-solo');
  });

  test('room deleted, summary kept', async ({ page, shoot }) => {
    await remember(page, [entry({ result: 'lost' })]);
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/');
    await expect(page.getByText(/Room deleted after 30 minutes/)).toBeVisible();
    await expect(page.getByRole('link', { name: t('home.link.receipt') })).toHaveCount(0);
    await shoot('home', 'room-deleted');
  });

  test('open lot, named visitor', async ({ page, shoot }) => {
    await remember(page, [
      entry({ result: 'open', name: 'Asha', receipt: false, lastSeenAt: NOW - 4 * MIN }),
    ]);
    await mockApi(page, () => ({
      status: 200,
      json: { auctionId: 'room-home-1', status: 'OPEN' },
    }));
    await page.goto('/');
    await expect(page.getByRole('link', { name: t('home.link.return') })).toBeVisible();
    await shoot('home', 'open-named');
  });

  test('join a room', async ({ page, shoot }) => {
    await remember(page, [entry({}), ...EARLIER]);
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/');
    await page.getByRole('button', { name: /Join a room/ }).click();
    await expect(page.getByLabel(t('ui.code.char', { n: 1, length: 6 }))).toBeFocused();
    await shoot('home', 'join-open');
  });

  test('the landing page is still at /about', async ({ page, shoot }) => {
    await remember(page, [entry({})]);
    await mockApi(page, () => ({ status: 404 }));
    await page.goto('/about');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('landing.title'));
    await shoot('home', 'about-landing');
  });
});
