import type { Scenario } from '../dsl/types';

/**
 * In-process ladder runner. It executes the register, open, bid and hammer steps of a scenario and
 * returns the ledger figures the scenario expects. Payment faults, webhooks, voice and the stack
 * mode need the engine and payments packages and are not simulated here: a scenario that uses
 * them is rejected instead of being silently skipped.
 */

export interface LadderResult {
  winner: string | null;
  priceCents: number;
  accepted: number;
  rejected: Array<{ actor: string; reason: string }>;
  capturedCents: number;
  releasedCents: number;
  voided: string[];
}

const SUPPORTED = new Set(['register', 'bid', 'open', 'hammer']);

export function runLadder(scenario: Scenario): LadderResult {
  const ceilings = new Map<string, number>();
  const rejected: LadderResult['rejected'] = [];
  let open = false;
  let leader: string | null = null;
  let price = 0;
  let accepted = 0;
  let hammered = false;
  const steps = [...scenario.steps].sort((a, b) => a.t - b.t);
  for (const step of steps) {
    if (!SUPPORTED.has(step.do)) {
      throw new Error(`${scenario.id}: step "${step.do}" is not supported by the ladder runner`);
    }
    if (step.do === 'register') {
      ceilings.set(step.actor, step.ceiling);
    } else if (step.do === 'open') {
      open = true;
    } else if (step.do === 'bid') {
      const ceiling = ceilings.get(step.actor);
      const floor =
        leader === null ? scenario.auction.reserve : price + scenario.auction.minIncrement;
      if (!open || hammered) rejected.push({ actor: step.actor, reason: 'closed' });
      else if (ceiling === undefined) rejected.push({ actor: step.actor, reason: 'unregistered' });
      else if (step.amount < floor) rejected.push({ actor: step.actor, reason: 'too_low' });
      else if (step.amount > ceiling) rejected.push({ actor: step.actor, reason: 'over_ceiling' });
      else {
        leader = step.actor;
        price = step.amount;
        accepted += 1;
      }
    } else if (step.do === 'hammer') {
      hammered = true;
      open = false;
    }
  }
  if (!hammered) throw new Error(`${scenario.id}: scenario never reaches hammer`);
  const winnerCeiling = leader === null ? 0 : (ceilings.get(leader) ?? 0);
  return {
    winner: leader,
    priceCents: price,
    accepted,
    rejected,
    capturedCents: price,
    releasedCents: leader === null ? 0 : winnerCeiling - price,
    voided: [...ceilings.keys()].filter((a) => a !== leader).sort(),
  };
}
