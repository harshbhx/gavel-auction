import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../src/fixtures/base';
import { hammerRoom, seedRoom } from '../src/fixtures/room';
import { AuctioneerView, PublicView } from '../src/pages/views';

const BASELINES = fileURLToPath(new URL('../__screenshots__', import.meta.url));
const updating = (process.env['UPDATE'] ?? '') !== '';

/**
 * Visual baselines (R-QA-034, T-QA-046) at 1280x720 and 390x844, pixel ratio under 0.002 (set in
 * the config). Baselines are written in CI only and change only in a PR labelled visual-update.
 * Covered: landing, the component gallery, and, in a seeded fake room, the public screen open and
 * hammered and the auctioneer console with its ladder (hammered, no bids). NOT covered: the
 * settlement panel with captured and released holds. It renders only on the receipt route of a
 * sold lot, which needs a bid over the room socket; a browser spec cannot send one yet.
 */

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '390x844', width: 390, height: 844 },
] as const;

const SCREENS = [
  { name: 'landing', path: '/' },
  { name: 'gallery', path: '/gallery' },
] as const;

for (const screen of SCREENS) {
  for (const viewport of VIEWPORTS) {
    test(`${screen.name} at ${viewport.name}`, async ({ page, stack }, testInfo) => {
      test.skip(
        !updating && !existsSync(`${BASELINES}/${testInfo.project.name}`),
        'no baselines committed for this project yet',
      );
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.install({ time: new Date('2026-01-15T12:00:00.000Z') });
      await page.goto(`${stack.webUrl}${screen.path}`);
      await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}.png`);
    });
  }
}

const ROOM_SCREENS = [
  { name: 'public-screen-open', hammer: false, view: 'public' },
  { name: 'public-screen-hammered', hammer: true, view: 'public' },
  { name: 'ladder', hammer: true, view: 'console' },
] as const;

for (const screen of ROOM_SCREENS) {
  for (const viewport of VIEWPORTS) {
    test(`${screen.name} at ${viewport.name}`, async ({ page, stack }, testInfo) => {
      test.skip(
        !updating && !existsSync(`${BASELINES}/${testInfo.project.name}`),
        'no baselines committed for this project yet',
      );
      const room = await seedRoom(stack);
      if (screen.hammer) await hammerRoom(stack, room);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.install({ time: new Date('2026-01-15T12:00:00.000Z') });
      if (screen.view === 'public') {
        const view = new PublicView(page, stack, room);
        await view.open();
        if (screen.hammer) await expect(view.sold).toBeVisible();
        // The clock follows the real end time and the join code carries a random port.
        await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}.png`, {
          mask: [view.clock, view.join],
        });
      } else {
        const view = new AuctioneerView(page, stack, room);
        await view.open();
        await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}.png`);
      }
    });
  }
}
