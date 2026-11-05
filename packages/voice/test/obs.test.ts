import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createMetricsSpy,
  METRIC,
  redact,
  type LogLevel,
  type LogRecord,
} from '../src/obs.js';

// Built at run time so no key-shaped literal sits in the source.
const FAKE_KEYS = [
  ['sk', 'abcdefghijklmnop1234'].join('-'),
  `Bearer ${'a'.repeat(12)}.${'b'.repeat(12)}`,
  `api_key=${'z'.repeat(20)}`,
  'f'.repeat(40),
];

function run(level: LogLevel): string {
  const records: LogRecord[] = [];
  const log = createLogger({ level, sink: (r) => records.push(r), now: () => 1000 });
  log.info('stt_final', { provider: 'fake', transcript: 'paddle seven three fifty' });
  log.info('auth', { header: FAKE_KEYS[1], note: `using ${String(FAKE_KEYS[0])}` });
  log.debug('segment', {
    text: 'two fifty',
    audio: new Int16Array(160),
    nested: { k: FAKE_KEYS[2] },
  });
  log.warn('hash', { id: FAKE_KEYS[3] });
  return JSON.stringify(records);
}

describe('T-VOX-106 logger (R-VOX-098)', () => {
  it('at info level has no transcripts, audio or key patterns', () => {
    const out = run('info');
    expect(out).not.toContain('paddle seven');
    expect(out).not.toContain('two fifty');
    for (const key of FAKE_KEYS) expect(out).not.toContain(key);
    expect(out).not.toContain('"0,0,0');
  });

  it('at debug level allows transcripts but never keys or audio', () => {
    const out = run('debug');
    expect(out).toContain('paddle seven three fifty');
    expect(out).toContain('two fifty');
    for (const key of FAKE_KEYS) expect(out).not.toContain(key);
    expect(out).toContain('[redacted]');
  });

  it('drops transcripts nested in objects and arrays below debug level', () => {
    const records: LogRecord[] = [];
    const log = createLogger({ level: 'info', sink: (r) => records.push(r), now: () => 1 });
    log.info('decision', {
      evidence: { transcript: 'paddle 12 five hundred', kept: 1 },
      list: [{ text: 'nested spoken words' }],
    });
    const out = JSON.stringify(records);
    expect(out).not.toContain('paddle 12');
    expect(out).not.toContain('nested spoken');
    expect(out).toContain('"kept":1');
  });

  it('keeps nested transcripts at debug level', () => {
    const records: LogRecord[] = [];
    const log = createLogger({ level: 'debug', sink: (r) => records.push(r), now: () => 1 });
    log.debug('decision', { evidence: { transcript: 'paddle 12 five hundred' } });
    expect(JSON.stringify(records)).toContain('paddle 12 five hundred');
  });

  it('redacts key patterns in free text', () => {
    expect(redact(`x ${String(FAKE_KEYS[0])} y`)).toBe('x [redacted] y');
    expect(redact('paddle twelve three hundred')).toBe('paddle twelve three hundred');
  });
});

describe('T-VOX-113 metrics interface (R-VOX-105)', () => {
  it('counts a scripted session by name and labels', () => {
    const m = createMetricsSpy();
    m.counter(METRIC.sttFinal, { provider: 'fake' });
    m.counter(METRIC.sttFinal, { provider: 'fake' });
    m.counter(METRIC.decision, { kind: 'accept', reason: 'ok' });
    m.counter(METRIC.decision, { kind: 'confirm', reason: 'homophone' });
    m.counter(METRIC.audioDroppedMs, undefined, 240);
    m.histogram(METRIC.decisionLatencyMs, 900);
    m.histogram(METRIC.decisionLatencyMs, 1100);
    expect(m.total(METRIC.sttFinal, { provider: 'fake' })).toBe(2);
    expect(m.total(METRIC.decision, { reason: 'homophone', kind: 'confirm' })).toBe(1);
    expect(m.total(METRIC.decision, { kind: 'drop', reason: 'ok' })).toBe(0);
    expect(m.total(METRIC.audioDroppedMs)).toBe(240);
    expect(m.observations(METRIC.decisionLatencyMs)).toEqual([900, 1100]);
  });

  it('names match section 13', () => {
    expect(Object.values(METRIC)).toHaveLength(13);
    expect(METRIC.llmTimeout).toBe('voice_llm_timeout_total');
  });
});
