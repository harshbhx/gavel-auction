import { evolveAll } from '@gavel/engine';
import type { AuctionConfig } from '@gavel/shared';
import type { Invariant, Scenario } from '../../src/index';
import { CONFIG, bidMessage, connect, enroll, ledgerKey, makeRig, type Bidder } from './rig';

/**
 * Runs a scenario through the real runtime of the flow tests (room, engine, settlement saga and
 * the fake PayPal server) and reports what the engine ledger and the fake recorded. Steps the
 * runtime cannot drive here are rejected, never skipped.
 */

export interface Outcome {
  winner: string | null;
  priceCents: number | null;
  capturedCents: number;
  releasedCents: number;
  voided: string[];
  accepted: number;
  rejected: Array<{ actor: string; reason: string }>;
  invariants: Partial<Record<Invariant, boolean>>;
}

/** Length of the bidding window the runner gives every scenario, counted from clock.startMs. */
const WINDOW_MS = 600_000;

/**
 * The auction config a scenario declares: mode, reserve, increment, soft close and an end time
 * counted from its own clock.startMs, so none of these fields is silently ignored.
 * actors.*.funding and seed are not applied: the fake PayPal server has no wallet/card split and
 * the runner draws no random numbers.
 */
export function scenarioConfig(scenario: Scenario): AuctionConfig {
  const presets = [
    ...new Set(scenario.steps.flatMap((s) => (s.do === 'register' ? [s.ceiling] : []))),
  ].sort((a, b) => a - b);
  return {
    ...CONFIG,
    mode: scenario.auction.mode,
    ceilingPresets: presets,
    reserve: scenario.auction.reserve,
    minIncrement: scenario.auction.minIncrement,
    softCloseWindowMs: scenario.auction.softCloseMs,
    endTs: scenario.clock.startMs + WINDOW_MS,
  } as unknown as AuctionConfig;
}

const SUPPORTED_STEPS = new Set(['register', 'open', 'bid', 'hammer']);

export async function runScenarioInProc(
  scenario: Scenario,
  stop: Array<{ stop(): Promise<void> }>,
): Promise<Outcome> {
  const rig = await makeRig();
  stop.push(rig.paypal);
  // The room refuses an end time more than a day ahead, so the clock starts where the scenario says.
  rig.clock.set(scenario.clock.startMs);
  const service = rig.service();
  const auctionId = rig.ids.mint<'AuctionId'>();
  const config = scenarioConfig(scenario);
  const presets = (config as unknown as { ceilingPresets: number[] }).ceilingPresets;
  const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
  const bidders = new Map<string, Bidder>();
  let boss: Awaited<ReturnType<typeof connect>> | undefined;
  const base = scenario.clock.startMs;

  const steps = [...scenario.steps].sort((a, b) => a.t - b.t);
  for (const step of steps) {
    if (!SUPPORTED_STEPS.has(step.do)) {
      throw new Error(
        `${scenario.id}: step "${step.do}" is not supported by the in-process runner`,
      );
    }
    rig.clock.set(base + step.t);
    if (step.do === 'register') {
      bidders.set(
        step.actor,
        await enroll(rig, service, room, auctionId, step.actor, step.ceiling, presets),
      );
    } else if (step.do === 'open') {
      // A created room is already open; the step only makes the auctioneer connect.
      boss ??= await connect(rig, room, 'auctioneer');
    } else if (step.do === 'bid') {
      const who = bidders.get(step.actor);
      if (who === undefined)
        throw new Error(`${scenario.id}: ${step.actor} bids before registering`);
      await room.submitBid(who.conn, bidMessage(rig, step.amount, 'manual'));
    } else if (step.do === 'hammer') {
      if (boss === undefined) throw new Error(`${scenario.id}: hammer before open`);
      await room.control(boss.conn, {
        controlId: `hammer-${step.t}`,
        action: 'hammer',
        args: { closeNow: 1 },
      });
    }
  }
  await service.idle();

  const entries = await rig.stores.ledger.read(ledgerKey(auctionId), 1);
  const lot = evolveAll(entries).lots[auctionId];
  const byId = new Map([...bidders].map(([name, b]) => [b.id as string, name]));
  const winnerName = lot?.winnerId == null ? null : (byId.get(lot.winnerId) ?? null);
  const winner = winnerName === null ? undefined : bidders.get(winnerName);
  const { core } = rig.paypal;

  const voided = [...bidders]
    .filter(([name]) => name !== winnerName)
    .filter(([, b]) => core.getAuthorization(b.authId).status === 'VOIDED')
    .map(([name]) => name)
    .sort();
  const everyHold = [...bidders.values()].map((b) => core.getAuthorization(b.authId));
  const winnerAuth = winner === undefined ? undefined : core.getAuthorization(winner.authId);
  const winnerCeiling = [...scenario.steps].find(
    (s) => s.do === 'register' && s.actor === winnerName,
  );
  const releasedCents = winner === undefined ? 0 : core.released(winner.authId);

  const invariants: Outcome['invariants'] = {
    I1: everyHold.reduce((n, a) => n + a.captures.length, 0) <= 1,
    I2:
      winnerAuth === undefined ||
      (winnerCeiling?.do === 'register' && winnerAuth.capturedCents <= winnerCeiling.ceiling),
    I3: [...bidders].every(
      ([name, b]) =>
        name === winnerName ||
        (core.getAuthorization(b.authId).status === 'VOIDED' &&
          core.getAuthorization(b.authId).captures.length === 0),
    ),
    I4:
      everyHold.reduce((n, a) => n + a.holdCents, 0) ===
      [...bidders.values()].reduce(
        (n, b) => n + core.getAuthorization(b.authId).capturedCents + core.released(b.authId),
        0,
      ),
  };
  try {
    core.checkInvariants();
  } catch {
    invariants.I1 = false;
  }

  const outcome: Outcome = {
    winner: winnerName,
    priceCents: lot?.priceCents ?? null,
    capturedCents: lot?.capturedCents ?? 0,
    releasedCents,
    voided,
    accepted: entries.filter((e) => e.type === 'BID_RECORDED').length,
    rejected: [...bidders].flatMap(([actor, b]) =>
      b.transport.messages('bid_rejected').map((m) => ({ actor, reason: String(m['reason']) })),
    ),
    invariants,
  };
  await service.close();
  return outcome;
}

/** Every mismatch between the scenario's expectations and the outcome; an unknown kind is one. */
export function checkExpectations(scenario: Scenario, outcome: Outcome): string[] {
  const failures: string[] = [];
  for (const exp of scenario.expect) {
    if ('ledger' in exp) {
      const want = exp.ledger;
      const got = {
        winner: outcome.winner,
        captured: outcome.capturedCents,
        released: outcome.releasedCents,
        voided: outcome.voided,
      };
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        failures.push(`ledger: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    } else if ('invariants' in exp) {
      for (const id of exp.invariants) {
        const ok = outcome.invariants[id];
        if (ok === undefined) failures.push(`invariant ${id} is not evaluated by the runner`);
        else if (!ok) failures.push(`invariant ${id} does not hold`);
      }
    } else {
      failures.push(`expect kind "${Object.keys(exp).join(',')}" is not supported by the runner`);
    }
  }
  return failures;
}
