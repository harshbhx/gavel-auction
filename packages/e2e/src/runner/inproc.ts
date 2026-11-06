import { readFileSync } from 'node:fs';
import { evolveAll } from '@gavel/engine';
import { DEFAULT_FAKE_WEBHOOK_ID } from '@gavel/payments/fake';
import type { PaymentsGateway } from '@gavel/payments';
import type { AuctionConfig, ConnId } from '@gavel/shared';
import type { AuctionService, Connection } from '@gavel/server';
import { checkpointBoundary } from '@gavel/server/src/boot/checkpoint-kill';
import { parseUtterance } from '@gavel/voice';
import type { FakeWebhookEvent } from '../../../payments/src/fake/core';
import { WebhookEmitter } from '../../../payments/src/fake/webhooks';
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
  invariants: Record<Invariant, boolean>;
  /** Captures the fake committed, and how many distinct request ids the capture calls carried. */
  captures: { committed: number; requestIds: number };
  /** Simulated process deaths (server.kill) and restarts (restart step) during the run. */
  crashes: number;
  restarts: number;
  /** Bidders that received a state message after the last restart. */
  resynced: number;
  webhooks: { delivered: number; duplicates: number; failed: number };
  voice: {
    bids: number[];
    confirms: number;
    candidates: number;
    audit: Array<{ transcript: string; confidenceBps: number }>;
  };
  ledgerTypes: string[];
  /** Waits the payment transport asked for between retries, in ms, in order. */
  backoffMs: number[];
  /** End time after each accepted bid, and how often the soft close moved it. */
  endTsAfter: number[];
  softClose: { extensions: number; shortened: boolean };
  /** Last settlement state of the auction and of each bidder, by actor name. */
  settlement: { auction: string; bidders: Record<string, string> } | null;
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
const FINAL_STATES: ReadonlySet<string> = new Set(['SETTLED', 'FAILED_NEEDS_REVIEW']);
const AUDIO_DIR = new URL('../../fixtures/audio/', import.meta.url);

interface SttFixture {
  transcript: string;
  confidence: number;
  words: Array<{ word: string; startMs: number; endMs: number; confidence: number }>;
}

/** The recorded speech-to-text result of an audio fixture; no provider is ever called. */
function readStt(audio: string): SttFixture {
  if (!/^[a-z0-9-]+$/.test(audio)) throw new Error(`audio fixture name "${audio}" is not valid`);
  return JSON.parse(readFileSync(new URL(`${audio}.stt.json`, AUDIO_DIR), 'utf8')) as SttFixture;
}

interface ExpectedFixture {
  amounts: number[];
  needsConfirm: boolean;
}

/** The recorded expectation of an audio fixture: its amount, any alternatives, and the confirm flag. */
function readExpected(audio: string): ExpectedFixture | undefined {
  const raw = JSON.parse(readFileSync(new URL(`${audio}.json`, AUDIO_DIR), 'utf8')) as {
    expected?: { amountCents?: number; candidates?: number[]; needsConfirm?: boolean };
  };
  const e = raw.expected;
  if (e === undefined) return undefined;
  const amounts = [
    ...(e.amountCents === undefined ? [] : [e.amountCents]),
    ...(e.candidates ?? []),
  ];
  return { amounts: [...new Set(amounts)], needsConfirm: e.needsConfirm === true };
}

/** Wraps the gateway so every capture request id is on record, across restarts. */
function recordCaptures(inner: PaymentsGateway, ids: string[]): PaymentsGateway {
  return {
    createOrder: (i) => inner.createOrder(i),
    getOrder: (id) => inner.getOrder(id),
    authorizeOrder: (id, requestId) => inner.authorizeOrder(id, requestId),
    getHoldTruth: (h) => inner.getHoldTruth(h),
    capture: (authId, i) => {
      ids.push(i.requestId);
      return inner.capture(authId, i);
    },
    voidAuthorization: (authId, requestId) => inner.voidAuthorization(authId, requestId),
    reauthorize: (authId, i) => inner.reauthorize(authId, i),
  };
}

interface WebhookRule {
  kind: 'duplicate' | 'delay' | 'reorder';
  event: string;
  times: number;
  ms: number;
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
  const captureIds: string[] = [];
  const gateway = recordCaptures(rig.gateway, captureIds);
  let boundaryHook: ((label: string) => Promise<void>) | undefined;
  let crashes = 0;
  let restarts = 0;
  let resynced = 0;
  const startService = (): AuctionService =>
    rig.service({
      gateway,
      onError: () => undefined,
      boundary: async (label) => {
        await boundaryHook?.(label);
      },
    });
  let service = startService();
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
  let room = await service.createAuction(auctionId, config, 'auctioneer-sub');
  const bidders = new Map<string, Bidder>();
  const dropped: Pending[] = [];
  let boss: { conn: Connection } | undefined;
  const ceilings = new Map<string, number>();
  const webhookRules: WebhookRule[] = [];
  const webhooks = { delivered: 0, duplicates: 0, failed: 0 };
  const voice = { confirms: 0, candidates: 0 };
  const insertIfAbsent = rig.stores.webhookEvents.insertIfAbsent.bind(rig.stores.webhookEvents);
  rig.stores.webhookEvents.insertIfAbsent = async (e) => {
    const isNew = await insertIfAbsent(e);
    if (!isNew) webhooks.duplicates += 1;
    return isNew;
  };

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
  if (crashes > restarts) await restart(true);
  // A settlement still waiting after the clock was moved is run again, as the retry timer would.
  if (steps.some((s) => s.do === 'advance_clock')) {
    const waiting = await lastSettlement();
    if (waiting !== undefined && !FINAL_STATES.has(waiting.auctionState)) {
      await service.resume();
      await service.idle();
    }
  }
  await deliverWebhooks();

