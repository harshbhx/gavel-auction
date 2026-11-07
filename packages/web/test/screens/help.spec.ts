import { t } from '../../src/copy/t';
import { expect, test } from './support/harness';

/** The help button, the hold explainer sheet and the first-visit guided tour. */

test.describe('help', () => {
  test('help menu on the landing page', async ({ page, shoot }) => {
    await page.goto('/?tour=0');
    await page.getByRole('button', { name: t('help.button') }).click();
    await expect(page.getByRole('button', { name: t('help.open.hold') })).toBeVisible();
    await shoot('help', 'menu');
  });

  test('what is a hold sheet', async ({ page, shoot }) => {
    await page.goto('/?tour=0');
    await page.getByRole('button', { name: t('help.button') }).click();
    await page.getByRole('button', { name: t('help.open.hold') }).click();
    await expect(page.getByText(t('help.hold.heldTitle'))).toBeVisible();
    await shoot('help', 'hold-sheet');
  });

  test('tour step one on the landing page', async ({ page, shoot }) => {
    await page.goto('/?tour=1');
    await expect(page.getByRole('dialog', { name: t('tour.aria') })).toBeVisible();
    await shoot('help', 'tour-landing-step1');
  });

  test('tour in the scripted bidder room', async ({ page, shoot }) => {
    await page.goto('/r/demo/bid?scripted=1&tour=1');
    const dialog = page.getByRole('dialog', { name: t('tour.aria') });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: t('tour.next') }).click();
    await page.getByRole('button', { name: t('tour.next') }).click();
    await expect(page.getByText(t('tour.hold.title'))).toBeVisible();
    await shoot('help', 'tour-bid-step3-hold');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
