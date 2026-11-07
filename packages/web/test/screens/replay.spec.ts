import type { Page } from '@playwright/test';
import { alertOf, expect, test } from './support/harness';
import { happy } from './support/frames';

/**
 * Replay of a recording: the bundle is served from the test, and a controlled clock moves the
 * recording to a chosen moment, so every picture shows the same instant.
 */

const ID = 'rec-demo-0001';

function bundleOf(): unknown {
  return {
    version: 1,
    title: 'Signed first-press vinyl, sandbox demo',
    events: happy.steps.flatMap((step) =>
      step.emit === undefined ? [] : [{ t: step.at, msg: step.emit }],
    ),
  };
}

async function serveBundle(page: Page, mode: 'ok' | 'invalid' | 'missing' | 'hang'): Promise<void> {
  await page.route(`**/recordings/${ID}/events.json`, async (route) => {
    if (mode === 'hang') return;
    if (mode === 'missing') {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mode === 'invalid' ? { version: 99, events: [] } : bundleOf()),
    });
  });
}

async function replayAt(page: Page, ms: number): Promise<void> {
  await serveBundle(page, 'ok');
  await page.clock.install({ time: new Date('2026-01-15T12:00:00.000Z') });
  await page.goto(`/replay/${ID}`);
  await page
    .getByRole('button', { name: /^(Pause|Resume)/ })
    .first()
    .waitFor();
  if (ms > 0) await page.clock.runFor(ms);
}

test.describe('replay', () => {
  test('loading', async ({ page, shoot }) => {
    await serveBundle(page, 'hang');
    await page.goto(`/replay/${ID}`);
    await page.locator('main').first().waitFor();
    await shoot('replay', 'loading');
  });

  test('recording not found', async ({ page, shoot }) => {
    await serveBundle(page, 'missing');
    await page.goto(`/replay/${ID}`);
    await expect(alertOf(page)).toBeVisible();
    await shoot('replay', 'not-found');
  });

  test('recording unreadable', async ({ page, shoot }) => {
    await serveBundle(page, 'invalid');
    await page.goto(`/replay/${ID}`);
    await expect(alertOf(page)).toBeVisible();
    await shoot('replay', 'unreadable');
  });

  test('start, console view', async ({ page, shoot }) => {
    await replayAt(page, 0);
    await shoot('replay', 'start-console');
  });

  test('mid auction, console view', async ({ page, shoot }) => {
    await replayAt(page, 4_500);
    await shoot('replay', 'bidding-console');
  });

  test('mid auction, screen view', async ({ page, shoot }) => {
    await replayAt(page, 4_500);
    await page.locator('[data-view="screen"]').click();
    await shoot('replay', 'bidding-screen');
  });

  test('after the hammer, console view', async ({ page, shoot }) => {
    await replayAt(page, 15_500);
    await shoot('replay', 'hammered-console');
  });

  test('settled, ladder view', async ({ page, shoot }) => {
    await replayAt(page, 19_000);
    await page.locator('[data-view="ladder"]').click();
    await shoot('replay', 'settled-ladder');
  });

  test('settled, screen view', async ({ page, shoot }) => {
    await replayAt(page, 19_000);
    await page.locator('[data-view="screen"]').click();
    await shoot('replay', 'settled-screen');
  });
});
