import { readFileSync } from 'node:fs';
import { evolveAll } from '@gavel/engine';
import { DEFAULT_FAKE_WEBHOOK_ID } from '@gavel/payments/fake';
import type { AuctionConfig, ConnId } from '@gavel/shared';
import type { Connection } from '@gavel/server';
import type { Fault, Invariant, Scenario, Step } from '../dsl/types';
import {
  CONFIG,
  bidMessage,
  connect,
  enroll,
  ledgerKey,
  makeRig,
  type Bidder,
  type Rig,
} from '../../test/flow/rig';
// The fake entry point does not re-export the emitter, and the package exports map hides src.
import { WebhookEmitter } from '../../../payments/src/fake/webhooks';
import { evaluateInvariants, type HoldView } from './invariants';

/**
 * Runs one scenario in this process against the real engine, room, settlement saga and the fake
 * PayPal server, on a manual clock that starts at the scenario's `clock.startMs`. No browser and
 * no real sleeping, so a scenario finishes well under two seconds. A step or fault this runner
 * cannot drive throws; it is never skipped.
 */

export interface TraceEvent {
  n: number;
  t: number;
  kind: 'start' | 'step' | 'fault' | 'result';
  data: Record<string, unknown>;
}

export interface Outcome {
  winner: string | null;
  priceCents: number | null;
  capturedCents: number;
  releasedCents: number;
  voided: string[];
  accepted: number;
  rejected: Array<{ actor: string; code: string }>;
  paypalCalls: { capture: number; void: number; reauthorize: number };
  /** Webhook deliveries made by webhook faults: sent, answered 200, and distinct events stored. */
  webhooks: { delivered: number; ok: number; stored: number };
  invariants: Record<Invariant, boolean>;
}

export interface RunResult {
  scenarioId: string;
  seed: number;
  outcome: Outcome;
  failures: string[];
  trace: TraceEvent[];
}

export interface RunOptions {
  /** Overrides the scenario seed; it is recorded in the trace header. */
  seed?: number;
}

const EXTEND_MS = 30_000;
const AUDIO_DIR = new URL('../../fixtures/audio/', import.meta.url);

type WebhookFault = Extract<Fault, { at: 'webhook' }>;

interface AudioFixture {
  amountCents: number;
  transcript: string;
  confidence: number;
}

/** Reads the recorded label and the stubbed STT answer for one fixture; no provider is called. */
function loadAudio(id: string): AudioFixture {
  const read = (file: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(file, AUDIO_DIR), 'utf8')) as Record<string, unknown>;
  const label = read(`${id}.json`);
  const stt = read(`${id}.stt.json`);
  const expected = label['expected'] as Record<string, unknown> | undefined;
  const amount = expected?.['amountCents'];
  if (typeof amount !== 'number') throw new Error(`audio ${id} has no expected amount`);
  return {
    amountCents: amount,
    transcript: String(stt['transcript']),
    confidence: Number(stt['confidence']),
  };
}

