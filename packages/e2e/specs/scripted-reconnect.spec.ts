import { expect, test } from '../src/fixtures/base';
import { ScriptedView } from '../src/pages/views';

/**
 * Scenario S09 (reconnect) through the UI (R-QA-031, T-QA-045): the scripted `reconnect_gap` room
 * loses a message and resyncs from a snapshot. The public screen must show the true price after
 * the resync, with no server. Held at a moment after the socket drop the scripted transport does
 * not deliver later frames, so the reopen step of S09 is not asserted here.
 */

test('scripted S09: the screen shows the resynced price after a lost message', async ({
  page,
  stack,
}) => {
  const screen = new ScriptedView(page, stack, 'screen');
  await screen.open(4_500, 'reconnect_gap');
  await expect(screen.price).toHaveText('$200.00', { timeout: 20_000 });
  await expect(screen.sold).toHaveCount(0);
});
