import { describe, expect, it } from 'vitest';
import { parseBid } from '../../src/parser/parse.js';
import { parseUtterance } from '../../src/parser/utterance.js';

/** Upper bound asserted for the p99 of a 200 character parse; the measured value is reported. */
const P99_LIMIT_MS = 20;

describe('T-VOX-052 parser performance (R-VOX-052)', () => {
  it('10000 parses of a 200 character input stay well under the p99 limit', () => {
    const text = `${'bidder 4 says three hundred and fifty maybe '.repeat(5)}`.slice(0, 200);
    expect(text).toHaveLength(200);
    const times: number[] = [];
    for (let i = 0; i < 10000; i += 1) {
      const start = performance.now();
      parseBid(text);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(times.length * 0.99)] ?? 0;
    console.log(`parseBid 200 chars: p99 ${p99.toFixed(3)} ms over ${times.length} parses`);
    expect(p99).toBeLessThan(P99_LIMIT_MS);
  });
});

describe('T-VOX-061 very long input (R-VOX-035)', () => {
  it('2000 characters of number words finish quickly with a well formed result', () => {
    const text = 'three hundred '.repeat(200).slice(0, 2000);
    expect(text).toHaveLength(2000);
    for (const run of [() => parseBid(text), () => parseUtterance(text)]) {
      const start = performance.now();
      const r = run();
      expect(performance.now() - start).toBeLessThan(50);
      expect(['bid', 'confirm', 'none']).toContain(r.status);
    }
  });
});
