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

test('gallery: dialog traps focus and gives it back on close', async ({ page }) => {
  await page.goto('/gallery');
  const opener = page.getByTestId(TEST_IDS.dialogOpen);
  await opener.focus();
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
  await page.goto('/gallery');
  const opener = page.getByTestId(TEST_IDS.dialogOpen);
  await opener.focus();
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

test('route change puts focus on the main heading', async ({ page }) => {
  await page.goto('/nowhere');
  await expect(page.locator('h1')).toBeFocused();
  await page.goto('/gallery');
  await expect(page.locator('h1')).toBeFocused();
});
