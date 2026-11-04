import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakePayPalServer } from '../../src/fake/server.js';
import { DAY_MS as FAKE_DAY_MS } from '../../src/fake/core.js';
import { lintJsonl } from '../../gates/evidence.js';
import { DAY_MS, dueEntries, loadState, parseState, runG3, type G3State } from '../../gates/g3.js';
import { runG3Timed } from '../../gates/g3-timed.js';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';

let out: string;
let lines: string[];
let server: FakePayPalServer;

beforeEach(async () => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g3-test-'));
  lines = [];
  server = new FakePayPalServer();
  await server.start();
});

afterEach(async () => {
  await server.stop();
  rmSync(out, { recursive: true, force: true });
});

const env = { PAYPAL_ENV: 'sandbox' };
const log = (m: string): void => {
  lines.push(m);
};

function records(): Array<{ step: string; actual?: unknown; assertion?: { actual: unknown } }> {
  const dir = join(out, 'G3');
  const text = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('');
  expect(lintJsonl(text)).toEqual([]);
  return text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as { step: string; assertion?: { actual: unknown } });
}

function state(createdAtMs = 0, done: string[] = []): G3State {
  return {
    v: 1,
    createdAtMs,
    entries: [
      { label: 'probe', orderId: 'O1', authId: 'A1', dueDays: 0 },
      { label: 'd35', orderId: 'O2', authId: 'A2', dueDays: 3.5 },
      { label: 'd40', orderId: 'O3', authId: 'A3', dueDays: 4 },
      { label: 'd50', orderId: 'O4', authId: 'A4', dueDays: 5 },
    ].map((e) => ({
      ...e,
      ...(done.includes(e.label) ? { doneAtMs: 1 } : {}),
    })) as G3State['entries'],
  };
}

describe('dueEntries', () => {
  it('lists nothing before 3.5 days and never the immediate probe', () => {
    expect(dueEntries(state(), 3.4 * DAY_MS)).toEqual([]);
  });
  it('adds one entry per time mark', () => {
    expect(dueEntries(state(), 3.5 * DAY_MS).map((e) => e.label)).toEqual(['d35']);
    expect(dueEntries(state(), 4 * DAY_MS).map((e) => e.label)).toEqual(['d35', 'd40']);
    expect(dueEntries(state(), 6 * DAY_MS).map((e) => e.label)).toEqual(['d35', 'd40', 'd50']);
  });
  it('skips entries that are done', () => {
    expect(dueEntries(state(0, ['d35']), 4 * DAY_MS).map((e) => e.label)).toEqual(['d40']);
  });
});

describe('parseState', () => {
  it('round-trips a state', () => {
    expect(parseState(JSON.stringify(state(5)))).toEqual(state(5));
  });
  it('rejects wrong shapes', () => {
    expect(() => parseState('nope')).toThrow('not JSON');
    expect(() => parseState('{"v":2}')).toThrow('wrong shape');
    expect(() => parseState(JSON.stringify({ v: 1, createdAtMs: 1, entries: [{}] }))).toThrow(
      'incomplete',
    );
  });
});

describe('G3 day 0 against the fake', () => {
  it('creates four authorizations, probes at once and saves the state', async () => {
    const code = await runG3({
      argv: ['--fake', '--out', out],
      env,
      log,
      fakeServer: server,
    });
    expect(code).toBe(EXIT_OK);
    const statePath = join(out, 'G3', 'state.json');
    expect(existsSync(statePath)).toBe(true);
    const s = loadState(statePath);
    expect(s.entries.map((e) => e.label)).toEqual(['probe', 'd35', 'd40', 'd50']);
    expect(new Set(s.entries.map((e) => e.authId)).size).toBe(4);
    const steps = records().map((r) => r.step);
    expect(steps).toContain('G3.2 immediate reauthorize');
    expect(lines.some((l) => l.startsWith('G3 immediate reauthorize'))).toBe(true);
  });

  it('refuses outside the sandbox', async () => {
    const code = await runG3({
      argv: ['--out', out],
      env: { PAYPAL_ENV: 'live' },
      log,
    });
    expect(code).toBe(EXIT_REFUSED);
  });
});

describe('G3 timed checks against the fake', () => {
  it('does nothing before 3.5 days', async () => {
    await runG3({ argv: ['--fake', '--out', out], env, log, fakeServer: server });
    const s = loadState(join(out, 'G3', 'state.json'));
    const code = await runG3Timed({
      argv: ['--fake', '--out', out],
      env,
      log,
      fakeServer: server,
      now: () => s.createdAtMs + 3 * DAY_MS,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((l) => l.includes('nothing due yet'))).toBe(true);
  });

  it('probes each authorization once when its time mark has passed', async () => {
    await runG3({ argv: ['--fake', '--out', out], env, log, fakeServer: server });
    const statePath = join(out, 'G3', 'state.json');
    const s = loadState(statePath);
    server.core.clock.advance(4.2 * FAKE_DAY_MS);
    const now = s.createdAtMs + 4.2 * DAY_MS;
    const run = (): Promise<number> =>
      runG3Timed({
        argv: ['--fake', '--out', out],
        env,
        log,
        fakeServer: server,
        now: () => now,
      });
    expect(await run()).toBe(EXIT_OK);
    const after = loadState(statePath);
    expect(after.entries.filter((e) => e.doneAtMs !== undefined).map((e) => e.label)).toEqual([
      'd35',
      'd40',
    ]);
    const probed = lines.filter((l) => /^G3 d(35|40) /.test(l));
    expect(probed).toHaveLength(2);
    lines.length = 0;
    // A second run has nothing left to do before day 5.
    expect(await run()).toBe(EXIT_OK);
    expect(lines.some((l) => l.includes('nothing due yet'))).toBe(true);
  });

  it('fails with a message when the state file is missing', async () => {
    const code = await runG3Timed({
      argv: ['--fake', '--out', out, '--state', join(out, 'none.json')],
      env,
      log,
      fakeServer: server,
    });
    expect(code).toBe(EXIT_FAILED);
    expect(lines.join('\n')).toContain('state file not found');
  });

  it('refuses fake mode without the day-0 server', async () => {
    const code = await runG3Timed({ argv: ['--fake', '--out', out], env, log });
    expect(code).toBe(EXIT_REFUSED);
  });
});
