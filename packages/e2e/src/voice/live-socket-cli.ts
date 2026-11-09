import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeBatch } from '@gavel/voice';
import { startStack, type Stack } from '../runner/stack';
import {
  connectAudio,
  now,
  setUpRoom,
  sleep,
  type AudioConnection,
  type Room,
  type SockCtor,
} from './live-room';
import {
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  LIVE_STACK_ENV,
  buildReport,
  reportMarkdown,
  parseWav,
  summarizeClip,
  toBatches,
  type Caption,
  type ClipObservation,
  type ExpectedOutcome,
} from './live-socket';

/**
 * Live speech through the /audio socket (issue 2194). Boots the real server process (fake
 * PayPal in its own process), registers bidders, opens a lot, then streams each committed 16 kHz
 * clip in real time over /audio with an auctioneer token, once per clip on a fresh socket. The
 * server runs with VOICE_STT set to one live provider and only that provider's key, and with an
 * empty cached recording, so a transcript can only come from the live provider. Records the
 * captions, the confirm prompts the bidders received and any price change (no bidder answers a
 * prompt, so a price change is an unconfirmed bid).
 *
 * Run: vite-node src/voice/live-socket-cli.ts --provider groq|deepgram --out <dir> [--limit N]
 * Needs GROQ_API_KEY or DEEPGRAM_API_KEY in the environment; without it the verdict is NOT RUN.
 * No key is printed or written.
 */

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const SERVER_DIR = join(ROOT, 'packages', 'server');
const CLIP_DIR = join(ROOT, 'packages', 'voice', 'fixtures', 'audio', 'recordings');
const MANIFEST = join(ROOT, 'packages', 'voice', 'fixtures', 'audio', 'manifest.json');

const BATCH_MS = 100;
const WAIT_FINAL_MS = 12_000;
const SETTLE_MS = 2_500;
const GAP_MS = 1_000;

interface ManifestClip {
  id: string;
  file: string;
  text: string;
  expected: ExpectedOutcome;
}

