import { describe, expect, it } from 'vitest';
import {
  SIMULATED_NOTE,
  buildRecording,
  hostingProblems,
  summarizeRecording,
  type Frame,
} from '../src/replay/judge-recording';

// Pure parts of the judge-room replay recording (inventory row 41). The recording itself happens
// only in the dispatch workflow.

const frame = (atMs: number, t: string, extra: Record<string, unknown> = {}): Frame => ({
  atMs,
  msg: { t, ...extra },
});
const accept = (m: unknown): Frame['msg'] | null =>
  typeof m === 'object' && m !== null && (m as { t?: unknown }).t !== 'junk'
    ? (m as Frame['msg'])
    : null;
const input = (frames: Frame[]) => ({
  title: 'Judge room auction (simulated holds)',
  recordedAt: '2026-11-09T00:00:00.000Z',
  frames,
  decode: accept,
});

describe('buildRecording', () => {
  it('starts offsets at the first state frame and never goes backwards', () => {
    const { bundle } = buildRecording(
      input([
        frame(5000, 'price'),
        frame(1000, 'ping'),
        frame(2000, 'state'),
        frame(2500, 'price', { leaderId: 'b1' }),
        frame(2400, 'price'),
      ]),
    );
    expect(bundle.events.map((e) => e.msg.t)).toEqual(['state', 'price', 'price', 'price']);
    expect(bundle.events.map((e) => e.t)).toEqual([0, 400, 500, 3000]);
  });
  it('drops frames the decoder refuses and counts them', () => {
    const r = buildRecording(input([frame(0, 'state'), frame(10, 'junk'), frame(20, 'price')]));
    expect(r.dropped).toBe(1);
    expect(r.bundle.events).toHaveLength(2);
  });
  it('throws when there is no state frame', () => {
    expect(() => buildRecording(input([frame(0, 'price')]))).toThrow(/state/);
  });
  it('labels the bundle as simulated in the title, a flag and a note', () => {
    const { bundle } = buildRecording(input([frame(0, 'state')]));
    expect(bundle.version).toBe(1);
    expect(bundle.title).toContain('simulated holds');
    expect(bundle.simulatedHolds).toBe(true);
    expect(bundle.note).toBe(SIMULATED_NOTE);
    expect(bundle.note).toContain('no PayPal call');
  });
});

describe('summarizeRecording and hostingProblems', () => {
  const bundle = buildRecording(
    input([
      frame(0, 'state'),
      frame(100, 'price', { leaderId: null }),
      frame(200, 'price', { leaderId: 'a' }),
      frame(300, 'price', { leaderId: 'b' }),
      frame(400, 'hammer'),
      frame(500, 'settlement_update'),
    ]),
  ).bundle;
  it('counts frames by type, lead changes and the hammer', () => {
    const s = summarizeRecording(bundle);
    expect(s.events).toBe(6);
    expect(s.durationMs).toBe(500);
    expect(s.leadChanges).toBe(2);
    expect(s.hammered).toBe(true);
    expect(s.settlementUpdates).toBe(1);
    expect(hostingProblems(s)).toEqual([]);
  });
  it('says why a thin recording is not worth hosting', () => {
    const thin = summarizeRecording(buildRecording(input([frame(0, 'state')])).bundle);
    expect(hostingProblems(thin)).toEqual([
      'only 0 bid(s) took the lead, need at least 2',
      'no hammer frame was recorded',
    ]);
  });
});
