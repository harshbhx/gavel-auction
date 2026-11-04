import type { PaymentsPort } from '@gavel/shared';

type SettleReq = Parameters<PaymentsPort['settle']>[0];
type WebhookReq = Parameters<PaymentsPort['handleWebhook']>[0];
export type WebhookResult = Awaited<ReturnType<PaymentsPort['handleWebhook']>>;
type SettlementUpdate = Parameters<Parameters<PaymentsPort['onSettlementUpdate']>[0]>[0];
type HoldReport = Parameters<Parameters<PaymentsPort['onHoldReported']>[0]>[0];

/** Fake PaymentsPort for room tests: records calls, replays injected results, pushes updates. */
export class StubPayments implements PaymentsPort {
  readonly settleCalls: SettleReq[] = [];
  readonly webhookCalls: WebhookReq[] = [];
  private readonly queue: WebhookResult[] = [];
  private settleError: Error | null = null;
  private readonly updateListeners = new Set<(u: SettlementUpdate) => void>();
  private readonly holdListeners = new Set<(h: HoldReport) => void>();

  /** Queue results for the next webhook calls. Once empty, calls answer `ok`. */
  injectWebhook(...results: WebhookResult[]): void {
    this.queue.push(...results);
  }

  /** Make the next settle call reject with this error (once). */
  failNextSettle(err: Error): void {
    this.settleError = err;
  }

  async settle(req: SettleReq): Promise<void> {
    this.settleCalls.push(req);
    const err = this.settleError;
    if (err) {
      this.settleError = null;
      throw err;
    }
  }

  async handleWebhook(req: WebhookReq): Promise<WebhookResult> {
    this.webhookCalls.push(req);
    return this.queue.shift() ?? { kind: 'ok' };
  }

  onSettlementUpdate(cb: (u: SettlementUpdate) => void): () => void {
    this.updateListeners.add(cb);
    return () => {
      this.updateListeners.delete(cb);
    };
  }

  onHoldReported(cb: (h: HoldReport) => void): () => void {
    this.holdListeners.add(cb);
    return () => {
      this.holdListeners.delete(cb);
    };
  }

  /** Deliver a settlement update to every subscriber. */
  pushUpdate(u: SettlementUpdate): void {
    for (const cb of [...this.updateListeners]) cb(u);
  }

  /** Deliver a hold report to every subscriber. */
  pushHold(h: HoldReport): void {
    for (const cb of [...this.holdListeners]) cb(h);
  }
}
