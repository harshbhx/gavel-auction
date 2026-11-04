import type { FakePayPalCore } from './core.js';

/** A rule of the fake PayPal was broken: a bug in the code under test or in the fake. */
export class FakeInvariantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakeInvariantViolation';
  }
}

/**
 * Shared test helper (R-PAY-127): call after every saga test. Checks the ported
 * prototype invariants: captures within the cap, at most one final capture, no
 * capture after a final one, at most one void effect, no void and capture on the
 * same authorization (except an explicit remainder void when the fake does not
 * auto-release). Throws FakeInvariantViolation on the first violation.
 */
export function assertFakeInvariants(core: FakePayPalCore): void {
  try {
    core.checkInvariants();
  } catch (e) {
    throw new FakeInvariantViolation(e instanceof Error ? e.message : String(e));
  }
}

/** Cents returned to the payer from one hold (see FakePayPalCore.released). */
export function fakeReleasedCents(core: FakePayPalCore, authId: string): number {
  return core.released(authId);
}
