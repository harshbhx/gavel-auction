import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverSchemas } from '@gavel/shared';
import { startStack } from '../runner/stack';
import {
  buildRecording,
  hostingProblems,
  ledgerProblems,
  summarizeRecording,
  type Frame,
} from './judge-recording';

/**
 * Records a judge-room auction as a replay bundle (inventory row 41). Boots the real server with
 * judge rooms on (fake payments, simulated holds), creates a judge room over HTTP, joins three
 * bidders by room code, gives each a simulated hold, places bids over the room socket two seconds
 * apart so the replay reads slowly, hammers the lot, and records every frame a public screen
 * receives. Writes `<out>/recordings/<id>/events.json` (the path the web app's /replay/:id route
 * fetches) and `<out>/summary.json`. The bundle says its holds are simulated. It also carries the
 * room's hash-chained ledger export (GET /admin/replay-bundle), read after the last frame, so the
 * replay page can verify the chain and compare the hammer price; a recording whose ledger is
 * missing or does not verify gets a FAIL verdict.
 *
 * Run: vite-node src/replay/record-judge-room-cli.ts --out <dir> [--id <recording id>]
 */

const SERVER_DIR = fileURLToPath(new URL('../../../server', import.meta.url));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BID_GAP_MS = 2000;

type Frame0 = Record<string, unknown>;
interface Sock {
  readyState: number;
  on(event: string, cb: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(): void;
}
type SockCtor = new (url: string, opts: { headers: Record<string, string> }) => Sock;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const now = (): number => Date.now();

function ulid(): string {
  let t = now();
  let head = '';
  for (let i = 0; i < 10; i += 1) {
    head = (ALPHABET[t % 32] ?? '0') + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += ALPHABET[randomInt(32)] ?? '0';
  return head + tail;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} answered ${res.status}`);
  return (await res.json()) as T;
}

function decode(raw: unknown): Frame['msg'] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = (raw as { t?: unknown }).t;
  if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(serverSchemas, t)) return null;
  const schema = (
    serverSchemas as Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>
  )[t];
  const parsed = schema?.safeParse(raw);
  return parsed?.success === true ? (parsed.data as Frame['msg']) : null;
}

function open(
  make: SockCtor,
  url: string,
  origin: string,
  onFrame: (f: Frame0) => void,
): Promise<Sock> {
  return new Promise((resolveOpen, reject) => {
    const sock = new make(url, { headers: { origin } });
    sock.on('message', (data) => {
      try {
        onFrame(JSON.parse(String(data)) as Frame0);
      } catch {
        // not JSON: ignore
      }
    });
    sock.on('open', () => resolveOpen(sock));
    sock.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const out = arg('--out');
  if (out === undefined) {
    process.stderr.write('usage: record-judge-room-cli --out <dir> [--id <recording id>]\n');
    return 2;
  }
  const id = arg('--id') ?? 'judge-room-simulated-holds';
  const make = createRequire(join(SERVER_DIR, 'package.json'))('ws') as SockCtor;
  const stack = await startStack({ env: { JUDGE_ROOMS: 'true', JUDGE_SIM_HOLDS: '1' } });
  const frames: Frame[] = [];
  const sockets: Sock[] = [];
  let ledger: unknown;
  try {
    const base = stack.serverUrl;
    const origin = new URL(base).origin;
    const wsUrl = `${base.replace(/^http/, 'ws')}/ws`;
    const created = await json<{
      auctionId: string;
      joinCode: string;
      auctioneerToken: string;
      screenToken: string;
    }>(
      await fetch(`${base}/api/judge/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Judge room auction' }),
      }),
      'create judge room',
    );
    const { auctionId } = created;
    const seen: Frame0[] = [];

    // The recorder is a public screen: it sees what a screen sees and nothing private.
    const screen = await open(make, wsUrl, origin, (f) => {
      seen.push(f);
      frames.push({ atMs: now(), msg: f as Frame['msg'] });
    });
    sockets.push(screen);
    screen.send(JSON.stringify({ v: 1, t: 'join', token: created.screenToken, auctionId }));
    const stateBy = now() + 15_000;
    while (!seen.some((f) => f['t'] === 'state') && now() < stateBy) await sleep(25);
    const state = seen.find((f) => f['t'] === 'state') as
      | {
          snapshot?: {
            config?: { ceilingPresets?: number[]; reserve?: number; minIncrement?: number };
          };
        }
      | undefined;
    const config = state?.snapshot?.config;
    const ceiling = Math.max(...(config?.ceilingPresets ?? [0]));
    if (config === undefined || ceiling <= 0) throw new Error('the room snapshot has no ceilings');

    const bidders: Array<{ name: string; sock: Sock; replies: Frame0[] }> = [];
    for (const name of ['Ana', 'Ben', 'Caro']) {
      const joined = await json<{ sessionToken: string }>(
        await fetch(`${base}/api/judge/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: created.joinCode, displayName: name }),
        }),
        `join ${name}`,
      );
      await json(
        await fetch(`${base}/api/judge/rooms/${auctionId}/sim-hold`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${joined.sessionToken}`,
          },
          body: JSON.stringify({ ceilingCents: ceiling, name }),
        }),
        `simulated hold for ${name}`,
      );
      const replies: Frame0[] = [];
      const sock = await open(make, wsUrl, origin, (f) => replies.push(f));
      sock.send(JSON.stringify({ v: 1, t: 'join', token: joined.sessionToken, auctionId }));
      const upBy = now() + 15_000;
      while (!replies.some((f) => f['t'] === 'state') && now() < upBy) await sleep(25);
      sockets.push(sock);
      bidders.push({ name, sock, replies });
      await sleep(800);
    }

    // The lot is open once the room exists; asking again is harmless if it already is.
    await fetch(`${base}/api/auctions/${auctionId}/control`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${created.auctioneerToken}`,
      },
      body: JSON.stringify({ controlId: `open-${now()}`, action: 'open' }),
    }).then((r) => r.arrayBuffer());
    await sleep(BID_GAP_MS);

    const increment = config.minIncrement ?? 1000;
    let amount = (config.reserve ?? 0) + increment;
    for (let round = 0; round < 6; round += 1) {
      const who = bidders[round % bidders.length];
      if (who === undefined) break;
      const latest = [...seen].reverse().find((f) => f['t'] === 'price');
      if (latest !== undefined && typeof latest['minNext'] === 'number') amount = latest['minNext'];
      const mid = ulid();
      who.sock.send(JSON.stringify({ v: 1, t: 'bid', mid, amount, source: 'manual' }));
      const replyBy = now() + 8000;
      while (
        !who.replies.some(
          (f) => (f['t'] === 'bid_accepted' || f['t'] === 'bid_rejected') && f['mid'] === mid,
        ) &&
        now() < replyBy
      ) {
        await sleep(25);
      }
      await sleep(BID_GAP_MS);
    }

    const hammered = await fetch(`${base}/api/auctions/${auctionId}/control`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${created.auctioneerToken}`,
      },
      body: JSON.stringify({
        controlId: `hammer-${now()}`,
        action: 'hammer',
        args: { closeNow: 1 },
      }),
    });
    if (!hammered.ok) throw new Error(`hammer answered ${hammered.status}`);
    // Let the settlement frames arrive: stop after 3 quiet seconds, at most 25 s.
    const stopBy = now() + 25_000;
    let quietSince = now();
    let count = frames.length;
    while (now() < stopBy && now() - quietSince < 3000) {
      await sleep(250);
      if (frames.length !== count) {
        count = frames.length;
        quietSince = now();
      }
    }
    // The ledger export the replay page verifies. A failed read leaves it out; the verdict says so.
    const exported = await fetch(
      `${base}/admin/replay-bundle?auctionId=${encodeURIComponent(auctionId)}`,
      { headers: { 'x-admin-key': stack.adminKey } },
    );
    if (exported.ok) ledger = (await exported.json()) as unknown;
    else process.stderr.write(`ledger export answered ${exported.status}\n`);
  } finally {
    for (const s of sockets) s.close();
    await stack.stop();
  }

  const { bundle, dropped } = buildRecording({
    title: 'Judge room auction (simulated holds)',
    recordedAt: new Date().toISOString(),
    frames,
    decode,
    ledger,
  });
  const summary = summarizeRecording(bundle);
  const problems = [...hostingProblems(summary), ...ledgerProblems(bundle)];
  const dir = join(resolve(out), 'recordings', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.json'), `${JSON.stringify(bundle)}\n`);
  writeFileSync(
    join(resolve(out), 'summary.json'),
    `${JSON.stringify({ id, simulatedHolds: true, droppedFrames: dropped, ledgerEntries: bundle.ledger?.count ?? 0, ...summary, hostingProblems: problems }, null, 2)}\n`,
  );
  process.stdout.write(
    `recorded ${summary.events} frames over ${summary.durationMs} ms (${summary.leadChanges} lead changes, hammer ${summary.hammered ? 'yes' : 'no'}, ${dropped} frames dropped)\n`,
  );
  process.stdout.write(
    `REPLAY RECORDING VERDICT: ${problems.length === 0 ? 'PASS' : 'FAIL'} (${problems.length === 0 ? 'simulated-hold judge room recorded' : problems.join('; ')})\n`,
  );
  return problems.length === 0 ? 0 : 1;
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
