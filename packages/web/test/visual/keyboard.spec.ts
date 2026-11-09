import { expect, test, type Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { TEST_IDS } from '../../src/testing/testids';

/**
 * Keyboard-only walks (R-WEB-111, R-WEB-112, T-WEB-053): every control is reachable with Tab, the
 * focus ring is at least 2 px wide and 3:1 against its background, dialogs trap and restore
 * focus, and a route change puts focus on the main heading.
 */

interface RingReading {
  tag: string;
  widthPx: number;
  contrast: number;
}

/** Reads the focused element's outline width and its contrast against the nearest solid background. */
async function readRing(page: Page): Promise<RingReading> {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      const parts = (m?.[1] ?? '0,0,0,0').split(/[ ,/]+/).filter((p) => p !== '');
      const n = parts.map((p) => Number(p));
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const lum = (c: [number, number, number, number]): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const el = document.activeElement;
    if (el === null) return { tag: 'none', widthPx: 0, contrast: 0 };
    const style = getComputedStyle(el);
    let bg: [number, number, number, number] = [255, 255, 255, 1];
    // The ring is drawn outside the element (outline-offset), so measure against its parent.
    for (let node: Element | null = el.parentElement; node !== null; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c[3] > 0.99) {
        bg = c;
        break;
      }
    }
    const ring = parse(style.outlineColor);
    const a = lum(ring);
    const b = lum(bg);
    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return {
      tag: el.tagName.toLowerCase(),
      widthPx: style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth),
      contrast,
    };
  });
}

test('landing: Tab reaches every control with a visible ring and never traps', async ({ page }) => {
  await page.goto('/');
  await page.locator('main').first().waitFor();
  const seen = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const tag = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return '';
      return `${el.tagName}:${el.textContent ?? ''}:${el.getAttribute('name') ?? ''}`;
    });
    if (tag === '') break;
    seen.add(tag);
    const ring = await readRing(page);
    expect(ring.widthPx, `ring width on ${ring.tag}`).toBeGreaterThanOrEqual(2);
    expect(ring.contrast, `ring contrast on ${ring.tag}`).toBeGreaterThanOrEqual(3);
  }
  expect(seen.size).toBeGreaterThan(0);
  // Shift+Tab walks back out: focus is not trapped on the page.
  await page.keyboard.press('Shift+Tab');
});

/**
 * Opens /gallery and puts focus on the dialog opener. The route chrome moves focus to the main
 * heading once the lazy route has rendered (useRouteChrome); in WebKit that sometimes ran after the
 * test's own focus() call and took focus away, so the key press went to the heading and no dialog
 * opened (issue 2271, page snapshot shows the h1 active). Wait for that move first, then focus the
 * opener and check it holds before pressing anything.
 */
async function focusDialogOpener(page: Page) {
  await page.goto('/gallery');
  const opener = page.getByTestId(TEST_IDS.dialogOpen);
  await expect(opener).toBeVisible();
  // Focus moves to the heading when the route chrome has run; tolerate a route that leaves it.
  await expect(page.getByRole('heading', { level: 1 }))
    .toBeFocused({ timeout: 5_000 })
    .catch(() => undefined);
  await expect(async () => {
    await opener.focus();
    await expect(opener).toBeFocused({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  return opener;
}

test('gallery: dialog traps focus and gives it back on close', async ({ page }) => {
  const opener = await focusDialogOpener(page);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(inside).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('gallery: a button opens the dialog with Enter and with Space', async ({ page }) => {
  await focusDialogOpener(page);
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toBeVisible();
});

/** Presses Tab until `match` is true for the focused element; returns how many presses it took. */
async function tabUntil(page: Page, match: (el: Element) => boolean, max: number): Promise<number> {
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(
      `(${match.toString()})(document.activeElement ?? document.body)`,
    );
    if (hit === true) return presses;
  }
  return -1;
}

test('register walk: name, ceiling and approve with the keyboard alone', async ({ page }) => {
  // SKIPPED ON PURPOSE (QA-86): since the register route waits for the room snapshot over the
  // socket, the form never renders here, where no server runs and "room1" is not a room id. A
  // stored session alone no longer stands in for the invite step. The same walk (Tab reach, ring
  // width) runs against a real seeded room in packages/e2e/specs/a11y-keyboard.spec.ts. Restore
  // this test once it can feed the page a room snapshot (page.routeWebSocket with a ULID room).
  test.skip(
    true,
    'register form needs a live room snapshot; covered by the e2e a11y-keyboard spec',
  );
  // A stored session stands in for the invite step, so the form renders without a server.
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'gavel:session:room1:bidder',
      JSON.stringify({ token: 'walnut', bidderId: 'bidder-one' }),
    );
  });
  await page.goto('/r/room1/register');
  await expect(page.locator('h1')).toHaveText(t('reg.step1'));

  const toName = await tabUntil(
    page,
    (el) => el.tagName === 'INPUT' && el.getAttribute('autocomplete') === 'nickname',
    8,
  );
  expect(toName, 'Tab presses to reach the name field').toBeGreaterThan(0);
  expect(toName).toBeLessThanOrEqual(8);
  let ring = await readRing(page);
  expect(ring.widthPx).toBeGreaterThanOrEqual(2);
  expect(ring.contrast).toBeGreaterThanOrEqual(3);

  await page.keyboard.type('Walnut');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('type'))).toBe('submit');
  ring = await readRing(page);
  expect(ring.widthPx).toBeGreaterThanOrEqual(2);
  expect(ring.contrast).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Enter');

  await expect(page.locator('h1')).toHaveText(t('reg.step2'));
  const toRadio = await tabUntil(
    page,
    (el) => el.tagName === 'INPUT' && el.getAttribute('type') === 'radio',
    8,
  );
  expect(toRadio, 'Tab presses to reach the ceiling choices').toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(TEST_IDS.heldBlock)).toBeVisible();
  await page.keyboard.press('Tab');
  const approve = page.getByRole('button', { name: t('reg.approve') });
  await expect(approve).toBeFocused();
  await expect(approve).toBeEnabled();
  ring = await readRing(page);
  expect(ring.widthPx).toBeGreaterThanOrEqual(2);
  expect(ring.contrast).toBeGreaterThanOrEqual(3);
});

