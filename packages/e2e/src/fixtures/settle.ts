import type { Page } from '@playwright/test';

/**
 * Settle a page before a visual snapshot (QA-3). The visual specs flaked with "Failed to take two
 * consecutive stable screenshots" because the shot was taken while the page was still moving:
 * the Vite dev server compiles modules on the first request, web fonts swap in late, images
 * decode late, and the scroll-driven, blur-in, marquee and number-ticker effects are still
 * mid-flight (WebKit supports scroll timelines, so Playwright cannot fast-forward them).
 *
 * Call `calmMotion` before navigating and `settle` after it.
 */
export async function calmMotion(page: Page): Promise<void> {
  // Every moving rule in the web app sits behind prefers-reduced-motion: no-preference.
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  // Network idle is best effort: a page with a long-lived request must not fail the spec.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) => img.decode().catch(() => undefined)),
    );
    // Two frames, so layout and paint have caught up with the fonts and images.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}
