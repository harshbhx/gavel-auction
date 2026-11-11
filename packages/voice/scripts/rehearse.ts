/**
 * Demo rehearsal: replays the first 20 s of the cached speech events and prints the timings.
 *
 *   node --experimental-strip-types packages/voice/scripts/rehearse.ts [--provider deepgram|groq] [--fast]
 *
 * With a live provider key in the environment the run says so and still plays the cached segment;
 * the live path is not driven from here. With no key, or with the live path unavailable, the cached
 * path is used and the label reads "recorded". No key and no network are needed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEGMENT_MS = 20_000;

interface SttEntry {
  readonly atMs: number;
  readonly event: { readonly type: string; readonly text?: string };
}

interface CachedUtterance {
  readonly provider: string;
  readonly utterance: number;
  readonly events: readonly SttEntry[];
}

export interface Line {
  readonly atMs: number;
  readonly type: string;
  readonly text: string;
}

export function liveAvailable(env: Record<string, string | undefined>, provider: string): boolean {
  const key = provider === 'groq' ? env['GROQ_API_KEY'] : env['DEEPGRAM_API_KEY'];
  return typeof key === 'string' && key.length > 0;
}

export function segmentLines(utterances: readonly CachedUtterance[], limitMs: number): Line[] {
  const out: Line[] = [];
  for (const u of utterances) {
    for (const e of u.events) {
      if (e.atMs > limitMs) continue;
      if (e.event.type !== 'interim' && e.event.type !== 'final') continue;
      out.push({ atMs: e.atMs, type: e.event.type, text: e.event.text ?? '' });
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

function loadCached(provider: string): CachedUtterance[] {
  const out: CachedUtterance[] = [];
  for (let n = 1; n <= 9; n++) {
    const url = new URL(`../fixtures/stt-cache/${provider}-u${n}.json`, import.meta.url);
    try {
      out.push(JSON.parse(readFileSync(url, 'utf8')) as CachedUtterance);
    } catch {
      break;
    }
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(argv: readonly string[]): Promise<void> {
  const pi = argv.indexOf('--provider');
  const provider = pi >= 0 && argv[pi + 1] === 'groq' ? 'groq' : 'deepgram';
  const fast = argv.includes('--fast');
  const live = liveAvailable(process.env, provider);
  const label = 'recorded';
  process.stdout.write(
    live
      ? `live key present for ${provider}; rehearsing the cached path, label: ${label}\n`
      : `live unavailable for ${provider}; using the cached path, label: ${label}\n`,
  );
  const lines = segmentLines(loadCached(provider), SEGMENT_MS);
  if (lines.length === 0) {
    process.stderr.write('no cached events found\n');
    process.exitCode = 1;
    return;
  }
  let last = 0;
  for (const l of lines) {
    if (!fast) await sleep(l.atMs - last);
    last = l.atMs;
    process.stdout.write(`${String(l.atMs).padStart(6)} ms  ${l.type.padEnd(7)} ${l.text}\n`);
  }
  const finals = lines.filter((l) => l.type === 'final').length;
  process.stdout.write(`done: ${lines.length} events, ${finals} finals within ${SEGMENT_MS} ms\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2));
}
