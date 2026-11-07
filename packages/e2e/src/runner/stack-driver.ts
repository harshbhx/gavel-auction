import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evolveAll } from '@gavel/engine';
import { parseNdjson } from '@gavel/server/src/admin/export';
import { SystemClock, type AuctionId } from '@gavel/shared';
import type { Checkpoint, Scenario, Step } from '../dsl/types';
import { checkExpectations, type Outcome, type RunResult, type TraceEvent } from './inproc';
import { evaluateInvariants, type HoldView } from './invariants';
import { startStack, type Stack } from './stack';

/**
 * Drives a scenario against the real server over HTTP and WebSocket (stack mode). The server and
 * the fake PayPal are separate processes; a kill at a checkpoint takes the server down and leaves
 * the fake alone, and the restart resumes the settlement from the file store. Time is real:
 * the step times order the steps but nothing waits for them. A step or fault this driver cannot
 * run throws; it is never skipped.
 */

const SERVER_DIR = fileURLToPath(new URL('../../../server', import.meta.url));
const clock = new SystemClock();
const now = (): number => clock.now();
const REAL_TIMEOUT_MS = 60_000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EXTEND_MS = 30_000;

/** A ULID: the wire protocol takes only that for message ids. */
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

interface Sock {
  readyState: number;
  on(event: string, cb: (...args: unknown[]) => void): void;
  send(text: string): void;
  close(): void;
}
type SockCtor = new (url: string, opts: { headers: Record<string, string> }) => Sock;

type Frame = Record<string, unknown>;

class Client {
  readonly frames: Frame[] = [];
  private sock: Sock | undefined;

  constructor(
    private readonly make: SockCtor,
    private readonly url: string,
    private readonly origin: string,
    private readonly auctionId: string,
    private readonly token: string,
  ) {}

  /** Opens the socket, sends the join and resolves once the state frame has arrived. */
  async open(): Promise<void> {
    this.frames.length = 0;
    const sock = new this.make(this.url, { headers: { origin: this.origin } });
    this.sock = sock;
    sock.on('message', (data) => {
      try {
        this.frames.push(JSON.parse(String(data)) as Frame);
      } catch {
        // not JSON: ignore
      }
    });
    await new Promise<void>((resolve, reject) => {
      sock.on('open', () => resolve());
      sock.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
    });
    sock.send(JSON.stringify({ v: 1, t: 'join', token: this.token, auctionId: this.auctionId }));
    await this.waitFor((f) => f['t'] === 'state', 'a state frame');
  }

  close(): void {
    this.sock?.close();
    this.sock = undefined;
  }

  send(frame: Frame): void {
    if (this.sock === undefined || this.sock.readyState !== 1) {
      throw new Error('socket is not open');
    }
    this.sock.send(JSON.stringify(frame));
  }

