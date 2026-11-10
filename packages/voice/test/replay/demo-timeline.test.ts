import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_TIMELINE } from '../../src/replay/demo-timeline.js';

const fixtures = new URL('../../fixtures/', import.meta.url);

describe('DEMO_TIMELINE (cached replay mode)', () => {
  it('plays the recorded events of the three demo utterances', () => {
    expect(DEMO_TIMELINE.utterances).toHaveLength(3);
    [1, 2, 3].forEach((n, i) => {
      const cached = JSON.parse(
        readFileSync(new URL(`stt-cache/deepgram-u${n}.json`, fixtures), 'utf8'),
      ) as { startMs: number; endMs: number; events: unknown[] };
      const u = DEMO_TIMELINE.utterances[i];
      expect(u?.startMs).toBe(cached.startMs);
      expect(u?.endMs).toBe(cached.endMs);
      expect(u?.events).toEqual(cached.events);
    });
  });

  it('has a final transcript in every utterance', () => {
    for (const u of DEMO_TIMELINE.utterances) {
      expect(u.events.some((e) => e.event.type === 'final')).toBe(true);
    }
  });
});