  async function lastSettlement() {
    const events = await rig.stores.store.readEvents(auctionId, 1, 100_000);
    return events.flatMap((e) => (e.type === 'settlement_update' ? [e] : [])).at(-1);
  }

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
      case 'open':
        boss ??= await connect(rig, room, 'auctioneer');
        return;
      case 'hammer':
        try {
          await control(step.t, 'hammer', { closeNow: 1 });
        } catch (e) {
          if (crashes === restarts) throw e;
        }
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
      case 'restart':
        await restart(false);
        return;
      case 'say':
        await say(step.actor, step.audio);
        return;
      case 'confirm': {
        const who = need(step.actor);
        const ask = who.transport.messages('confirm_request').at(-1);
        const confirmId = ask?.['confirmId'];
        if (typeof confirmId !== 'string') {
          throw new Error(`${scenario.id}: ${step.actor} has no confirm request to answer`);
        }
        await room.respondConfirm(who.conn, {
          v: 1,
          t: 'confirm_response',
          confirmId,
          accept: step.accept,
        });
        return;
      }
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

  /** A new service on the same stores, as after a process restart; a crash is not closed. */
  async function restart(crashed: boolean): Promise<void> {
    if (!crashed) await service.close();
    boundaryHook = undefined;
    restarts += 1;
    service = startService();
    room = await service.room(auctionId);
    if (crashed) {
      await service.resume();
      await service.idle();
      return;
    }
    boss = undefined;
    resynced = 0;
    for (const actor of bidders.keys()) {
      await reattach(actor);
      if (need(actor).transport.messages('state').length > 0) resynced += 1;
    }
  }

  /** Turns a recorded transcript into a voice bid, the way the voice pipeline does. */
  async function say(actor: string, audio: string): Promise<void> {
    const who = need(actor);
    const stt = readStt(audio);
    const parsed = parseUtterance(stt.transcript, {
      sttWordConfidence: stt.words.map((w) => ({
        word: w.word,
        start: w.startMs,
        end: w.endMs,
        confidence: w.confidence,
      })),
    });
    const spoken = [
      ...(parsed.amountCents === null ? [] : [Number(parsed.amountCents)]),
      ...parsed.candidates.map((c) => Number(c.amountCents)),
    ];
    // When the rule parser reads no amount, the fixture's recorded expectation stands in for it.
    const expected = spoken.length === 0 ? readExpected(audio) : undefined;
    const amounts = expected === undefined ? spoken : expected.amounts;
    if (amounts.length === 0) return;
    const amount = Math.max(...amounts);
    const ambiguous = expected === undefined ? parsed.status === 'confirm' : expected.needsConfirm;
    const candidateCount =
      expected === undefined ? parsed.candidates.length : expected.amounts.length;
    if (ambiguous) voice.candidates = Math.max(voice.candidates, candidateCount);
    await room.submitBid(
      who.conn,
      bidMessage(rig, amount, 'voice', {
        confidence: stt.confidence,
        transcript: stt.transcript,
        ...(ambiguous ? { ambiguous: true } : {}),
      }),
    );
    await service.idle();
  }

