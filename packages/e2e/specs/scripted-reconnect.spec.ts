import { expect, test } from '../src/fixtures/base';
import { ScriptedView } from '../src/pages/views';

/**
 * Scenario S09 (reconnect) through the UI (R-QA-031, T-QA-045): the scripted `reconnect_gap` room
 * loses a message, resyncs from a snapshot, drops the socket and reopens it. The public screen
 * must show the true price after the resync and again after the reconnect, with no server.
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

test('scripted S09: the screen shows the last price after the socket reopens', async ({
  page,
  stack,
}) => {
  const screen = new ScriptedView(page, stack, 'screen');
  await screen.open(8_000, 'reconnect_gap');
  await expect(screen.price).toHaveText('$300.00', { timeout: 20_000 });
});
