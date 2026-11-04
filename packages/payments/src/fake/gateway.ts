import { PayPalError } from '../errors.js';
import { classifyError, classifyNetworkError } from '../errorMap.js';
import type { Clock, PaymentsGateway } from '../ports.js';
import type { HoldTruth } from '../types.js';
import { FakeApiError, FakeTimeout, type FakePayPalCore } from './core.js';

/**
 * FakeGateway: the PaymentsGateway port on top of FakePayPalCore with no HTTP
 * (R-PAY-021). Used for the fastest saga tests. Failures come out as the same
 * PayPalError values the real client produces, built with the same classifier,
 * so a saga cannot tell the two apart. No retries: a fault that the HTTP client
 * would retry surfaces here at once.
 */

export interface FakeGatewayOptions {
  /** Clock for HoldTruth.observedAtMs. Default: the core's clock. */
  clock?: Clock;
}

/** The error an HTTP response with this status and issue would have produced. */
function toPayPalError(e: FakeApiError): PayPalError {
  const body = JSON.stringify({ name: e.issue, message: e.issue, details: [{ issue: e.issue }] });
  return classifyError(e.status, undefined, body);
}

export class FakeGateway implements PaymentsGateway {
  private readonly clock: Clock;

  constructor(
    readonly core: FakePayPalCore,
    opts: FakeGatewayOptions = {},
  ) {
    this.clock = opts.clock ?? core.clock;
  }

  /** Runs one core call and turns its failures into PayPalError (R-PAY-018). */
  private call<T>(method: 'GET' | 'POST', fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FakeApiError) throw toPayPalError(e);
      if (e instanceof FakeTimeout) throw classifyNetworkError(e, method);
      throw e;
    }
  }

  async createOrder(i: {
    holdId: string;
    ceilingCents: number;
    description: string;
    requestId: string;
  }): Promise<{ orderId: string; approveUrl?: string }> {
    const o = this.call('POST', () =>
      this.core.createOrder(
        { holdId: i.holdId, amountCents: i.ceilingCents, description: i.description },
        i.requestId,
      ),
    );
    return { orderId: o.id, approveUrl: o.approveUrl };
  }

  async getOrder(orderId: string): Promise<{ orderId: string; status: string; authId?: string }> {
    const o = this.call('GET', () => this.core.getOrder(orderId));
    return o.authId === undefined
      ? { orderId: o.id, status: o.status }
      : { orderId: o.id, status: o.status, authId: o.authId };
  }

  async authorizeOrder(
    orderId: string,
    requestId: string,
  ): Promise<{ authId: string; amountCents: number }> {
    const a = this.call('POST', () => this.core.authorizeOrder(orderId, requestId));
    return { authId: a.authId, amountCents: a.amountCents };
  }

  async getHoldTruth(h: { holdId: string; authId: string; orderId?: string }): Promise<HoldTruth> {
    const observedAtMs = this.clock.nowMs();
    try {
      const a = this.call('GET', () => this.core.getAuthorization(h.authId));
      return {
        holdId: h.holdId,
        authId: h.authId,
        status: a.status,
        amountCents: a.holdCents,
        capturedCents: a.capturedCents,
        captures: a.captures.map((c) => ({
          captureId: c.id,
          amountCents: c.amountCents,
          final: c.final,
        })),
        observedAtMs,
      };
    } catch (e) {
      if (e instanceof PayPalError && e.kind === 'not_found') {
        return {
          holdId: h.holdId,
          authId: h.authId,
          status: 'NOT_FOUND',
          amountCents: 0,
          capturedCents: 0,
          captures: [],
          observedAtMs,
        };
      }
      throw e;
    }
  }

  async capture(
    authId: string,
    i: { amountCents: number; finalCapture: boolean; invoiceId: string; requestId: string },
  ): Promise<{ captureId: string; amountCents: number }> {
    const c = this.call('POST', () =>
      this.core.capture(authId, i.amountCents, i.finalCapture, i.requestId),
    );
    return { captureId: c.id, amountCents: c.amountCents };
  }

  /** Throws PayPalError; the saga counts already_voided, expired and not_found as released. */
  async voidAuthorization(authId: string, requestId: string): Promise<void> {
    this.call('POST', () => this.core.void(authId, requestId));
  }

  async reauthorize(
    authId: string,
    i: { amountCents: number; requestId: string },
  ): Promise<{ amountCents: number }> {
    const r = this.call('POST', () => this.core.reauthorize(authId, i.amountCents, i.requestId));
    return { amountCents: r.amountCents };
  }
}