export function toNdjson(trace: readonly TraceEvent[]): string {
  return trace.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

interface Pending {
  at: number;
  actor: string;
}

export async function runScenarioInProc(
  scenario: Scenario,
  opts: RunOptions = {},
): Promise<RunResult> {
  const seed = opts.seed ?? scenario.seed;
  const trace: TraceEvent[] = [];
  const emit = (kind: TraceEvent['kind'], t: number, data: Record<string, unknown>): void => {
    trace.push({ n: trace.length, t, kind, data });
  };
  const rig = await makeRig();
  try {
    return await drive(scenario, seed, rig, trace, emit);
  } finally {
    await rig.paypal.stop();
  }
}

async function drive(
  scenario: Scenario,
  seed: number,
  rig: Rig,
  trace: TraceEvent[],
  emit: (kind: TraceEvent['kind'], t: number, data: Record<string, unknown>) => void,
): Promise<RunResult> {
  const startMs = scenario.clock.startMs;
  rig.clock.set(startMs);
  emit('start', 0, { id: scenario.id, seed, startMs });
  const service = rig.service();
  const auctionId = rig.ids.mint<'AuctionId'>();
  const presets = [
    ...new Set(scenario.steps.flatMap((s) => (s.do === 'register' ? [s.ceiling] : []))),
  ].sort((a, b) => a - b);
  const config = {
    ...CONFIG,
    ceilingPresets: presets,
    reserve: scenario.auction.reserve,
    minIncrement: scenario.auction.minIncrement,
    endTs: startMs + 600_000,
    ...(scenario.auction.softCloseMs > 0
      ? { softCloseWindowMs: scenario.auction.softCloseMs }
      : {}),
  } as unknown as AuctionConfig;
  const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
  const bidders = new Map<string, Bidder>();
  const dropped: Pending[] = [];
  let boss: { conn: Connection } | undefined;
  const ceilings = new Map<string, number>();
  const webhookFaults: WebhookFault[] = [];
  const answered = new Set<string>();

  const need = (actor: string): Bidder => {
    const b = bidders.get(actor);
    if (b === undefined) throw new Error(`${scenario.id}: ${actor} acts before registering`);
    return b;
  };
  const reattach = async (actor: string): Promise<void> => {
    const b = need(actor);
    const next = await connect(rig, room, 'bidder', b.id);
    b.conn = next.conn;
    b.transport = next.transport;
  };
  const control = async (
    t: number,
    action: string,
    args?: Record<string, number>,
  ): Promise<void> => {
    boss ??= await connect(rig, room, 'auctioneer');
    await room.control(boss.conn, {
      controlId: `${action}-${t}`,
      action,
      ...(args === undefined ? {} : { args }),
    } as never);
  };
  const flushDrops = async (upTo: number): Promise<void> => {
    dropped.sort((a, b) => a.at - b.at);
    while (dropped.length > 0 && (dropped[0] as Pending).at <= upTo) {
      const p = dropped.shift() as Pending;
      rig.clock.set(startMs + p.at);
      await reattach(p.actor);
      emit('step', p.at, { do: 'ws_restore', actor: p.actor });
    }
  };

  const steps = [...scenario.steps].sort((a, b) => a.t - b.t);
  for (const step of steps) {
    await flushDrops(step.t);
    rig.clock.set(startMs + step.t);
    emit('step', step.t, { ...step });
    await runStep(step);
  }
  await flushDrops(Number.MAX_SAFE_INTEGER);
  await service.idle();
  const hooks = await deliverWebhooks();
  await service.idle();

  async function runStep(step: Step): Promise<void> {
    switch (step.do) {
      case 'register': {
        ceilings.set(step.actor, step.ceiling);
        bidders.set(
          step.actor,
          await enroll(rig, service, room, auctionId, step.actor, step.ceiling, presets),
        );
        return;
      }
      case 'bid': {
        const who = need(step.actor);
        const msg =
          step.via === 'voice'
            ? bidMessage(rig, step.amount, 'voice', { confidence: 0.99, transcript: '' })
            : bidMessage(rig, step.amount, 'manual');
        await room.submitBid(who.conn, msg);
        return;
      }
      case 'say': {
        const audio = loadAudio(step.audio);
        await room.submitBid(
          need(step.actor).conn,
          bidMessage(rig, audio.amountCents, 'voice', {
            confidence: audio.confidence,
            transcript: audio.transcript,
          }),
        );
        return;
      }
      case 'confirm': {
        const who = need(step.actor);
        const asked = who.transport
          .messages('confirm_request')
          .map((m) => String(m['confirmId']))
          .filter((id) => !answered.has(id));
        const confirmId = asked.at(-1);
        if (confirmId === undefined) {
          throw new Error(`${scenario.id}: ${step.actor} has no confirm request to answer`);
        }
        answered.add(confirmId);
        await room.respondConfirm(who.conn, {
          v: 1,
          t: 'confirm_response',
          mid: rig.ids.mint<'MsgId'>(),
          confirmId,
          accept: step.accept,
        } as never);
        return;
      }
      case 'open':
        boss ??= await connect(rig, room, 'auctioneer');
        return;
      case 'hammer':
        await control(step.t, 'hammer', { closeNow: 1 });
        return;
      case 'pause':
      case 'resume':
        await control(step.t, step.do);
        return;
      case 'extend':
        await control(step.t, 'extend', { extraMs: EXTEND_MS });
        return;
      case 'disconnect':
        room.detach(need(step.actor).conn.id as ConnId);
        return;
      case 'reconnect':
        await reattach(step.actor);
        return;
      case 'advance_clock':
        rig.clock.set(rig.clock.now() + step.ms);
        return;
      case 'fault':
        await applyFault(step.fault, step.t);
        return;
      default:
        throw new Error(
          `${scenario.id}: step "${(step as { do: string }).do}" is not supported by the in-process runner`,
        );
    }
  }

  async function applyFault(fault: Fault, t: number): Promise<void> {
    emit('fault', t, { ...fault });
    const { faults, core } = rig.paypal;
    if (fault.at === 'paypal.capture' && fault.kind === 'http') {
      faults.add({
        kind: fault.status === 429 ? 'http_429' : 'http_500',
        op: 'capture',
        times: fault.times,
      });
    } else if (fault.at === 'paypal.capture') {
      faults.add({ kind: 'timeout_after_success', op: 'capture', times: 1 });
    } else if (fault.at === 'paypal.void') {
      const authId = fault.bidder === undefined ? null : need(fault.bidder).authId;
      faults.add({ kind: 'http_500', op: 'void', authId, times: fault.times });
    } else if (fault.at === 'paypal.authorization') {
      const authId = need(fault.bidder).authId;
      if (fault.kind === 'decline') faults.add({ kind: 'capture_declined', op: 'capture', authId });
      else if (fault.kind === 'void_external') core.void(authId);
      else core.clock.advance(core.validityMs + 1);
    } else if (fault.at === 'ws') {
      room.detach(need(fault.client).conn.id as ConnId);
      dropped.push({ at: t + fault.forMs, actor: fault.client });
    } else if (fault.at === 'webhook') {
      // Deliveries happen once the room has settled, from the fake's webhook outbox.
      webhookFaults.push(fault);
    } else if (fault.at === 'server') {
      throw new Error(`${scenario.id}: server.kill needs the stack runner`);
    } else {
      throw new Error(
        `${scenario.id}: fault ${fault.at}.${fault.kind} is not supported in process`,
      );
    }
  }

  /**
   * Sends the fake's outbox to the service's webhook entry. duplicate: every event of type
   * `event`, `times` deliveries in all (default 2). reorder: the whole outbox, newest first.
   * delay: the whole outbox in order, `ms` recorded in the trace (the clock is manual).
   */
  async function deliverWebhooks(): Promise<Outcome['webhooks']> {
    const emitter = new WebhookEmitter({
      webhookId: DEFAULT_FAKE_WEBHOOK_ID,
      nowMs: () => rig.paypal.core.clock.nowMs(),
    });
    let delivered = 0;
    let ok = 0;
    for (const fault of webhookFaults) {
      const outbox = [...rig.paypal.core.events];
      const matching = outbox.filter((e) => e.eventType === fault.event);
      if (matching.length === 0) {
        throw new Error(`${scenario.id}: no ${fault.event} event to deliver`);
      }
      const planned =
        fault.kind === 'duplicate'
          ? matching.flatMap((e) => Array.from({ length: fault.times ?? 2 }, () => e))
          : fault.kind === 'reorder'
            ? outbox.reverse()
            : outbox;
      emit('fault', 0, { ...fault, deliveries: planned.length });
      for (const event of planned) {
        const signed = emitter.sign(event);
        const headers = Object.fromEntries(
          Object.entries(signed.headers).map(([k, v]) => [k.toLowerCase(), v]),
        );
        const { status } = await service.handleWebhook(Buffer.from(signed.rawBody), headers);
        delivered += 1;
        if (status === 200) ok += 1;
      }
    }
    const stored = Object.keys(rig.stores.webhookEvents.snapshot().events).length;
    return { delivered, ok, stored };
  }

  const entries = await rig.stores.ledger.read(ledgerKey(auctionId), 1);
  const lot = evolveAll(entries).lots[auctionId];
  const byId = new Map([...bidders].map(([name, b]) => [b.id as string, name]));
  const winner = lot?.winnerId == null ? null : (byId.get(lot.winnerId) ?? null);
  const { core } = rig.paypal;

  const holds: HoldView[] = [...bidders].map(([actor, b]) => {
    const a = core.getAuthorization(b.authId);
    return {
      actor,
      holdCents: a.holdCents,
      ceilingCents: ceilings.get(actor) ?? a.holdCents,
      capturedCents: a.capturedCents,
      releasedCents: core.released(b.authId),
      captureCount: a.captures.length,
      voided: a.status === 'VOIDED',
    };
  });
  let fakeOk = true;
  try {
    core.checkInvariants();
  } catch {
    fakeOk = false;
  }
  const count = (op: string): number => core.calls.filter((c) => c.op === op).length;
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
    rejected: [...bidders].flatMap(([actor, b]) =>
      b.transport.messages('bid_rejected').map((m) => ({ actor, code: String(m['reason']) })),
    ),
    paypalCalls: {
      capture: count('capture'),
      void: count('void'),
      reauthorize: count('reauthorize'),
    },
    webhooks: hooks,
    invariants: evaluateInvariants({ winner, holds, entries, fakeOk }),
  };
  await service.close();
  emit('result', 0, { ...outcome });
  return {
    scenarioId: scenario.id,
    seed,
    outcome,
    failures: checkExpectations(scenario, outcome),
    trace,
  };
}