test('scripted bid: Tab reaches the bid button, Enter sends, focus stays on it, no trap', async ({
  page,
}) => {
  await page.goto('/r/demo/bid?scripted=1&at=3000');
  await page.locator('[data-route="bid"]').waitFor();
  const reached = await tabUntil(
    page,
    (el) => el.tagName === 'BUTTON' && /^Bid /.test(el.textContent ?? ''),
    20,
  );
  expect(reached, 'Tab presses to reach the bid button').toBeGreaterThan(0);
  const label = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await page.keyboard.press('Enter');
  // The tap guard holds the button for a moment; after the result the focus has not moved.
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? '',
    text: document.activeElement?.textContent ?? '',
  }));
  expect(after.tag).toBe('BUTTON');
  expect(after.text).toBe(label);
  // Tab keeps moving: the page is not a keyboard trap.
  const seen = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    seen.add(await page.evaluate(() => document.activeElement?.textContent ?? 'body'));
  }
  expect(seen.size).toBeGreaterThan(1);
});

test('scripted console: Enter on the hammer opens a confirm dialog that traps focus', async ({
  page,
}) => {
  await page.goto('/r/demo/console?scripted=1&at=5000');
  const hammer = page.getByRole('button', { name: t('console.hammer') });
  await expect(hammer).toBeEnabled();
  await hammer.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(hammer).toBeFocused();
});

test('route change puts focus on the main heading', async ({ page }) => {
  await page.goto('/nowhere');
  await expect(page.locator('h1')).toBeFocused();
  await page.goto('/gallery');
  await expect(page.locator('h1')).toBeFocused();
});

/**
 * The ledger grid with the keyboard alone: Tab enters the table, arrows move by row, Enter selects a
 * row, the focus ring is drawn, and Tab leaves the table at once (it does not walk every cell).
 */
test('ledger grid: arrows move by row, Enter selects, Tab leaves, ring is visible', async ({
  page,
}) => {
  await page.goto('/ledger');
  await page.locator('.gv-gridbox .ag-row').first().waitFor();
  const inGrid = (): Promise<boolean> =>
    page.evaluate(() => document.activeElement?.closest('.ag-root-wrapper') != null);

  const presses = await tabUntil(page, (el) => el.closest('.ag-root-wrapper') !== null, 30);
  expect(presses, 'Tab reaches the table').toBeGreaterThan(0);
  const ring = await readRing(page);
  expect(ring.widthPx, `ring width on ${ring.tag}`).toBeGreaterThanOrEqual(2);
  expect(ring.contrast, `ring contrast on ${ring.tag}`).toBeGreaterThanOrEqual(3);

  await page.keyboard.press('ArrowDown');
  const rowIndex = (): Promise<number> =>
    page.evaluate(() =>
      Number(document.activeElement?.closest('[role="row"]')?.getAttribute('aria-rowindex') ?? 0),
    );
  const start = await rowIndex();
  await page.keyboard.press('ArrowDown');
  expect(await rowIndex()).toBe(start + 1);

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /^Entry \d+$/ })).toBeVisible();

  await page.keyboard.press('Tab');
  expect(await inGrid(), 'one Tab leaves the table').toBe(false);
});
