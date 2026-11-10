import type { PaymentsGateway } from '@gavel/payments';
import type { PaypalOp } from '../ops/metrics';

/** What the gateway wrapper reports to: the metrics collector's PayPal call hook. */
export interface PaypalCallSink {
  paypalCall(op: PaypalOp, ok: boolean, ms: number): void;
}

/**
 * Wraps a gateway so every call is counted by operation and outcome and its latency is
 * recorded (R-QA-047). Results and errors pass through unchanged; no argument or result is
 * read, so no payment data reaches the metrics.
 */
export function meteredGateway(
  gateway: PaymentsGateway,
  sink: PaypalCallSink,
  nowMs: () => number,
): PaymentsGateway {
  async function timed<T>(op: PaypalOp, call: () => Promise<T>): Promise<T> {
    const start = nowMs();
    try {
      const out = await call();
      sink.paypalCall(op, true, nowMs() - start);
      return out;
    } catch (e) {
      sink.paypalCall(op, false, nowMs() - start);
      throw e;
    }
  }
  return {
    createOrder: (i) => timed('createOrder', () => gateway.createOrder(i)),
    getOrder: (id) => timed('getOrder', () => gateway.getOrder(id)),
    authorizeOrder: (id, requestId) =>
      timed('authorizeOrder', () => gateway.authorizeOrder(id, requestId)),
    getHoldTruth: (h) => timed('getHoldTruth', () => gateway.getHoldTruth(h)),
    capture: (authId, i) => timed('capture', () => gateway.capture(authId, i)),
    voidAuthorization: (authId, requestId) =>
      timed('voidAuthorization', () => gateway.voidAuthorization(authId, requestId)),
    reauthorize: (authId, i) => timed('reauthorize', () => gateway.reauthorize(authId, i)),
  };
}
