import { expect, test, type Page } from '@playwright/test';
import { TEST_IDS } from '../../src/testing/testids';

/**
 * Motion and forced colours (R-WEB-114, R-WEB-017, T-WEB-054). The hammer stamp and the price tick
 * live on the gallery. Under reduced motion their computed animation duration is 0s; with no
 * preference they run for the 600 ms hammer and 240 ms standard tokens. In forced colours the
 * state chips and the stamp keep a border and the focus ring stays drawn.
 */

async function durationOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el: Element) => getComputedStyle(el).animationDuration);
}

test.describe('reduced motion', () => {
  test('hammer and price tick have no animation time', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery');
    expect(await durationOf(page, TEST_IDS.hammerStamp)).toBe('0s');
    expect(await durationOf(page, TEST_IDS.screenPrice)).toBe('0s');
  });

  test('the hammer stamp is shown at rest', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery');
    const style = await page.getByTestId(TEST_IDS.hammerStamp).evaluate((el: Element) => ({
      opacity: getComputedStyle(el).opacity,
      transform: getComputedStyle(el).transform,
    }));
    expect(style.opacity).toBe('1');
    expect(style.transform).toBe('none');
  });
});

test.describe('no motion preference', () => {
  test('hammer runs 600 ms and the price tick 240 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/gallery');
    expect(await durationOf(page, TEST_IDS.hammerStamp)).toBe('0.6s');
    expect(await durationOf(page, TEST_IDS.screenPrice)).toBe('0.24s');
  });
});

test.describe('forced colours', () => {
  test('the stamp and the state chips keep a visible border', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/gallery');
    const stamp = await page
      .getByTestId(TEST_IDS.hammerStamp)
      .evaluate((el: Element) => parseFloat(getComputedStyle(el).borderTopWidth));
    expect(stamp).toBeGreaterThanOrEqual(2);
    const chips = await page
      .locator('.gv-chip')
      .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).borderTopWidth)));
    expect(chips.length).toBeGreaterThan(0);
    for (const width of chips) expect(width).toBeGreaterThanOrEqual(2);
  });

  test('the focus ring is still drawn on a button', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/gallery');
    // One key press sets keyboard modality, then the button takes focus so :focus-visible applies.
    await page.keyboard.press('Tab');
    await page.getByTestId(TEST_IDS.dialogOpen).focus();
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null) return { style: 'none', width: 0, tag: 'none' };
      const s = getComputedStyle(el);
      return {
        style: s.outlineStyle,
        width: parseFloat(s.outlineWidth),
        tag: `${el.tagName}.${el.className}`,
      };
    });
    expect(ring.style, `outline style, active ${ring.tag}`).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
  });
});

test.describe('forced colours on the settlement ladder', () => {
  test('rungs keep an icon and a label, the current rung a Highlight border', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/gallery');
    const ladder = page.locator('.gv-ladder');
    await ladder.waitFor();
    const rungs = await ladder.locator('.gv-ladder__rung').evaluateAll((els) =>
      els.map((el) => ({
        status: el.getAttribute('data-status') ?? '',
        hasIcon: el.querySelector('.gv-ladder__icon svg') !== null,
        label: (el.querySelector('.gv-ladder__label')?.textContent ?? '').trim(),
      })),
    );
    expect(rungs.length).toBeGreaterThan(0);
    for (const rung of rungs) {
      expect(rung.hasIcon, `icon on a ${rung.status} rung`).toBe(true);
      expect(rung.label.length, `label on a ${rung.status} rung`).toBeGreaterThan(0);
    }
    expect(rungs.some((r) => r.status === 'current')).toBe(true);
    const current = await ladder
      .locator('.gv-ladder__rung[data-status="current"]')
      .first()
      .evaluate((el: Element) => {
        const s = getComputedStyle(el);
        const probe = document.createElement('span');
        probe.style.color = 'Highlight';
        document.body.appendChild(probe);
        const highlight = getComputedStyle(probe).color;
        probe.remove();
        return {
          width: parseFloat(s.borderTopWidth),
          style: s.borderTopStyle,
          color: s.borderTopColor,
          highlight,
        };
      });
    expect(current.style).toBe('solid');
    expect(current.width).toBeGreaterThanOrEqual(2);
    expect(current.color).toBe(current.highlight);
    // The checks above are computed; the picture is kept as a report attachment for a human.
    await testInfo.attach('ladder-forced-colors', {
      body: await ladder.screenshot(),
      contentType: 'image/png',
    });
  });
});