  async waitFor(match: (f: Frame) => boolean, what: string, ms = 15_000): Promise<Frame> {
    const until = now() + ms;
    while (now() < until) {
      const hit = this.frames.find(match);
      if (hit !== undefined) return hit;
      await sleep(25);
    }
    throw new Error(`timed out waiting for ${what}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface FakeSnapshot {
  authorizations: Array<{
    id: string;
    status: string;
    holdCents: number;
    capturedCents: number;
    releasedCents: number;
    captureCount: number;
    voided: boolean;
  }>;
  captureRequestIds: string[];
  calls: { capture: number; void: number; reauthorize: number };
  invariantsOk: boolean;
}

interface Bidder {
  actor: string;
  bidderId: string;
  authId: string;
  token: string;
  ceiling: number;
  client: Client;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface StackRunOptions {
  seed?: number;
}

export async function runScenarioInStack(
  scenario: Scenario,
  opts: StackRunOptions = {},
): Promise<RunResult> {
  const checkpoint: Checkpoint | undefined = scenario.steps.flatMap((s) =>
    s.do === 'fault' && s.fault.at === 'server' ? [s.fault.checkpoint] : [],
  )[0];
  const stack = await startStack({
    externalFake: true,
    ...(checkpoint === undefined ? {} : { checkpointKill: checkpoint }),
  });
  try {
    return await drive(scenario, opts.seed ?? scenario.seed, stack, checkpoint);
  } finally {
    await stack.stop();
  }
}

async function drive(
  scenario: Scenario,
  seed: number,
  stack: Stack,
  checkpoint: Checkpoint | undefined,
): Promise<RunResult> {
  const trace: TraceEvent[] = [];
  const emit = (kind: TraceEvent['kind'], t: number, data: Record<string, unknown>): void => {
    trace.push({ n: trace.length, t, kind, data });
  };
  emit('start', 0, { id: scenario.id, seed, mode: 'stack' });

  const WebSocketCtor = createRequire(join(SERVER_DIR, 'package.json'))('ws') as SockCtor;
  const origin = new URL(stack.serverUrl).origin;
  const wsUrl = `${stack.serverUrl.replace(/^http/, 'ws')}/ws`;
  const adminHeaders = { 'content-type': 'application/json', 'x-admin-key': stack.adminKey };
  const fakeControl = stack.fakeControlUrl ?? '';

  const presets = [
    ...new Set(scenario.steps.flatMap((s) => (s.do === 'register' ? [s.ceiling] : []))),
  ].sort((a, b) => a - b);
  const created = await json<{ auctionId: string; auctioneerLink: string }>(
    await fetch(`${stack.serverUrl}/api/auctions`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: scenario.id,
        config: {
          mode: 'english',
          currency: 'USD',
          reserve: scenario.auction.reserve,
          minIncrement: scenario.auction.minIncrement,
          endTs: now() + 600_000,
          softCloseWindowMs:
            scenario.auction.softCloseMs > 0 ? scenario.auction.softCloseMs : 30_000,
          softCloseExtensionMs: 30_000,
          maxExtensions: 5,
          ceilingPresets: presets,
          confirmConfidenceThreshold: 0.85,
        },
      }),
    }),
  );
  const auctionId = created.auctionId;
  const auctioneerToken = created.auctioneerLink.split('#token=')[1] ?? '';
  const bearer = (token: string): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  });

  const bidders = new Map<string, Bidder>();
  const rejected: Array<{ actor: string; code: string }> = [];
  const dropped: Array<{ at: number; actor: string }> = [];
  let hammered = false;
  let crashes = 0;
  let restarts = 0;
  let resynced = 0;

  const need = (actor: string): Bidder => {
    const b = bidders.get(actor);
    if (b === undefined) throw new Error(`${scenario.id}: ${actor} acts before registering`);
    return b;
  };

  const register = async (step: Extract<Step, { do: 'register' }>): Promise<void> => {
    const { invites } = await json<{ invites: Array<{ bidderId: string; link: string }> }>(
      await fetch(`${stack.serverUrl}/api/auctions/${auctionId}/invites`, {
        method: 'POST',
        headers: bearer(auctioneerToken),
        body: JSON.stringify({ count: 1 }),
      }),
    );
    const invite = invites[0];
    if (invite === undefined) throw new Error('the server minted no invite');
    const joined = await json<{ sessionToken: string; bidderId: string }>(
      await fetch(`${stack.serverUrl}/api/auctions/${auctionId}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invite: invite.link.split('#token=')[1] ?? '' }),
      }),
    );
    const enrolled = await json<{ holdId: string; authId: string | null }>(
      await fetch(`${stack.serverUrl}/__e2e/enrol`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          auctionId,
          bidderId: joined.bidderId,
          name: step.actor,
          ceilingCents: step.ceiling,
          presetsCents: presets,
        }),
      }),
    );
    if (enrolled.authId === null) throw new Error(`${step.actor}: the hold has no authorization`);
    const client = new Client(WebSocketCtor, wsUrl, origin, auctionId, joined.sessionToken);
    await client.open();
    bidders.set(step.actor, {
      actor: step.actor,
      bidderId: joined.bidderId,
      authId: enrolled.authId,
      token: joined.sessionToken,
      ceiling: step.ceiling,
      client,
    });
  };

  const bid = async (actor: string, amount: number): Promise<void> => {
    const who = need(actor);
    const mid = ulid();
    who.client.send({ v: 1, t: 'bid', mid, amount, source: 'manual' });
    const reply = await who.client.waitFor(
      (f) => (f['t'] === 'bid_accepted' || f['t'] === 'bid_rejected') && f['mid'] === mid,
      `the reply to a bid of ${amount} by ${actor}`,
    );
    if (reply['t'] === 'bid_rejected') rejected.push({ actor, code: String(reply['reason']) });
  };

  const control = async (
    t: number,
    action: string,
    args?: Record<string, number>,
  ): Promise<Response> =>
    fetch(`${stack.serverUrl}/api/auctions/${auctionId}/control`, {
      method: 'POST',
      headers: bearer(auctioneerToken),
      body: JSON.stringify({
        controlId: `${action}-${t}`,
        action,
        ...(args === undefined ? {} : { args }),
      }),
    });

  const reattach = async (actor: string): Promise<void> => {
    const b = need(actor);
    b.client.close();
    b.client = new Client(WebSocketCtor, wsUrl, origin, auctionId, b.token);
    await b.client.open();
  };

  const hammer = async (t: number): Promise<void> => {
    hammered = true;
    let answered: Response | undefined;
    try {
      answered = await control(t, 'hammer', { closeNow: 1 });
    } catch {
      // The server died under the request: a checkpoint kill.
    }
    if (checkpoint === undefined) {
      if (answered === undefined || !answered.ok) {
        throw new Error(`${scenario.id}: hammer failed (${answered?.status ?? 'no answer'})`);
      }
      return;
    }
    await Promise.race([
      stack.serverExited(),
      sleep(30_000).then(() => {
        throw new Error(`${scenario.id}: the server did not die at ${checkpoint}`);
      }),
    ]);
    crashes += 1;
    await stack.restartServer();
    restarts += 1;
  };

  const flushDrops = async (upTo: number): Promise<void> => {
    dropped.sort((a, b) => a.at - b.at);
    while (dropped.length > 0 && (dropped[0] as { at: number }).at <= upTo) {
      const p = dropped.shift() as { at: number; actor: string };
      await reattach(p.actor);
      emit('step', p.at, { do: 'ws_restore', actor: p.actor });
    }
  };

  const runStep = async (step: Step): Promise<void> => {
    switch (step.do) {
      case 'register':
        await register(step);
        return;
      case 'bid':
        if (step.via === 'voice')
          throw new Error(`${scenario.id}: voice bids need the voice stack`);
        await bid(step.actor, step.amount);
        return;
      case 'open':
        return;
      case 'hammer':
        await hammer(step.t);
        return;
      case 'pause':
      case 'resume': {
        const res = await control(step.t, step.do);
        if (!res.ok) throw new Error(`${step.do} answered ${res.status}`);
        return;
      }
      case 'extend': {
        const res = await control(step.t, 'extend', { extraMs: EXTEND_MS });
        if (!res.ok) throw new Error(`extend answered ${res.status}`);
        return;
      }
      case 'disconnect':
        need(step.actor).client.close();
        return;
      case 'reconnect':
        await reattach(step.actor);
        return;
      case 'restart': {
        await stack.restartServer();
        restarts += 1;
        resynced = 0;
        for (const actor of bidders.keys()) {
          await reattach(actor);
          if (need(actor).client.frames.some((f) => f['t'] === 'state')) resynced += 1;
        }
        return;
      }
      case 'fault':
        if (step.fault.at === 'ws') {
          need(step.fault.client).client.close();
          dropped.push({ at: step.t + step.fault.forMs, actor: step.fault.client });
          emit('fault', step.t, { ...step.fault });
          return;
        }
        if (step.fault.at === 'server') {
          // Armed when the stack started, so the server dies at the hammer.
          emit('fault', step.t, { ...step.fault });
          return;
        }
        throw new Error(
          `${scenario.id}: fault ${step.fault.at}.${step.fault.kind} is not supported in stack mode`,
        );
      default:
        throw new Error(
          `${scenario.id}: step "${(step as { do: string }).do}" is not supported in stack mode`,
        );
    }
  };

  for (const step of [...scenario.steps].sort((a, b) => a.t - b.t)) {
    await flushDrops(step.t);
    emit('step', step.t, { ...step });
    await runStep(step);
  }
  await flushDrops(Number.MAX_SAFE_INTEGER);

  const authIds = (): string => [...bidders.values()].map((b) => b.authId).join(',');
  const snapshot = async (): Promise<FakeSnapshot> =>
    json<FakeSnapshot>(await fetch(`${fakeControl}/__e2e/snapshot?auth=${authIds()}`));
  const ledger = async () => {
    const res = await fetch(
      `${stack.serverUrl}/admin/export?auction=${encodeURIComponent(auctionId)}`,
      { headers: { 'x-admin-key': stack.adminKey } },
    );
    const parsed = res.ok ? parseNdjson(await res.text()) : null;
    const entries = parsed?.entries ?? [];
    return { entries, lot: evolveAll(entries).lots[auctionId as AuctionId] };
  };

  // The settlement is done when the fake shows every hold captured or voided and the ledger has
  // recorded the capture the fake committed.
  if (hammered) {
    const until = now() + REAL_TIMEOUT_MS;
    for (;;) {
      const snap = await snapshot();
      const fakeDone = snap.authorizations.every((a) => a.captureCount > 0 || a.voided);
      const fakeCaptured = snap.authorizations.reduce((n, a) => n + a.capturedCents, 0);
      if (fakeDone && fakeCaptured === ((await ledger()).lot?.capturedCents ?? 0)) break;
      if (now() > until) {
        throw new Error(`${scenario.id}: settlement did not finish: ${JSON.stringify(snap)}`);
      }
      await sleep(250);
    }
  }

  const snap = await snapshot();
  const { entries, lot } = await ledger();
  const byId = new Map([...bidders.values()].map((b) => [b.bidderId, b.actor]));
  const winner = lot?.winnerId == null ? null : (byId.get(lot.winnerId) ?? null);
  const holds: HoldView[] = [...bidders.values()].map((b) => {
    const a = snap.authorizations.find((x) => x.id === b.authId);
    return {
      actor: b.actor,
      holdCents: a?.holdCents ?? 0,
      ceilingCents: b.ceiling,
      capturedCents: a?.capturedCents ?? 0,
      releasedCents: a?.releasedCents ?? 0,
      captureCount: a?.captureCount ?? 0,
      voided: a?.voided ?? false,
    };
  });
  const outcome: Outcome = {
    winner,
    priceCents: lot?.priceCents ?? null,
    capturedCents: lot?.capturedCents ?? 0,
    releasedCents: holds.find((h) => h.actor === winner)?.releasedCents ?? 0,
    voided: holds
      .filter((h) => h.actor !== winner && h.voided)
      .map((h) => h.actor)
      .sort(),
    accepted: entries.filter((e) => e.type === 'BID_RECORDED').length,
    rejected,
    paypalCalls: { ...snap.calls },
    invariants: evaluateInvariants({ winner, holds, entries, fakeOk: snap.invariantsOk }),
    captures: {
      committed: holds.reduce((n, h) => n + h.captureCount, 0),
      requestIds: new Set(snap.captureRequestIds).size,
    },
    crashes,
    restarts,
    resynced,
    webhooks: { delivered: 0, duplicates: 0, failed: 0 },
    voice: { bids: [], confirms: 0, candidates: 0, audit: [] },
    ledgerTypes: entries.map((e) => e.type),
    backoffMs: [],
    opsStatuses: [],
    endTsAfter: [],
    softClose: { extensions: 0, shortened: false },
    settlement: null,
  };
  emit('result', 0, { ...outcome });
  for (const b of bidders.values()) b.client.close();
  return {
    scenarioId: scenario.id,
    seed,
    outcome,
    failures: checkExpectations(scenario, outcome),
    trace,
  };
}
