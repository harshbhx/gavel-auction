import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';

/**
 * Keyboard and live region checks on the real stack (R-QA-037, T-QA-047): the register form is
 * reachable within eight Tab presses, the focused control has a visible ring, and a live region
 * update lands within 200 ms of the announcement.
 *
 * The live region is driven through the app's own announcer module (the dev server serves it as a
 * module), because the screens that announce need a live room. The register form is shown with a
 * stored session, which stands in for the invite step.
 */

const MAX_TABS = 8;
const LIVE_REGION_BUDGET_MS = 200;

async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'gavel:session:room1',
      JSON.stringify({ token: 'walnut', bidderId: 'bidder-one' }),
    );
  });
}

test('the register form is reachable within eight Tab presses', async ({ page, stack }) => {
  await seedSession(page);
  await page.goto(`${stack.webUrl}/r/room1/register`);
  await page.locator('form').waitFor();
  let presses = 0;
  let onName = false;
  while (!onName && presses < MAX_TABS) {
    await page.keyboard.press('Tab');
    presses += 1;
    onName = await page.evaluate(
      () => document.activeElement?.getAttribute('autocomplete') === 'nickname',
    );
  }
  expect(onName, `name field focused after ${presses} Tab presses`).toBe(true);
  expect(presses).toBeLessThanOrEqual(MAX_TABS);
});

test('the focused field and button show a ring at least 2 px wide', async ({ page, stack }) => {
  await seedSession(page);
  await page.goto(`${stack.webUrl}/r/room1/register`);
  await page.locator('form').waitFor();
  await page.keyboard.press('Tab');
  await page.locator('input[autocomplete="nickname"]').focus();
  await page.keyboard.type('Walnut');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return { tag: 'none', style: 'none', width: 0 };
    const s = getComputedStyle(el);
    return { tag: el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.tag).toBe('BUTTON');
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});

test('a live region update lands within 200 ms of the announcement', async ({ page, stack }) => {
  await page.goto(`${stack.webUrl}/gallery`);
  await page.getByTestId('live-assertive').waitFor({ state: 'attached' });
  const elapsed = await page.evaluate(`(async () => {
    const mod = await import('/src/a11y/announce.ts');
    const region = document.querySelector('[data-testid="live-assertive"]');
    const wait = new Promise((resolve) => {
      const seen = new MutationObserver(() => {
        if ((region.textContent || '').includes('walnut update')) {
          seen.disconnect();
          resolve(performance.now());
        }
      });
      seen.observe(region, { childList: true, subtree: true, characterData: true });
    });
    const start = performance.now();
    mod.announce('assertive', 'walnut update');
    const end = await wait;
    return end - start;
  })()`);
  expect(elapsed).toBeLessThan(LIVE_REGION_BUDGET_MS);
});
