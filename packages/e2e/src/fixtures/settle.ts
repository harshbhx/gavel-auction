/// <reference lib="dom" />
import type { Page } from '@playwright/test';

/**
 * Settle a page before a visual snapshot (QA-3).
 *
 * Root cause of the "Failed to take two consecutive stable screenshots" flake: the landing header
 * has a scroll-progress bar (`animation-timeline: scroll(root)`) and the sections use
 * `animation-timeline: view()`. The baselines hold the finished state (full orange bar). Playwright
 * only fast-forwards the animations that exist when it starts the shot, and a scroll-timeline
 * animation may still be pending then, so the bar sometimes renders at scaleX(0) (dark rule) and
 * sometimes finished (orange). The shot flips between two states and never stabilises. Fonts,
 * images and the Vite dev server compiling modules on first request add more movement.
 *
 * So wait for the page to be quiet, then finish every finishable animation ourselves.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  // Network idle is best effort: a page with a long-lived request must not fail the spec.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    const frames = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    await document.fonts.ready;
    // A lazy image below the fold is never fetched, so decode() would wait for it forever: load it
    // eagerly first, as a visitor who scrolled down would have.
    for (const img of Array.from(document.images)) img.loading = 'eager';
    await Promise.all(
      Array.from(document.images).map((img) => img.decode().catch(() => undefined)),
    );
    // Let layout and the animation timelines resolve, then jump every finite animation to its end.
    await frames();
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        // Infinite animations (marquee, wave) cannot finish; Playwright cancels them.
      }
    }
    await frames();
  });
}
