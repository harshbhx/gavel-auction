import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import type { PaymentsGateway } from '../../src/ports.js';

/**
 * Gateway conformance suite (SPEC 3.10, R-PAY-128). One set of assertions about
 * the `PaymentsGateway` port that runs against the fake and, in the manual
 * workflow, against the PayPal sandbox. Where the sandbox disagrees with the fake
 * the run records a `Difference` instead of failing, and the differences are
 * appended to `src/fake/ASSUMPTIONS.md` so that the fake can be corrected.
 */

export interface ConformanceTarget {
  label: string;
  gateway: PaymentsGateway;
  /** A fresh, live authorization for exactly this many cents. */
  newAuthorization(
    amountCents: number,
  ): Promise<{ holdId: string; authId: string; orderId?: string }>;
  close?(): Promise<void>;
}

export interface Difference {
  id: string;
  title: string;
  message: string;
}

export interface ConformanceAssertion {
  id: string;
  title: string;
  run(t: ConformanceTarget): Promise<void>;
}

let seq = 0;

/** getHoldTruth input for a hold made by `newAuthorization`. */
function ref(h: { holdId: string; authId: string; orderId?: string }): {
  holdId: string;
  authId: string;
  orderId?: string;
} {
  return h.orderId === undefined
    ? { holdId: h.holdId, authId: h.authId }
    : { holdId: h.holdId, authId: h.authId, orderId: h.orderId };
}
const rid = (what: string): string => `conf-${process.pid}-${what}-${(seq += 1)}`;

/** Null when the call succeeded, the error when PayPal refused it. */
async function refusalOrDone(p: Promise<unknown>): Promise<PayPalError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
}

async function refusal(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected the call to be refused');
}

export const ASSERTIONS: readonly ConformanceAssertion[] = [
  {
    id: 'C01',
    title: 'a fresh authorization reads as live with nothing captured',
    async run(t) {
      const hold = await t.newAuthorization(30000);
      const { authId } = hold;
      const truth = await t.gateway.getHoldTruth(ref(hold));
      expect(['CREATED', 'PENDING']).toContain(truth.status);
      expect(truth.amountCents).toBe(30000);
      expect(truth.capturedCents).toBe(0);
    },
  },
  {
    id: 'C02',
    title: 'a final capture below the hold is reported with its amount and the hold is closed',
    async run(t) {
      const hold = await t.newAuthorization(30000);
      const { authId } = hold;
      const cap = await t.gateway.capture(authId, {
        amountCents: 22000,
        finalCapture: true,
        invoiceId: rid('inv'),
        requestId: rid('cap'),
      });
      expect(cap.amountCents).toBe(22000);
      const truth = await t.gateway.getHoldTruth(ref(hold));
      expect(truth.capturedCents).toBe(22000);
      expect(truth.status).toBe('CAPTURED');
    },
  },
  {
    id: 'C03',
    title: 'the same request id replays the first capture instead of capturing twice',
    async run(t) {
      const hold = await t.newAuthorization(30000);
      const { authId } = hold;
      const input = {
        amountCents: 10000,
        finalCapture: false,
        invoiceId: rid('inv'),
        requestId: rid('cap'),
      };
      const a = await t.gateway.capture(authId, input);
      const b = await t.gateway.capture(authId, input);
      expect(b.captureId).toBe(a.captureId);
      const truth = await t.gateway.getHoldTruth(ref(hold));
      expect(truth.capturedCents).toBe(10000);
    },
  },
  {
    id: 'C04',
    title: 'a capture after a final capture is refused definitely',
    async run(t) {
      const { authId } = await t.newAuthorization(30000);
      await t.gateway.capture(authId, {
        amountCents: 5000,
        finalCapture: true,
        invoiceId: rid('inv'),
        requestId: rid('cap'),
      });
      const e = await refusal(
        t.gateway.capture(authId, {
          amountCents: 1000,
          finalCapture: true,
          invoiceId: rid('inv'),
          requestId: rid('cap'),
        }),
      );
      expect(e.outcome).toBe('definite');
    },
  },
  {
    id: 'C05',
    title: 'a void releases the hold and a second void either succeeds or is refused definitely',
    async run(t) {
      const hold = await t.newAuthorization(30000);
      const { authId } = hold;
      await t.gateway.voidAuthorization(authId, rid('void'));
      const truth = await t.gateway.getHoldTruth(ref(hold));
      expect(truth.status).toBe('VOIDED');
      const again = await refusalOrDone(t.gateway.voidAuthorization(authId, rid('void')));
      if (again !== null) expect(again.outcome).toBe('definite');
    },
  },
  {
    id: 'C06',
    title: 'a capture on a voided authorization is refused definitely',
    async run(t) {
      const { authId } = await t.newAuthorization(30000);
      await t.gateway.voidAuthorization(authId, rid('void'));
      const e = await refusal(
        t.gateway.capture(authId, {
          amountCents: 1000,
          finalCapture: true,
          invoiceId: rid('inv'),
          requestId: rid('cap'),
        }),
      );
      expect(e.outcome).toBe('definite');
    },
  },
  {
    id: 'C07',
    title: 'an authorization that does not exist reads as NOT_FOUND',
    async run(t) {
      const truth = await t.gateway.getHoldTruth({
        holdId: 'conf-none',
        authId: 'CONF-NO-SUCH-AUTH',
      });
      expect(truth.status).toBe('NOT_FOUND');
      expect(truth.capturedCents).toBe(0);
    },
  },
];

export interface ConformanceOptions {
  /** When set, a failing assertion is recorded here and the test passes (sandbox runs). */
  onDifference?: (d: Difference) => void;
}

/** Registers the suite for one target. `open` runs once before the first assertion. */
export function runConformance(
  label: string,
  open: () => Promise<ConformanceTarget>,
  opts: ConformanceOptions = {},
): void {
  describe(`gateway conformance: ${label}`, () => {
    let target: ConformanceTarget | undefined;
    const get = async (): Promise<ConformanceTarget> => (target ??= await open());

    for (const a of ASSERTIONS) {
      it(`${a.id} ${a.title}`, async () => {
        const t = await get();
        try {
          await a.run(t);
        } catch (e) {
          if (opts.onDifference === undefined) throw e;
          opts.onDifference({
            id: a.id,
            title: a.title,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    }

    it('closes the target', async () => {
      await target?.close?.();
    });
  });
}

/** Markdown rows for ASSUMPTIONS.md: one per difference, in assertion order. */
export function formatDifferences(label: string, diffs: readonly Difference[]): string {
  if (diffs.length === 0) return '';
  const rows = [...diffs]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(
      (d) =>
        `| ${d.id} | ${label} | ${d.title} | ${d.message.replace(/\s+/g, ' ').replace(/\|/g, '/')} |`,
    );
  return [
    '',
    '## Conformance differences',
    '',
    '| ID  | Target | Assertion | Observed |',
    '| --- | ------ | --------- | -------- |',
    ...rows,
    '',
  ].join('\n');
}
