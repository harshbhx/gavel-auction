import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_DURATION_S = 90;
const MAX_SIZE_BYTES = 3 * 1024 * 1024;

interface Utterance {
  readonly startMs: number;
  readonly endMs: number;
  readonly expected: string;
  readonly cachedEvents?: readonly object[];
}

interface Timeline {
  readonly utterances: readonly Utterance[];
}

export interface CheckResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function checkTimeline(timeline: Timeline): CheckResult {
  const errors: string[] = [];
  const outcomes = new Set<string>();

  for (const u of timeline.utterances) {
    if (u.endMs <= u.startMs) {
      errors.push(`utterance at ${u.startMs} has endMs <= startMs`);
    }
    outcomes.add(u.expected);
  }

  const lastEnd = timeline.utterances.reduce((max, u) => Math.max(max, u.endMs), 0);
  if (lastEnd > MAX_DURATION_S * 1000) {
    errors.push(`total duration ${lastEnd} ms exceeds ${MAX_DURATION_S} s`);
  }

  if (!outcomes.has('bid')) errors.push('missing at least one bid utterance');
  if (!outcomes.has('confirm')) errors.push('missing at least one confirm utterance');
  if (!outcomes.has('none')) errors.push('missing at least one none utterance');

  return { ok: errors.length === 0, errors };
}

export function checkWavSize(wavPath: string): CheckResult {
  const errors: string[] = [];
  try {
    const stat = statSync(wavPath);
    if (stat.size > MAX_SIZE_BYTES) {
      errors.push(`wav file is ${stat.size} bytes, exceeds ${MAX_SIZE_BYTES}`);
    }
  } catch {
    errors.push(`wav file not found: ${wavPath}`);
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dir = process.argv[2] ?? resolve('packages/voice/fixtures/replay');
  const timelinePath = resolve(dir, 'timeline.json');
  const wavPath = resolve(dir, 'clip.wav');

  const timeline: Timeline = JSON.parse(readFileSync(timelinePath, 'utf8')) as Timeline;
  const tResult = checkTimeline(timeline);
  const wResult = checkWavSize(wavPath);

  const allErrors = [...tResult.errors, ...wResult.errors];
  if (allErrors.length > 0) {
    console.error('Replay asset check failed:');
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  process.stdout.write('Replay assets OK\n');
}
