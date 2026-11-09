import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evolveAll } from '@gavel/engine';
import { parseNdjson } from '@gavel/server/src/admin/export';
import type { AuctionId } from '@gavel/shared';
import { startStack, type Stack } from '../runner/stack.js';
import { sandboxGateway } from './lot.js';
import { openSession, type SandboxSession } from './session.js';
import {
  buildKillEvidence,
  evaluateKillRun,
  killMarkdown,
  killVerdict,
  type JournalView,
  type KillRunInput,
  type TruthRow,
} from './kill-evidence.js';

// Real server process, whole auction, SIGKILL during settlement, restart on the same data folder
// (issue 2185). In `sandbox` mode the holds are real PayPal sandbox authorizations and the server
// runs with PAYMENTS=sandbox; in `fake` mode the same harness runs against the fake PayPal, which
// is what the unit tests use to prove the harness itself (that output is labelled and is not
// sandbox evidence). The server kills itself with GAVEL_CHECKPOINT_KILL after PayPal was asked to
// capture and before the answer was handled.

const CHECKPOINT = 'after_capture_request_before_response' as const;
const HOLD_CENTS = 20_000;
const BIDS: Array<{ actor: string; amount: number }> = [
  { actor: 'b', amount: 10_000 },
  { actor: 'c', amount: 11_000 },
  { actor: 'a', amount: 12_500 },
];
const ACTORS = ['a', 'b', 'c'];
const SERVER_DIR = fileURLToPath(new URL('../../../server', import.meta.url));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

