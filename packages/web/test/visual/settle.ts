import type { Page } from '@playwright/test';

/**
 * Brings a page to a stable state before a screenshot (issue 2172). Every step changes timing
 * only, never the pixels of a settled page, so committed baselines stay valid:
 * - the load event, so lazily imported route chunks have run;
 * - every declared font face loaded by hand (font-display: swap otherwise reflows text late);
 * - two animation frames, so layout and paint triggered by the font swap have been flushed;
 * - the same font and frame wait once more, in case the paint pulled in a new face.
 * The clock is frozen by the specs, so frames are awaited inside the page with requestAnimationFrame.
 */
export async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  for (let pass = 0; pass < 2; pass += 1) {
    await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined)));
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        const raf = window.requestAnimationFrame;
        raf(() => raf(() => resolve()));
      });
    });
  }
}
