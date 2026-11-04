import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import {
  assertFakeInvariants,
  FakeInvariantViolation,
  fakeReleasedCents,
} from '../../src/fake/invariants.js';

interface CaptureRow {
  id: string;
  amountCents: number;
  final: boolean;
  requestId: string | undefined;
}
interface AuthRow {
  captures: CaptureRow[];
  voidEffects: number;
}
interface Internals {
  auths: Map<string, AuthRow>;
}

function internals(core: FakePayPalCore): Internals {
  return core as unknown as Internals;
}

function mk(): FakePayPalCore {
  return new FakePayPalCore({ clock: new FakeClock() });
}

describe('assertFakeInvariants', () => {
  it('passes on a clean fake', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    const b = core.createAuthorization('q', 1000).id;
    core.capture(a, 600, true, 'c');
    core.void(b, 'v');
    expect(() => assertFakeInvariants(core)).not.toThrow();
  });

  it('T-PAY-078: a double final capture throws', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    core.capture(a, 600, true, 'c');
    const row = internals(core).auths.get(a);
    row?.captures.push({ id: 'CAP-X', amountCents: 100, final: true, requestId: undefined });
    expect(() => assertFakeInvariants(core)).toThrow(FakeInvariantViolation);
  });

  it('detects capture above the cap, capture after final, and a void plus capture', () => {
    const over = mk();
    const a = over.createAuthorization('p', 1000).id;
    internals(over)
      .auths.get(a)
      ?.captures.push({ id: 'C1', amountCents: 5000, final: false, requestId: undefined });
    expect(() => assertFakeInvariants(over)).toThrow(/above cap/);

    const after = mk();
    const b = after.createAuthorization('p', 1000).id;
    after.capture(b, 100, true, 'c');
    internals(after)
      .auths.get(b)
      ?.captures.push({ id: 'C2', amountCents: 10, final: false, requestId: undefined });
    expect(() => assertFakeInvariants(after)).toThrow(/after final/);

    const both = mk();
    const c = both.createAuthorization('p', 1000).id;
    both.capture(c, 100, false, 'c');
    const row = internals(both).auths.get(c);
    if (row !== undefined) row.voidEffects = 1;
    expect(() => assertFakeInvariants(both)).toThrow(/voided and captured/);
  });

  it('a capture above the buyer ceiling fails even within the fake over-capture limit', () => {
    const core = mk();
    const a = core.createAuthorization('p', 10000).id;
    core.capture(a, 11400, true, 'c'); // hold + 15% is tolerated by the fake, the buyer authorized 10000
    expect(() => assertFakeInvariants(core)).toThrow(/authorized ceiling/);
  });

  it('with the limit set to the ceiling the over-capture itself is refused', () => {
    const core = new FakePayPalCore({ clock: new FakeClock(), captureLimit: (h) => h });
    const a = core.createAuthorization('p', 10000).id;
    expect(() => core.capture(a, 11400, true, 'c')).toThrow(/CAPTURE_AMOUNT_EXCEEDS_LIMIT/);
    expect(() => assertFakeInvariants(core)).not.toThrow();
  });

  it('fakeReleasedCents mirrors released', () => {
    const core = mk();
    const a = core.createAuthorization('p', 1000).id;
    core.capture(a, 600, true, 'c');
    expect(fakeReleasedCents(core, a)).toBe(400);
  });
});
