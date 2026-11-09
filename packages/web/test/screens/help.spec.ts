import { t } from '../../src/copy/t';
import { expect, test } from './support/harness';

/** The help button, the hold explainer sheet . */

test.describe('help', () => {
  test('help menu on the landing page', async ({ page, shoot }) => {
    await page.goto('/');
    await page.getByRole('button', { name: t('help.button') }).click();
    await expect(page.getByRole('button', { name: t('help.open.hold') })).toBeVisible();
    await shoot('help', 'menu');
  });

  test('what is a hold sheet', async ({ page, shoot }) => {
    await page.goto('/');
    await page.getByRole('button', { name: t('help.button') }).click();
    await page.getByRole('button', { name: t('help.open.hold') }).click();
    await expect(page.getByText(t('help.hold.heldTitle'))).toBeVisible();
    await shoot('help', 'hold-sheet');
  });
});
