import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';
import { seedRoom } from '../src/fixtures/room';
import { AuctioneerView } from '../src/pages/views';

/**
 * Voice replay on the console (T-VOX-093, R-VOX-081, R-VOX-102): the auctioneer presses "Play recorded
 * voice demo" on a host in cached speech mode. The host plays the recorded transcripts through the real
 * pipeline; the console shows each final line at its recorded offset (within 300 ms of the gap between
 * lines), and a second press gives the same lines in the same order. No microphone and no keys.
 */

const OFFSET_TOLERANCE_MS = 300;
const FIXTURES = new URL('../../voice/fixtures/stt-cache/', import.meta.url);

interface CachedEvent {
  atMs: number;
  event: { type: string; text?: string };
}

/** The recorded final line and its offset for each of the three demo utterances. */
function recordedFinals(): Array<{ atMs: number; text: string }> {
  return [1, 2, 3].map((n) => {
    const file = fileURLToPath(new URL(`deepgram-u${n}.json`, FIXTURES));
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { events: CachedEvent[] };
    const final = cached.events.find((e) => e.event.type === 'final');
    if (final === undefined || final.event.text === undefined) throw new Error(`no final in u${n}`);
    return { atMs: final.atMs, text: final.event.text };
  });
}

/** Watches the caption line and records when each final line appeared. */
async function watchCaptions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __finals: Array<{ at: number; text: string }> };
    w.__finals = [];
    const root = document.querySelector('[data-route="console"]');
    if (root === null) throw new Error('console not mounted');
    new MutationObserver(() => {
      const el = root.querySelector('.gv-voice-control__caption[data-final="true"]');
      const text = el?.textContent ?? '';
      const last = w.__finals[w.__finals.length - 1];
      if (el !== null && text !== '' && last?.text !== text) {
        w.__finals.push({ at: performance.now(), text });
      }
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function finals(page: Page): Promise<Array<{ at: number; text: string }>> {
  return page.evaluate(
    () => (window as unknown as { __finals: Array<{ at: number; text: string }> }).__finals,
  );
}

test('the console replay control plays the recorded demo, twice the same', async ({
  page,
  stack,
}) => {
  test.setTimeout(120_000);
  const room = await seedRoom(stack);
  await new AuctioneerView(page, stack, room).open();
  const expected = recordedFinals();
  const runs: string[][] = [];

  for (let run = 0; run < 2; run += 1) {
    await page.getByRole('button', { name: /play recorded voice demo/i }).click();
    await expect(page.getByRole('button', { name: /stop recorded demo/i })).toBeVisible();
    await watchCaptions(page);
    await expect
      .poll(async () => (await finals(page)).length, { timeout: 60_000, intervals: [250] })
      .toBe(expected.length);

    const got = await finals(page);
    const lines = got.map((g) => g.text.replace(/^Heard:\s*/, ''));
    expect(lines).toEqual(expected.map((e) => e.text));
    // The gap between two lines is the recorded gap, whatever the connection time was.
    for (let i = 1; i < got.length; i += 1) {
      const heardGap = (got[i]?.at ?? 0) - (got[i - 1]?.at ?? 0);
      const recordedGap = (expected[i]?.atMs ?? 0) - (expected[i - 1]?.atMs ?? 0);
      expect(Math.abs(heardGap - recordedGap)).toBeLessThanOrEqual(OFFSET_TOLERANCE_MS);
    }
    runs.push(lines);
    await page.getByRole('button', { name: /stop recorded demo/i }).click();
    await expect(page.getByRole('button', { name: /play recorded voice demo/i })).toBeVisible();
  }

  expect(runs[1]).toEqual(runs[0]);
});