async function streamClip(
  stack: Stack,
  make: SockCtor,
  room: Room,
  clip: ManifestClip,
  samples: Int16Array,
): Promise<ClipObservation> {
  const captions: Caption[] = [];
  const statuses: string[] = [];
  const obs: ClipObservation = {
    id: clip.id,
    spokenText: clip.text,
    expected: clip.expected,
    startedAt: now(),
    speechEndAt: now(),
    endedAt: now(),
    captions,
    statuses,
    confirmPrompts: [],
    pricesWithLeader: [],
  };
  const seenFrom = room.seen.length;
  let conn: AudioConnection;
  try {
    conn = await connectAudio(stack, make, room, (f) => {
      if (f['t'] === 'caption') {
        captions.push({ at: now(), text: String(f['text'] ?? ''), final: f['final'] === true });
      } else if (f['t'] === 'status') statuses.push(`${String(f['stt'])}/${String(f['llm'])}`);
    });
  } catch (e) {
    obs.error = e instanceof Error ? e.message : String(e);
    return obs;
  }
  const { sock } = conn;
  const closeCodeOf = (): number | undefined => conn.closeCode();
  obs.startedAt = now();
  let seq = 0;
  for (const batch of toBatches(samples)) {
    if (closeCodeOf() !== undefined) break;
    sock.send(encodeBatch({ seq, tsMs: batch.offsetMs, flags: 0, pcm: batch.pcm }));
    seq += 1;
    await sleep(BATCH_MS);
  }
  obs.speechEndAt = now();
  if (closeCodeOf() === undefined) {
    sock.send(
      encodeBatch({
        seq,
        tsMs: now() - obs.startedAt,
        flags: FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE,
        pcm: new Int16Array(0),
      }),
    );
  }
  const until = now() + WAIT_FINAL_MS;
  while (
    closeCodeOf() === undefined &&
    now() < until &&
    !captions.some((c) => c.final && c.text.trim() !== '')
  ) {
    await sleep(50);
  }
  await sleep(SETTLE_MS);
  obs.endedAt = now();
  const finalClose = closeCodeOf();
  if (finalClose !== undefined) obs.closeCode = finalClose;
  sock.close(1000);

  const seenSeq = new Set<number>();
  for (const { at, paddle, frame } of room.seen.slice(seenFrom)) {
    if (at < obs.startedAt) continue;
    if (frame['t'] === 'confirm_request') {
      obs.confirmPrompts.push({ paddle, amountCents: Number(frame['amount']) });
    } else if (
      frame['t'] === 'price' &&
      frame['leaderId'] !== null &&
      frame['leaderId'] !== undefined
    ) {
      const seq = Number(frame['seq']);
      if (!seenSeq.has(seq)) {
        seenSeq.add(seq);
        obs.pricesWithLeader.push(Number(frame['price']));
      }
    }
  }
  return obs;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = arg('--provider');
  const out = arg('--out');
  if ((provider !== 'groq' && provider !== 'deepgram') || out === undefined) {
    process.stderr.write(
      'usage: live-socket-cli --provider groq|deepgram --out <dir> [--limit N]\n',
    );
    return 2;
  }
  const keyName = provider === 'groq' ? 'GROQ_API_KEY' : 'DEEPGRAM_API_KEY';
  const key = process.env[keyName] ?? '';
  if (key === '') {
    process.stdout.write(
      `VOICE LIVE SOCKET VERDICT: NOT RUN (${keyName} is not set for ${provider})\n`,
    );
    return 0;
  }
  const limit = Number(arg('--limit') ?? '0');
  mkdirSync(out, { recursive: true });
  process.env['GAVEL_E2E_SERVER_LOG'] = join(resolve(out), `server-${provider}.log`);

  const manifest = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as ManifestClip[]).filter(
    (c) => c.id !== undefined,
  );
  const clips = limit > 0 ? manifest.slice(0, limit) : manifest;
  const make = createRequire(join(SERVER_DIR, 'package.json'))('ws') as SockCtor;

  // Only the chosen provider's key reaches the server, so no other provider can answer.
  const providerKeys: Record<string, string> = { GROQ_API_KEY: '', DEEPGRAM_API_KEY: '' };
  providerKeys[keyName] = key;
  const stack = await startStack({
    externalFake: true,
    env: { VOICE_STT: provider, ...LIVE_STACK_ENV, ...providerKeys },
  });
  const rows = [];
  try {
    const room = await setUpRoom(stack, make);
    for (const clip of clips) {
      const wav = parseWav(readFileSync(join(CLIP_DIR, `${clip.id}.wav`)));
      if (wav.sampleRate !== 16_000 || wav.channels !== 1) {
        throw new Error(
          `${clip.id}: expected 16 kHz mono, got ${wav.sampleRate} Hz x ${wav.channels}`,
        );
      }
      const obs = await streamClip(stack, make, room, clip, wav.samples);
      const row = summarizeClip(obs);
      rows.push(row);
      process.stdout.write(
        `${clip.id}: ${row.providerAnswered ? 'transcript received' : 'no transcript'}, room: ${row.roomDecision}${row.error === null ? '' : ` (${row.error})`}\n`,
      );
      await sleep(GAP_MS);
    }
    for (const s of room.bidderSockets) s.close(1000);
  } finally {
    await stack.stop();
  }
  const runUrl =
    process.env['GITHUB_SERVER_URL'] &&
    process.env['GITHUB_REPOSITORY'] &&
    process.env['GITHUB_RUN_ID']
      ? `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}/actions/runs/${process.env['GITHUB_RUN_ID']}`
      : '';
  const report = buildReport({ provider, generatedAt: new Date().toISOString(), runUrl, rows });
  writeFileSync(join(out, `LIVE-SOCKET-${provider}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, `LIVE-SOCKET-${provider}.md`), `${reportMarkdown(report)}\n`);
  process.stdout.write(`VOICE LIVE SOCKET VERDICT: ${report.verdict} (${report.verdictReason})\n`);
  return report.verdict === 'PASS' ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