/** One line per mismatch, as "expected" and "got" so a diff reads at a glance. */
export function checkExpectations(scenario: Scenario, outcome: Outcome): string[] {
  const failures: string[] = [];
  const diff = (what: string, want: unknown, got: unknown): void => {
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      failures.push(`${what}\n- ${JSON.stringify(want)}\n+ ${JSON.stringify(got)}`);
    }
  };
  for (const exp of scenario.expect) {
    if ('ledger' in exp) {
      diff('ledger', exp.ledger, {
        winner: outcome.winner,
        captured: outcome.capturedCents,
        released: outcome.releasedCents,
        voided: outcome.voided,
      });
    } else if ('invariants' in exp) {
      for (const id of exp.invariants) {
        if (!outcome.invariants[id]) failures.push(`invariant ${id} does not hold`);
      }
    } else if ('rejected' in exp) {
      diff(
        'rejected',
        exp.rejected,
        outcome.rejected.map((r) => ({ actor: r.actor, code: r.code })),
      );
    } else if ('paypalCalls' in exp) {
      const want = exp.paypalCalls;
      diff('paypalCalls', want, {
        capture: outcome.paypalCalls.capture,
        void: outcome.paypalCalls.void,
        ...(want.reauthorize === undefined ? {} : { reauthorize: outcome.paypalCalls.reauthorize }),
      });
    } else {
      failures.push(`expect kind "${Object.keys(exp).join(',')}" is not supported in process`);
    }
  }
  return failures;
}
