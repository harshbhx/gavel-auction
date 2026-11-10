import { expect, test } from '@playwright/test';
import { t } from '../../src/copy/t';
import { receiptFailed, receiptLoser, receiptWinner } from '../screens/support/frames';
import { mockApi, openRoom } from '../screens/support/harness';
import { settlePage } from './settle';

/**
 * Settlement baselines (R-QA-034, T-QA-046, issue 290): the receipt route of a sold lot with its
 * settlement panel, for the winner whose hold was captured, a bidder whose hold was released, and a
 * capture that failed and needs review. The room is answered from a mock socket (the same harness
 * as the screen tour), so no server or PayPal is involved and the clock is frozen by the harness.
 * Baselines are written by the browser-specs workflow with update_baselines, never by hand.
 */

const STATES = [
  { name: 'winner-captured', scenario: receiptWinner, paddle: 12 },
  { name: 'loser-released', scenario: receiptLoser, paddle: 9 },
  { name: 'capture-failed', scenario: receiptFailed, paddle: 12 },
] as const;

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '390x844', width: 390, height: 844 },
] as const;

for (const state of STATES) {
  for (const viewport of VIEWPORTS) {
    test(`settlement ${state.name} at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockApi(page, () => ({ status: 404 }));
      await openRoom(page, {
        scenario: state.scenario,
        at: 6_000,
        role: 'bidder',
        route: 'receipt',
        paddle: state.paddle,
      });
      await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
      await settlePage(page);
      await expect(page).toHaveScreenshot(`settlement-${state.name}-${viewport.name}.png`, {
        caret: 'hide',
        // The settlement panel sits below the fold on a phone, so the whole page is compared.
        fullPage: true,
      });
    });
  }
}
