import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, FROZEN_AT, mockApi, ready, test } from './support/harness';

/**
 * The audit trail opened from the Home page (a remembered room, no key in this tab) and by its
 * address. Neither may leave a blank page: the heading and the reason must be on screen.
 */

const NOW = FROZEN_AT.getTime();
const ROOM = 'room-audit-1';

async function remember(page: Page): Promise<void> {
  await page.addInitScript(
    (doc) => {
      window.localStorage.setItem('gavel.history.v1', JSON.stringify(doc));
    },
    {
      v: 1,
      rooms: [
        {
          roomId: ROOM,
          roles: ['bidder'],
          createdAt: NOW - 150 * 60_000,
          lastSeenAt: NOW - 120 * 60_000,
          expiresAt: NOW + 20 * 60_000,
          lotTitle: 'Signed print, edition of 20',
          lastPriceCents: 54000,
          holdCents: 96000,
          result: 'won',
          paddle: 7,
          name: null,
          receipt: true,
          code: 'K7M2QX',
        },
      ],
    },
  );
}

async function expectShown(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(t('err.tokenMissing'));
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y ?? 9999).toBeLessThan(300);
  await expect(page.getByText(t('tokenHelp.lead'))).toBeVisible();
}

test.describe('audit entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await remember(page);
    await mockApi(page, () => ({ status: 200, json: { auctionId: ROOM, status: 'DONE' } }));
  });

  test('from the home page link', async ({ page, shoot }) => {
    await page.goto('/');
    await ready(page);
    await page.getByRole('link', { name: t('home.link.ledger') }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${ROOM}/audit`));
    await expectShown(page);
    await shoot('audit', 'entry-from-home');
  });

  test('by its address', async ({ page, shoot }) => {
    await page.goto(`/r/${ROOM}/audit`);
    await ready(page);
    await expectShown(page);
    await shoot('audit', 'entry-by-address');
  });

  test('room not found', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 404, json: { error: 'not_found' } }));
    await page.goto(`/r/${ROOM}/audit`);
    await ready(page);
    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible();
    expect((await heading.boundingBox())?.y ?? 9999).toBeLessThan(300);
    await shoot('audit', 'entry-not-found');
  });
});
