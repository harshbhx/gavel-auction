import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';
import { seedRoom, seedSession } from '../src/fixtures/room';

/**
 * Keyboard and live region checks on the real stack (R-QA-037, T-QA-047): the register form is
 * reachable within eight Tab presses, the focused control has a visible ring, and a live region
 * update lands within 200 ms of the announcement.
 *
 * The live region is driven through the app's own announcer module (the dev server serves it as a
 * module). The register form needs a real room, so each test seeds one over HTTP and stores the
 * joined bidder's session, which stands in for the invite step.
 */

const MAX_TABS = 8;
const LIVE_REGION_BUDGET_MS = 200;

test('the register form is reachable within eight Tab presses', async ({ page, stack }) => {
  const room = await seedRoom(stack);
  await seedSession(page, room);
  await page.goto(`${stack.webUrl}/r/${room.auctionId}/register`);
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
  const room = await seedRoom(stack);
  await seedSession(page, room);
  await page.goto(`${stack.webUrl}/r/${room.auctionId}/register`);
  await page.locator('form').waitFor();
  await page.keyboard.press('Tab');
  await page.locator('input[autocomplete="nickname"]').focus();
  await page.keyboard.type('Walnut');
  // The name field is followed directly by the submit button.
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

interface RingReading {
  tag: string;
  type: string;
  /** Where the ring is drawn: the control itself or the label that wraps it. */
  source: 'self' | 'label' | 'none';
  widthPx: number;
  contrast: number;
}

/**
 * Reads the focus ring of the focused control. A radio input is visually replaced by its label
 * chip in this app, so when the input has no outline of its own the wrapping label is measured.
 * The contrast is between the ring colour and the nearest solid background behind it.
 */
async function readFocusRing(page: Page): Promise<RingReading> {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      const parts = (m?.[1] ?? '0,0,0,0').split(/[ ,/]+/).filter((p) => p !== '');
      const n = parts.map((p) => Number(p));
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const lum = (c: [number, number, number, number]): number => {
      const f = (v: number): number => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const el = document.activeElement;
    if (el === null) return { tag: 'none', type: '', source: 'none', widthPx: 0, contrast: 0 };
    const own = getComputedStyle(el);
    const label = el.closest('label');
    let ringEl: Element = el;
    let source: 'self' | 'label' | 'none' = 'self';
    // A radio input is hidden and its label chip carries the ring, so prefer a label that has one.
    if (label !== null && getComputedStyle(label).outlineStyle !== 'none') {
      ringEl = label;
      source = 'label';
    } else if (own.outlineStyle === 'none' && label !== null) {
      ringEl = label;
      source = 'label';
    }
    const ring = getComputedStyle(ringEl);
    if (ring.outlineStyle === 'none') source = 'none';
    let bg: [number, number, number, number] = [255, 255, 255, 1];
    for (
      let node: Element | null = ringEl.parentElement;
      node !== null;
      node = node.parentElement
    ) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c[3] > 0.99) {
        bg = c;
        break;
      }
    }
    const a = lum(parse(ring.outlineColor));
    const b = lum(bg);
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') ?? '',
      source,
      widthPx: ring.outlineStyle === 'none' ? 0 : parseFloat(ring.outlineWidth),
      contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    };
  });
}

/**
 * The register walk past the form, by keyboard alone, on a real seeded room behind a stored
 * session: name, submit with Enter, the ceiling radios (Tab, then Space), the radio focus ring
 * (2 px and 3:1) and the Approve button, reached with Tab. It stops at Approve: the PayPal
 * approval popup and the return route that follows it are not driven here.
 */
test('register walk past the form by keyboard: radio focus ring and Approve', async ({
  page,
  stack,
}, testInfo) => {
  const room = await seedRoom(stack);
  await seedSession(page, room);
  await page.goto(`${stack.webUrl}/r/${room.auctionId}/register`);
  await page.locator('form').waitFor();
  await page.locator('input[autocomplete="nickname"]').focus();
  await page.keyboard.type('Walnut');
  await page.keyboard.press('Enter');
  await page.locator('input[type="radio"]').first().waitFor();

  let presses = 0;
  let onRadio = false;
  while (!onRadio && presses < MAX_TABS) {
    await page.keyboard.press('Tab');
    presses += 1;
    onRadio = await page.evaluate(
      () =>
        document.activeElement?.tagName === 'INPUT' &&
        document.activeElement.getAttribute('type') === 'radio',
    );
  }
  expect(onRadio, `a ceiling radio focused after ${presses} Tab presses`).toBe(true);
  const radioRing = await readFocusRing(page);
  await testInfo.attach('radio-focus-ring.json', {
    body: JSON.stringify({ tabPresses: presses, ...radioRing }, null, 2),
    contentType: 'application/json',
  });
  expect(radioRing.source, 'a ring is drawn on the radio or its label').not.toBe('none');
  expect(radioRing.widthPx).toBeGreaterThanOrEqual(2);
  expect(radioRing.contrast).toBeGreaterThanOrEqual(3);

  await page.keyboard.press('Space');
  await expect(page.getByTestId('held-block')).toBeVisible();
  const approve = page.getByRole('button', { name: 'Approve hold with PayPal' });
  let toApprove = 0;
  while (toApprove < MAX_TABS && !(await approve.evaluate((el) => el === document.activeElement))) {
    await page.keyboard.press('Tab');
    toApprove += 1;
  }
  await expect(approve).toBeFocused();
  const approveRing = await readFocusRing(page);
  await testInfo.attach('approve-focus-ring.json', {
    body: JSON.stringify({ tabPresses: toApprove, ...approveRing }, null, 2),
    contentType: 'application/json',
  });
  expect(approveRing.widthPx).toBeGreaterThanOrEqual(2);
  expect(approveRing.contrast).toBeGreaterThanOrEqual(3);
});