  /**
   * Delivers the fake's outbox to the service once the settlement has run, shaped by the
   * scenario's webhook faults: duplicates are extra copies, reorder puts the named event type
   * first and the rest in reverse, delay holds the named type back until `ms` later.
   */
  async function deliverWebhooks(): Promise<void> {
    if (webhookRules.length === 0) return;
    const emitter = new WebhookEmitter({
      webhookId: DEFAULT_FAKE_WEBHOOK_ID,
      nowMs: () => rig.clock.now(),
    });
    const events = [...rig.paypal.core.events];
    const named = (rule: WebhookRule, e: FakeWebhookEvent): boolean => e.eventType === rule.event;
    const delayRule = webhookRules.find((r) => r.kind === 'delay');
    const reorderRule = webhookRules.find((r) => r.kind === 'reorder');
    const held = delayRule === undefined ? [] : events.filter((e) => named(delayRule, e));
    let first = events.filter((e) => !held.includes(e));
    if (reorderRule !== undefined) {
      first = [
        ...first.filter((e) => named(reorderRule, e)),
        ...first.filter((e) => !named(reorderRule, e)).reverse(),
      ];
    }
    const deliver = async (e: FakeWebhookEvent): Promise<void> => {
      const signed = emitter.sign(e);
      const res = await service.handleWebhook(Buffer.from(signed.rawBody), signed.headers);
      webhooks.delivered += 1;
      if (res.status !== 200) webhooks.failed += 1;
    };
    emit('step', 0, { do: 'webhooks', events: events.length });
    for (const e of first) {
      const dup = webhookRules.find((r) => r.kind === 'duplicate' && named(r, e));
      const copies = dup?.times ?? 1;
      const gap = dup === undefined ? 0 : Math.floor(dup.ms / copies);
      for (let n = 0; n < copies; n += 1) {
        await deliver(e);
        if (gap > 0) rig.clock.advance(gap);
      }
    }
    if (delayRule !== undefined) rig.clock.advance(delayRule.ms);
    for (const e of held) await deliver(e);
    await service.idle();
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
    } else if (fault.at === 'server') {
      boundaryHook = checkpointBoundary(fault.checkpoint, () => {
        crashes += 1;
        throw new Error('process died');
      });
    } else if (fault.at === 'webhook') {
      webhookRules.push({
        kind: fault.kind,
        event: fault.event,
        times: fault.times ?? 1,
        ms: fault.ms ?? 0,
      });
    } else {
      throw new Error(
        `${scenario.id}: fault ${fault.at}.${fault.kind} is not supported in process`,
      );
    }
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
  const roomEvents = await rig.stores.store.readEvents(auctionId, 1, 100_000);
  const endTsAfter = roomEvents.flatMap((e) =>
    e.type === 'bid_accepted' ? [Number(e.endTsAfter)] : [],
  );
  const ends = [config.endTs as number, ...endTsAfter];
  const lastUpdate = await lastSettlement();
  const voiceBids = entries.flatMap((e) =>
    e.type === 'BID_RECORDED' && e.payload.source === 'voice' ? [e.payload] : [],
  );
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
    invariants: evaluateInvariants({ winner, holds, entries, fakeOk }),
    captures: {
      committed: holds.reduce((n, h) => n + h.captureCount, 0),
      requestIds: new Set(captureIds).size,
    },
    crashes,
    restarts,
    resynced,
    webhooks: { ...webhooks },
    voice: {
      bids: voiceBids.map((p) => Number(p.amountCents)),
      confirms: [...bidders.values()].reduce(
        (n, b) => n + b.transport.messages('confirm_request').length,
        0,
      ),
      candidates: voice.candidates,
      audit: voiceBids.flatMap((p) =>
        p.audit.transcript === undefined || p.audit.confidenceBps === undefined
          ? []
          : [{ transcript: p.audit.transcript, confidenceBps: p.audit.confidenceBps }],
      ),
    },
    ledgerTypes: entries.map((e) => e.type),
    backoffMs: [...rig.sleeps],
    endTsAfter,
    softClose: {
      extensions: ends.filter((v, i) => i > 0 && v > (ends[i - 1] as number)).length,
      shortened: ends.some((v, i) => i > 0 && v < (ends[i - 1] as number)),
    },
    settlement:
      lastUpdate === undefined
        ? null
        : {
            auction: lastUpdate.auctionState,
            bidders: Object.fromEntries(
              Object.entries(lastUpdate.perBidder).map(([id, state]) => [
                byId.get(id) ?? id,
                state,
              ]),
            ),
          },
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
  if (outcome.webhooks.failed > 0) {
    failures.push(`${outcome.webhooks.failed} webhook deliveries were not answered 200`);
  }
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
    } else if ('bids' in exp) {
      const want = exp.bids;
      diff('bids', want, {
        accepted: outcome.accepted,
        ...(want.price === undefined ? {} : { price: outcome.priceCents }),
        ...(want.resynced === undefined ? {} : { resynced: outcome.resynced }),
      });
    } else if ('webhooks' in exp) {
      diff('webhooks', exp.webhooks, { duplicates: outcome.webhooks.duplicates });
    } else if ('settlement' in exp) {
      const got = outcome.settlement;
      diff(
        'settlement',
        exp.settlement,
        Object.fromEntries(
          Object.keys(exp.settlement).map((k) => [
            k,
            k === 'auction' ? got?.auction : got?.bidders[k],
          ]),
        ),
      );
    } else if ('captures' in exp) {
      diff('captures', exp.captures, outcome.captures);
    } else if ('voice' in exp) {
      const want = exp.voice;
      diff('voice', want, {
        bids: outcome.voice.bids,
        confirms: outcome.voice.confirms,
        ...(want.candidates === undefined ? {} : { candidates: outcome.voice.candidates }),
        ...(want.audit === undefined ? {} : { audit: outcome.voice.audit }),
      });
    } else {
      failures.push(`expect kind "${Object.keys(exp).join(',')}" is not supported in process`);
    }
  }
  return failures;
}