type Env = Readonly<Record<string, string | undefined>>;
type Frame = Record<string, unknown>;
interface Sock {
  readyState: number;
  on(event: string, cb: (...args: unknown[]) => void): void;
  send(text: string): void;
  close(): void;
}
type SockCtor = new (url: string, opts: { headers: Record<string, string> }) => Sock;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function ulid(): string {
  let t = Date.now();
  let head = '';
  for (let i = 0; i < 10; i += 1) {
    head = (ALPHABET[t % 32] ?? '0') + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += ALPHABET[randomInt(32)] ?? '0';
  return head + tail;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${new URL(res.url).pathname} answered ${res.status}`);
  return (await res.json()) as T;
}

class Client {
  private readonly frames: Frame[] = [];
  private sock: Sock | undefined;
  constructor(
    private readonly make: SockCtor,
    private readonly url: string,
    private readonly origin: string,
    private readonly auctionId: string,
    private readonly token: string,
  ) {}

  async open(): Promise<void> {
    const sock = new this.make(this.url, { headers: { origin: this.origin } });
    this.sock = sock;
    sock.on('message', (data) => {
      try {
        this.frames.push(JSON.parse(String(data)) as Frame);
      } catch {
        // not JSON
      }
    });
    await new Promise<void>((resolve, reject) => {
      sock.on('open', () => resolve());
      sock.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
    });
    sock.send(JSON.stringify({ v: 1, t: 'join', token: this.token, auctionId: this.auctionId }));
    await this.waitFor((f) => f['t'] === 'state', 'a state frame');
  }

  async bid(amount: number): Promise<string> {
    const mid = ulid();
    this.sock?.send(JSON.stringify({ v: 1, t: 'bid', mid, amount, source: 'manual' }));
    const reply = await this.waitFor(
      (f) => (f['t'] === 'bid_accepted' || f['t'] === 'bid_rejected') && f['mid'] === mid,
      `the reply to a bid of ${amount}`,
    );
    return String(reply['t']);
  }

  close(): void {
    this.sock?.close();
  }

  private async waitFor(match: (f: Frame) => boolean, what: string): Promise<Frame> {
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      const hit = this.frames.find(match);
      if (hit !== undefined) return hit;
      await sleep(25);
    }
    throw new Error(`timed out waiting for ${what}`);
  }
}

export interface KillRunOptions {
  mode: 'sandbox' | 'fake';
  outDir: string;
  env: Env;
  runUrl?: string;
}

export interface KillRunResult {
  verdict: 'PASS' | 'FAIL';
  evidence: ReturnType<typeof buildKillEvidence>;
}

interface Enrolled {
  actor: string;
  bidderId: string;
  holdId: string;
  authId: string;
  orderId: string;
  client: Client;
}

export async function runServerKill(opts: KillRunOptions): Promise<KillRunResult> {
  const sandbox = opts.mode === 'sandbox';
  const startedAt = new Date().toISOString();
  const steps: Array<{ at: string; step: string; note?: string }> = [];
  const note = (step: string, n?: string): void => {
    steps.push({ at: new Date().toISOString(), step, ...(n === undefined ? {} : { note: n }) });
  };
  let session: SandboxSession | undefined;
  if (sandbox) {
    session = await openSession({
      env: opts.env,
      runId: `kill-${startedAt.replace(/[-:.TZ]/g, '').slice(2, 14)}`,
      gate: 'QA-KILL',
      now: () => Date.now(),
      sleep,
    });
    note('sandbox session opened');
  }

  const stack: Stack = await startStack({
    ...(sandbox ? { sandbox: true } : { externalFake: true }),
    checkpointKill: CHECKPOINT,
  });
  const clients: Client[] = [];
  try {
    note('server process started', `checkpoint ${CHECKPOINT} armed`);
    const WebSocketCtor = createRequire(join(SERVER_DIR, 'package.json'))('ws') as SockCtor;
    const origin = new URL(stack.serverUrl).origin;
    const wsUrl = `${stack.serverUrl.replace(/^http/, 'ws')}/ws`;
    const adminHeaders = { 'content-type': 'application/json', 'x-admin-key': stack.adminKey };

    const created = await json<{ auctionId: string; auctioneerLink: string }>(
      await fetch(`${stack.serverUrl}/api/auctions`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'server-kill',
          config: {
            mode: 'english',
            currency: 'USD',
            reserve: 100,
            minIncrement: 1,
            endTs: Date.now() + 3_600_000,
            softCloseWindowMs: 30_000,
            softCloseExtensionMs: 30_000,
            maxExtensions: 5,
            ceilingPresets: [HOLD_CENTS],
            confirmConfidenceThreshold: 0.85,
          },
        }),
      }),
    );
    const auctionId = created.auctionId;
    const auctioneerToken = created.auctioneerLink.split('#token=')[1] ?? '';
    const bearer = {
      'content-type': 'application/json',
      authorization: `Bearer ${auctioneerToken}`,
    };
    note('auction created');

    const enrolled = new Map<string, Enrolled>();
    for (const actor of ACTORS) {
      const { invites } = await json<{ invites: Array<{ link: string }> }>(
        await fetch(`${stack.serverUrl}/api/auctions/${auctionId}/invites`, {
          method: 'POST',
          headers: bearer,
          body: JSON.stringify({ count: 1 }),
        }),
      );
      const joined = await json<{ sessionToken: string; bidderId: string }>(
        await fetch(`${stack.serverUrl}/api/auctions/${auctionId}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invite: invites[0]?.link.split('#token=')[1] ?? '' }),
        }),
      );
      let holdId: string;
      let authId: string;
      let orderId = '';
      if (session !== undefined) {
        const h = await session.authorize(`kill-${actor}`, HOLD_CENTS);
        authId = h.authId;
        orderId = h.orderId;
        const r = await json<{ holdId: string }>(
          await fetch(`${stack.serverUrl}/__e2e/enrol-sandbox`, {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({
              auctionId,
              bidderId: joined.bidderId,
              name: actor,
              ceilingCents: HOLD_CENTS,
              orderId,
              authId,
            }),
          }),
        );
        holdId = r.holdId;
      } else {
        const r = await json<{ holdId: string; authId: string | null }>(
          await fetch(`${stack.serverUrl}/__e2e/enrol`, {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({
              auctionId,
              bidderId: joined.bidderId,
              name: actor,
              ceilingCents: HOLD_CENTS,
              presetsCents: [HOLD_CENTS],
            }),
          }),
        );
        if (r.authId === null) throw new Error('the fake hold has no authorization');
        holdId = r.holdId;
        authId = r.authId;
      }
      const client = new Client(WebSocketCtor, wsUrl, origin, auctionId, joined.sessionToken);
      await client.open();
      clients.push(client);
      enrolled.set(actor, { actor, bidderId: joined.bidderId, holdId, authId, orderId, client });
      note('bidder enrolled with a hold', actor);
    }

    for (const b of BIDS) {
      const reply = await (enrolled.get(b.actor) as Enrolled).client.bid(b.amount);
      note('bid', `${b.actor} ${b.amount}: ${reply}`);
      if (reply !== 'bid_accepted') throw new Error(`bid by ${b.actor} was not accepted`);
    }

    const pidBefore = stack.serverPid();
    note('hammer', `server pid ${pidBefore ?? 'unknown'}`);
    const tHammer = Date.now();
    try {
      await fetch(`${stack.serverUrl}/api/auctions/${auctionId}/control`, {
        method: 'POST',
        headers: bearer,
        body: JSON.stringify({ controlId: 'hammer-kill', action: 'hammer', args: { closeNow: 1 } }),
      });
    } catch {
      // the process dies under the request when the checkpoint fires
    }
    const waited = { exited: true };
    await Promise.race([
      stack.serverExited(),
      sleep(60_000).then(() => {
        waited.exited = false;
      }),
    ]);
    const exitedAtCheckpoint = waited.exited;
    note('server exited', `at checkpoint: ${exitedAtCheckpoint}`);
    for (const c of clients) c.close();

    const readTruth = async (): Promise<Record<string, TruthRow>> => {
      const out: Record<string, TruthRow> = {};
      if (sandbox) {
        const gateway = sandboxGateway(opts.env);
        for (const e of enrolled.values()) {
          const t = await gateway.getHoldTruth({
            holdId: e.holdId,
            authId: e.authId,
            orderId: e.orderId,
          });
          out[e.bidderId] = {
            status: t.status,
            capturedCents: t.capturedCents,
            captureCount: t.captures === null ? null : t.captures.length,
          };
        }
        return out;
      }
      const ids = [...enrolled.values()].map((e) => e.authId).join(',');
      const snap = await json<{
        authorizations: Array<{
          id: string;
          capturedCents: number;
          captureCount: number;
          voided: boolean;
        }>;
      }>(await fetch(`${stack.fakeControlUrl ?? ''}/__e2e/snapshot?auth=${ids}`));
      for (const e of enrolled.values()) {
        const a = snap.authorizations.find((x) => x.id === e.authId);
        out[e.bidderId] = {
          status: (a?.captureCount ?? 0) > 0 ? 'CAPTURED' : a?.voided ? 'VOIDED' : 'CREATED',
          capturedCents: a?.capturedCents ?? 0,
          captureCount: a?.captureCount ?? 0,
        };
      }
      return out;
    };

    if (sandbox && exitedAtCheckpoint) {
      const atKill = await readTruth();
      note(
        'PayPal read after the kill, before the restart',
        Object.values(atKill)
          .map((t) => `${t.status}/${t.capturedCents}/${t.captureCount ?? '?'}`)
          .join(' '),
      );
    }

    await stack.restartServer();
    const pidAfter = stack.serverPid();
    note('server restarted on the same data folder', `pid ${pidAfter ?? 'unknown'}`);

    const readJournal = async (): Promise<JournalView | null> => {
      const res = await fetch(
        `${stack.serverUrl}/admin/export?kind=payments&auction=${encodeURIComponent(auctionId)}`,
        { headers: { 'x-admin-key': stack.adminKey } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        journal: {
          state?: string;
          winner?: { bidderId: string; amountCents: number } | null;
          holds?: Record<string, unknown>;
        } | null;
      };
      const j = body.journal;
      if (j === null || j === undefined) return null;
      return {
        state: String(j.state ?? 'unknown'),
        winner: j.winner ?? null,
        holdBidders: Object.keys(j.holds ?? {}),
      };
    };

    let journal = await readJournal();
    const until = Date.now() + (sandbox ? 240_000 : 90_000);
    while ((journal?.state ?? '') !== 'SETTLED' && Date.now() < until) {
      await sleep(1_000);
      journal = await readJournal();
    }
    const secondsHammerToSettled =
      journal?.state === 'SETTLED' ? Math.round((Date.now() - tHammer) / 100) / 10 : null;
    note('journal read after restart', `state ${journal?.state ?? 'missing'}`);

    const truth = await readTruth();
    note('PayPal read at the end');
    const exp = await fetch(
      `${stack.serverUrl}/admin/export?auction=${encodeURIComponent(auctionId)}`,
      { headers: { 'x-admin-key': stack.adminKey } },
    );
    const parsed = exp.ok ? parseNdjson(await exp.text()) : null;
    const entries = parsed?.entries ?? [];
    const lotRow = evolveAll(entries).lots[auctionId as AuctionId];
    note('ledger exported', `${entries.length} entries`);

    const input: KillRunInput = {
      mode: opts.mode,
      checkpoint: CHECKPOINT,
      pidBefore,
      pidAfter,
      exitedAtCheckpoint,
      journal,
      truth,
      ledger: { entries, head: parsed?.head ?? null },
      lot:
        lotRow === undefined
          ? undefined
          : {
              winnerId: lotRow.winnerId ?? null,
              priceCents: lotRow.priceCents ?? null,
              capturedCents: lotRow.capturedCents ?? 0,
            },
    };
    const checks = evaluateKillRun(input);
    const evidence = buildKillEvidence(input, checks, {
      runUrl: opts.runUrl ?? '',
      startedAt,
      secondsHammerToSettled,
      steps,
    });
    mkdirSync(opts.outDir, { recursive: true });
    const text = `${JSON.stringify(evidence, null, 2)}\n`;
    writeFileSync(join(opts.outDir, 'server-kill-evidence.json'), text);
    writeFileSync(join(opts.outDir, 'server-kill-evidence.md'), killMarkdown(evidence));
    writeFileSync(
      join(opts.outDir, 'server-kill-evidence.sha256'),
      `${createHash('sha256').update(text).digest('hex')}  server-kill-evidence.json\n`,
    );
    const transcript = [...steps.map((s) => JSON.stringify(s)), ...(session?.lines ?? [])].join(
      '\n',
    );
    writeFileSync(join(opts.outDir, 'server-kill-transcript.jsonl'), `${transcript}\n`);
    return { verdict: killVerdict(checks), evidence };
  } finally {
    for (const c of clients) c.close();
    await stack.stop();
  }
}
