import { t } from '../../src/copy/t';
import { expect, openRoom, test } from './support/harness';
import { HAPPY, happy } from './support/frames';

/** The alert mute toggle on the bidder phone, off and on, with the choice kept in localStorage. */
test.describe('alerts: mute toggle', () => {
  test('toggle off and on', async ({ page, shoot }) => {
    await openRoom(page, { role: 'bidder', route: 'bid', scenario: happy, at: HAPPY.outbid });
    const toggle = page.getByTestId('alerts-mute');
    await expect(toggle).toHaveText(t('alerts.mute'));
    await shoot('alerts', 'toggle-sound-on');
    await toggle.click();
    await expect(toggle).toHaveText(t('alerts.unmute'));
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => globalThis.localStorage.getItem('gavel.alertsMuted'))).toBe(
      '1',
    );
    await shoot('alerts', 'toggle-muted');
  });
});
