/**
 * Raising a limit (D-0035) is bounded, so one bidder cannot grow the hold store, the room log and
 * the ledger one cent at a time. The defaults are safe; hosts pass their own through the hold
 * service and the judge-room options.
 */
export interface RaisePolicy {
  /** Most raises one bidder gets per auction. Abandoned attempts count at three times this. */
  maxRaises: number;
  /** Smallest increase of a raise, in cents. */
  minStepCents: number;
  /** Smallest increase of a raise as a percent of the current limit. */
  minStepPercent: number;
}

export const DEFAULT_RAISE_POLICY: Readonly<RaisePolicy> = {
  maxRaises: 5,
  minStepCents: 100,
  minStepPercent: 5,
};

/** The smallest limit a raise from `currentCents` may ask for: the larger of the two steps. */
export function minRaisedCeilingCents(
  currentCents: number,
  policy: Readonly<RaisePolicy> = DEFAULT_RAISE_POLICY,
): number {
  const pct = Math.ceil((currentCents * policy.minStepPercent) / 100);
  return currentCents + Math.max(policy.minStepCents, pct);
}

/**
 * Why a raise is refused, or null when it is allowed. `done` is the bidder's raises so far, `attempts` those plus the abandoned orders.
 * The count is checked first so an exhausted bidder always sees the same answer.
 */
export function raiseRefusal(
  input: { currentCents: number; nextCents: number; done: number; attempts?: number },
  policy: Readonly<RaisePolicy> = DEFAULT_RAISE_POLICY,
): 'raise_limit_reached' | 'raise_too_small' | null {
  if (input.done >= policy.maxRaises) return 'raise_limit_reached';
  if ((input.attempts ?? input.done) >= policy.maxRaises * 3) return 'raise_limit_reached';
  if (input.nextCents < minRaisedCeilingCents(input.currentCents, policy)) {
    return 'raise_too_small';
  }
  return null;
}
